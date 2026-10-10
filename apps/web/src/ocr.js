import { createWorker, PSM } from 'tesseract.js'
import { inferLayout } from './layout'
import { cleanEntries, entriesFromData, entriesToText } from './postprocess'
import { enhanceImage } from './preprocess'
import { classifyRegion, cropRegion, detectRegions, upscaleFor } from './regions'

export { classifyRegion }

export const AUTO_LAYOUT = 'auto'
export const REGIONS_LAYOUT = 'regions'
export const MIN_CONFIDENCE = 40 // regions Tesseract is less sure of than this look like ghost text
const GOOD_ENOUGH = 70 // a Japanese read at least this confident is accepted without trying the other direction
export const LAYOUTS = [
  { id: AUTO_LAYOUT, label: 'Automatic' },
  { id: REGIONS_LAYOUT, label: 'Pick text regions (mixed pages)' },
  { id: PSM.SINGLE_BLOCK, label: 'One block of text' },
  { id: PSM.SINGLE_LINE, label: 'One line' },
]

// Mixed pages are read region by region, because one global guess would be wrong and
// Tesseract's own page layout misreads vertical groups.
export const usesRegions = ({ layout }) => layout === REGIONS_LAYOUT

// Worker, WASM core and language data are self-hosted (see scripts/copy-ocr-assets.mjs),
// so no request leaves the site. Paths must be absolute: the worker resolves them itself.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href

const makeWorker = (language, onProgress) => {
  const base = assetBase()
  return createWorker(language, 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (m) => onProgress?.(m),
  })
}

// One worker per language model actually needed, created on first use.
function workerPool(onProgress) {
  const workers = new Map()
  return {
    async get(language) {
      if (!workers.has(language)) workers.set(language, await makeWorker(language, onProgress))
      return workers.get(language)
    },
    close: () => Promise.all([...workers.values()].map((w) => w.terminate())),
  }
}

// Runs the attempts in order and stops at the first confident one. Otherwise keeps the
// most confident result. Each attempt is { direction, language, run: () => { text, confidence } }.
async function readBest(attempts) {
  let best = null
  for (const attempt of attempts) {
    const result = { ...(await attempt.run()), direction: attempt.direction, language: attempt.language }
    if (!best || result.confidence > best.confidence) best = result
    if (result.confidence >= GOOD_ENOUGH) break
  }
  return best
}

// Tidies a read result's characters (spaces between kana, stray bars in vertical text) and adds
// its text. The characters keep their confidence so a glossary can use it later.
const finish = (r) => {
  const entries = cleanEntries(r.entries, { vertical: r.direction === 'vertical' })
  return { ...r, entries, text: entriesToText(entries) }
}

// Finds candidate text groups on a page. Returns { regions, page } in the image's own pixels.
export async function findTextRegions(image, sensitivity) {
  const { regions, width, height } = await detectRegions(image, sensitivity)
  return { regions, page: { width, height } }
}

// Reads each region on its own. Japanese is assumed vertical first, and horizontal is tried
// only if that read isn't confident. Resolves to [{ id, text, entries, confidence, language }],
// where `entries` are the characters with their confidence (see postprocess.js).
// Regions need { id, x, y, w, h, direction, lines, psm }.
export async function readRegions(image, regions, { language = 'eng', enhance = false } = {}, onProgress) {
  const pool = workerPool()
  const results = []

  const read = async (lang, psm, box, unit) => {
    const worker = await pool.get(lang)
    await worker.setParameters({ tessedit_pageseg_mode: psm })
    let crop = await cropRegion(image, box, upscaleFor(unit))
    if (enhance) crop = await enhanceImage(crop)
    const { data } = await worker.recognize(crop, {}, { text: true, blocks: true })
    return { entries: entriesFromData(data), confidence: data.confidence }
  }

  // Tesseract struggles to split and order vertical columns itself, so read each column
  // alone, from the right (the order Japanese vertical text is read in).
  const readColumns = async (region) => {
    const reads = []
    for (const col of [...region.columns].sort((a, b) => b.x - a.x)) {
      const slack = Math.max(2, Math.round(col.w * 0.25))
      const box = { x: col.x - slack, y: region.y, w: col.w + slack * 2, h: region.h }
      reads.push(await read('jpn_vert', PSM.SINGLE_BLOCK_VERT_TEXT, box, { w: col.w, h: region.h, lines: 1, direction: 'vertical' }))
    }
    const columns = reads.map((d) => cleanEntries(d.entries, { vertical: true })).filter((e) => e.length)
    return {
      entries: columns.flatMap((e, i) => (i ? [{ ch: '\n', conf: 100 }, ...e] : e)),
      confidence: reads.reduce((sum, d) => sum + d.confidence, 0) / reads.length,
    }
  }

  try {
    for (const [i, region] of regions.entries()) {
      onProgress?.({ status: `reading region ${i + 1} of ${regions.length}`, progress: i / regions.length })
      let best
      if (language === 'jpn') {
        const horizontalPsm = region.direction === 'horizontal' ? region.psm : region.lines <= 1 ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK
        const unit = (direction, lines) => ({ ...region, direction, lines })
        best = finish(
          await readBest([
            {
              direction: 'vertical',
              language: 'jpn_vert',
              run: () =>
                region.columns?.length > 1
                  ? readColumns(region)
                  : read('jpn_vert', PSM.SINGLE_BLOCK_VERT_TEXT, region, unit('vertical', region.direction === 'vertical' ? region.lines : 1)),
            },
            {
              direction: 'horizontal',
              language: 'jpn',
              run: () => read('jpn', horizontalPsm, region, unit('horizontal', region.direction === 'horizontal' ? region.lines : 1)),
            },
          ]),
        )
      } else {
        best = finish({ ...(await read(language, region.psm, region, region)), language })
      }
      results.push({ id: region.id, text: best.text, entries: best.entries, confidence: best.confidence, language: best.language })
    }
  } finally {
    await pool.close()
  }
  return results
}

// Extracts text from a whole image Blob/File in one pass, entirely in the browser.
// Resolves to { text, entries, detected }, where `detected` describes what was used (or null).
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = AUTO_LAYOUT, enhance = false } = {}, onProgress) {
  if (enhance) {
    onProgress?.({ status: 'enhancing image', progress: 0 })
    image = await enhanceImage(image)
  }

  let geometry = null
  if (layout === AUTO_LAYOUT) {
    onProgress?.({ status: 'detecting layout', progress: 0 })
    geometry = await inferLayout(image)
  }

  const pool = workerPool(onProgress)
  const read = async (lang, psm) => {
    const worker = await pool.get(lang)
    await worker.setParameters({ tessedit_pageseg_mode: psm })
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    return { entries: entriesFromData(data), confidence: data.confidence }
  }

  try {
    if (language !== 'jpn') {
      const psm = geometry ? geometry.psm : layout
      const { text, entries } = finish(await read(language, psm))
      return { text, entries, detected: geometry && { direction: geometry.direction, lines: geometry.lines, psm, language } }
    }

    // Japanese: assume vertical first, and fall back to horizontal if that read isn't confident.
    const horizontalPsm = geometry ? (geometry.direction === 'horizontal' ? geometry.psm : PSM.AUTO) : layout
    const best = finish(
      await readBest([
        { direction: 'vertical', language: 'jpn_vert', run: () => read('jpn_vert', PSM.SINGLE_BLOCK_VERT_TEXT) },
        { direction: 'horizontal', language: 'jpn', run: () => read('jpn', horizontalPsm) },
      ]),
    )
    return {
      text: best.text,
      entries: best.entries,
      detected: {
        direction: best.direction,
        lines: geometry?.lines ?? 1,
        psm: best.direction === 'vertical' ? PSM.SINGLE_BLOCK_VERT_TEXT : horizontalPsm,
        language: best.language,
      },
    }
  } finally {
    await pool.close()
  }
}
