import { createWorker, PSM } from 'tesseract.js'
import { inferLayout } from './layout'
import { fixVerticalDashes, languageFor, tidyText } from './languages'
import { enhanceImage } from './preprocess'
import { classifyRegion, cropRegion, detectRegions, upscaleFor } from './regions'

export { classifyRegion }

// Page layout hints. Tesseract guesses the layout by default, which is wrong
// for things like a single caption or scattered labels.
export const AUTO_LAYOUT = 'auto'
export const REGIONS_LAYOUT = 'regions'
export const MIN_CONFIDENCE = 40 // regions Tesseract is less sure of than this look like ghost text
export const LAYOUTS = [
  { id: AUTO_LAYOUT, label: 'Auto-detect' },
  { id: REGIONS_LAYOUT, label: 'Find text regions (mixed pages)' },
  { id: PSM.AUTO, label: 'Tesseract default' },
  { id: PSM.SINGLE_BLOCK, label: 'One block of text' },
  { id: PSM.SINGLE_COLUMN, label: 'One column' },
  { id: PSM.SINGLE_LINE, label: 'A single line' },
  { id: PSM.SPARSE_TEXT, label: 'Scattered text' },
]

// Mixed pages (several models together, or asked for explicitly) are read region by
// region, because one global guess would be wrong and Tesseract's own page layout
// misreads vertical groups.
export const usesRegions = ({ language, layout }) =>
  layout === REGIONS_LAYOUT || (layout === AUTO_LAYOUT && language.includes('+'))

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

// Finds candidate text groups on a page. Returns { regions, page } in the image's own pixels.
export async function findTextRegions(image) {
  const { regions, width, height } = await detectRegions(image)
  return { regions, page: { width, height } }
}

// Reads each region on its own, with the model and layout that suits its direction.
// Resolves to [{ id, text, confidence, language }]. Regions need { id, x, y, w, h, direction, psm }.
export async function readRegions(image, regions, { language = 'eng', enhance = false } = {}, onProgress) {
  const base = language.split('+')[0]
  const workers = new Map() // one worker per language model actually needed
  const results = []
  try {
    for (const [i, region] of regions.entries()) {
      onProgress?.({ status: `reading region ${i + 1} of ${regions.length}`, progress: i / regions.length })
      const lang = languageFor(base, region.direction)
      if (!workers.has(lang)) workers.set(lang, await makeWorker(lang))
      const worker = workers.get(lang)
      await worker.setParameters({ tessedit_pageseg_mode: region.psm })
      const read = async (box, unit) => {
        let crop = await cropRegion(image, box, upscaleFor(unit))
        if (enhance) crop = await enhanceImage(crop)
        return (await worker.recognize(crop)).data
      }

      let text
      let confidence
      if (region.columns?.length > 1) {
        // Tesseract struggles to split and order vertical columns itself, so read each
        // column alone, from the right (the order Japanese vertical text is read in).
        const columns = [...region.columns].sort((a, b) => b.x - a.x)
        const reads = []
        for (const col of columns) {
          const slack = Math.max(2, Math.round(col.w * 0.25))
          const box = { x: col.x - slack, y: region.y, w: col.w + slack * 2, h: region.h }
          reads.push(await read(box, { w: col.w, h: region.h, lines: 1, direction: 'vertical' }))
        }
        text = reads.map((d) => tidyText(d.text).trim()).filter(Boolean).join('\n')
        confidence = reads.reduce((sum, d) => sum + d.confidence, 0) / reads.length
      } else {
        const data = await read(region, region)
        text = tidyText(data.text).trim()
        confidence = data.confidence
      }
      results.push({ id: region.id, text: region.direction === 'vertical' ? fixVerticalDashes(text) : text, confidence, language: lang })
    }
  } finally {
    await Promise.all([...workers.values()].map((w) => w.terminate()))
  }
  return results
}

// Extracts text from a whole image Blob/File in one pass, entirely in the browser.
// Resolves to { text, detected }, where `detected` describes what auto-detect chose (or null).
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = AUTO_LAYOUT, enhance = false } = {}, onProgress) {
  if (enhance) {
    onProgress?.({ status: 'enhancing image', progress: 0 })
    image = await enhanceImage(image)
  }

  let detected = null
  if (layout === AUTO_LAYOUT) {
    onProgress?.({ status: 'detecting layout', progress: 0 })
    const { direction, lines, psm } = await inferLayout(image)
    language = languageFor(language, direction)
    detected = { direction, lines, psm, language }
    layout = psm
  }

  const worker = await makeWorker(language, onProgress)
  try {
    await worker.setParameters({ tessedit_pageseg_mode: layout })
    const { data } = await worker.recognize(image)
    return { text: tidyText(data.text), detected }
  } finally {
    await worker.terminate()
  }
}
