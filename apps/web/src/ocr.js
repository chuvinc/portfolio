import { createWorker, PSM } from 'tesseract.js'
import { inferLayout } from './layout'
import { japaneseWhitelist } from './charset'
import { cleanEntries, entriesFromData, entriesToText } from './postprocess'
import { enhanceImage } from './preprocess'
import { classifyRegion, cropRegion, detectRegions, upscaleFor } from './regions'

export { classifyRegion }

export const AUTO_LAYOUT = 'auto'
export const REGIONS_LAYOUT = 'regions'
// Regions the engine is less sure of than this look like ghost text. Text-free artwork (screentone,
// hatching, linework) read at a median of 0 and almost never reached 60, while real text read ~90.
export const MIN_CONFIDENCE = 50
const OVERSHOOT = 1.6 // more characters than this many times a box's capacity can't be real text
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

// Which Japanese reading to trust, vertical or horizontal. Measured on rendered text: the
// vertical model is confidently wrong on horizontal text (about 83% sure while ~8% right, often
// the right characters in reverse order), while the horizontal model is plainly unsure (~0%) on
// vertical text. So a vertical read only wins when it is clearly more confident than the
// horizontal one. Close calls go to the shape of the text (tall or wide), when known.
export const VERTICAL_MARGIN = 15
export function chooseDirection(vertical, horizontal, shape) {
  const gap = vertical.confidence - horizontal.confidence
  if (gap > VERTICAL_MARGIN) return 'vertical'
  if (gap < -VERTICAL_MARGIN) return 'horizontal'
  return shape ?? 'horizontal'
}

// Layout mode for the horizontal reading. A single line or column uses the line mode (on a
// vertical column it reports ~0% confidence, a clear "no"). Anything bigger uses the automatic
// mode: in "single block" mode the horizontal model reads a vertical block as confident gibberish
// (85% sure, measured), which would defeat chooseDirection, while the automatic mode reports it
// as unsure (25%) and reads horizontal blocks just as accurately (99%).
const horizontalPsm = (lines) => (lines <= 1 ? PSM.SINGLE_LINE : PSM.AUTO)

// Reads Japanese both ways and keeps the more believable one. `vertical` and `horizontal` are
// functions returning { entries, confidence }; `shape` is 'vertical', 'horizontal' or undefined.
async function readJapanese({ vertical, horizontal }, shape) {
  const h = { ...(await horizontal()), direction: 'horizontal', language: 'jpn' }
  const v = { ...(await vertical()), direction: 'vertical', language: 'jpn_vert' }
  return chooseDirection(v, h, shape) === 'vertical' ? v : h
}

// Restricts the Japanese models to Japanese characters (see charset.js); other languages are
// left alone.
const charsetFor = (lang, allowLatin) =>
  lang === 'jpn' || lang === 'jpn_vert' ? { tessedit_char_whitelist: japaneseWhitelist({ allowLatin }) } : {}

// About how many characters a box can hold, from the size of the text itself and its lines or
// columns. Used to spot a read that returned far more than could be there (screentone and other
// artwork produce hundreds of characters from a small box).
export function expectedGlyphs(region, direction) {
  const { w, h } = region.core ?? region
  const count = Math.max(1, region.direction === direction ? (region.columns?.length ?? region.lines ?? 1) : 1)
  if (direction === 'vertical') {
    const glyph = region.columns?.length ? region.columns.reduce((sum, c) => sum + c.w, 0) / region.columns.length : w / count
    return count * Math.max(1, h / glyph)
  }
  return count * Math.max(1, w / (h / count))
}

// Scales a confidence down when the read has more characters than the box could hold.
export function plausibleConfidence(confidence, characters, expected) {
  const limit = expected * OVERSHOOT
  return characters > limit ? confidence * (limit / characters) : confidence
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

// Reads each region on its own. Japanese is read both ways and the believable one kept (see
// chooseDirection). Resolves to [{ id, text, entries, confidence, language }],
// where `entries` are the characters with their confidence (see postprocess.js).
// Regions need { id, x, y, w, h, direction, lines, psm }.
export async function readRegions(image, regions, { language = 'eng', enhance = false, allowLatin = false } = {}, onProgress) {
  const pool = workerPool()
  const results = []

  const read = async (lang, psm, box, unit) => {
    const worker = await pool.get(lang)
    await worker.setParameters({ tessedit_pageseg_mode: psm, ...charsetFor(lang, allowLatin) })
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
        const unit = (direction, lines) => ({ ...region, direction, lines })
        best = finish(
          await readJapanese(
            {
              vertical: () =>
                region.columns?.length > 1
                  ? readColumns(region)
                  : read('jpn_vert', PSM.SINGLE_BLOCK_VERT_TEXT, region, unit('vertical', region.direction === 'vertical' ? region.lines : 1)),
              horizontal: () => read('jpn', horizontalPsm(region.lines), region, unit('horizontal', region.direction === 'horizontal' ? region.lines : 1)),
            },
            region.direction,
          ),
        )
      } else {
        best = finish({ ...(await read(language, region.psm, region, region)), language })
      }
      const characters = Array.from(best.text).filter((ch) => ch.trim()).length
      const confidence = plausibleConfidence(best.confidence, characters, expectedGlyphs(region, best.direction ?? region.direction))
      results.push({ id: region.id, text: best.text, entries: best.entries, confidence, language: best.language })
    }
  } finally {
    await pool.close()
  }
  return results
}

// Extracts text from a whole image Blob/File in one pass, entirely in the browser.
// Resolves to { text, entries, detected }, where `detected` describes what was used (or null).
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = AUTO_LAYOUT, enhance = false, allowLatin = false } = {}, onProgress) {
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
    await worker.setParameters({ tessedit_pageseg_mode: psm, ...charsetFor(lang, allowLatin) })
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    return { entries: entriesFromData(data), confidence: data.confidence }
  }

  try {
    if (language !== 'jpn') {
      const psm = geometry ? geometry.psm : layout
      const { text, entries } = finish(await read(language, psm))
      return { text, entries, detected: geometry && { direction: geometry.direction, lines: geometry.lines, psm, language } }
    }

    // Japanese: read both ways and keep the believable one (see chooseDirection).
    const lines = geometry ? geometry.lines : layout === PSM.SINGLE_LINE ? 1 : 2
    const readPsm = horizontalPsm(lines)
    const best = finish(
      await readJapanese(
        {
          vertical: () => read('jpn_vert', PSM.SINGLE_BLOCK_VERT_TEXT),
          horizontal: () => read('jpn', readPsm),
        },
        geometry?.direction,
      ),
    )
    return {
      text: best.text,
      entries: best.entries,
      detected: {
        direction: best.direction,
        lines: geometry?.lines ?? 1,
        psm: best.direction === 'vertical' ? PSM.SINGLE_BLOCK_VERT_TEXT : readPsm,
        language: best.language,
      },
    }
  } finally {
    await pool.close()
  }
}
