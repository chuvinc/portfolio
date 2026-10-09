import { createWorker, PSM } from 'tesseract.js'
import { inferLayout } from './layout'
import { languageFor, readsRightToLeft, tidyText } from './languages'
import { enhanceImage } from './preprocess'
import { cropRegion, detectRegions, orderRegions } from './regions'

// Page layout hints. Tesseract guesses the layout by default, which is wrong
// for things like a single caption or scattered labels.
export const AUTO_LAYOUT = 'auto'
export const REGIONS_LAYOUT = 'regions'
const MIN_CONFIDENCE = 40 // regions Tesseract is less sure of than this are dropped as non-text
export const LAYOUTS = [
  { id: AUTO_LAYOUT, label: 'Auto-detect' },
  { id: REGIONS_LAYOUT, label: 'Find text regions (mixed pages)' },
  { id: PSM.AUTO, label: 'Tesseract default' },
  { id: PSM.SINGLE_BLOCK, label: 'One block of text' },
  { id: PSM.SINGLE_COLUMN, label: 'One column' },
  { id: PSM.SINGLE_LINE, label: 'A single line' },
  { id: PSM.SPARSE_TEXT, label: 'Scattered text' },
]

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

// Mixed pages: find each text group, then read it with the model and layout that suits
// it (vertical groups get the vertical model). Groups Tesseract isn't confident about
// are dropped, which filters out artwork mistaken for text.
async function recognizeRegions(image, language, onProgress) {
  onProgress?.({ status: 'finding text regions', progress: 0 })
  const { regions, width, height } = await detectRegions(image)
  const base = language.split('+')[0]
  const ordered = orderRegions(regions, height, readsRightToLeft(base))

  const workers = new Map() // one worker per language model actually needed
  const results = []
  try {
    for (const [i, region] of ordered.entries()) {
      const lang = languageFor(base, region.direction)
      if (!workers.has(lang)) workers.set(lang, await makeWorker(lang))
      const worker = workers.get(lang)
      await worker.setParameters({ tessedit_pageseg_mode: region.psm })
      const { data } = await worker.recognize(await cropRegion(image, region))
      const text = tidyText(data.text).trim()
      results.push({ ...region, language: lang, text, confidence: data.confidence, kept: !!text && data.confidence >= MIN_CONFIDENCE })
      onProgress?.({ status: `reading region ${i + 1} of ${ordered.length}`, progress: (i + 1) / ordered.length })
    }
  } finally {
    await Promise.all([...workers.values()].map((w) => w.terminate()))
  }

  return {
    text: results.filter((r) => r.kept).map((r) => r.text).join('\n\n'),
    detected: { mode: 'regions', page: { width, height }, regions: results },
  }
}

// Extracts text from an image Blob/File entirely in the browser. Resolves to
// { text, detected }, where `detected` describes what auto-detect chose (or null).
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = AUTO_LAYOUT, enhance = false } = {}, onProgress) {
  if (enhance) {
    onProgress?.({ status: 'enhancing image', progress: 0 })
    image = await enhanceImage(image)
  }

  // Several models together means a mixed page, where one global guess would be wrong
  // (and Tesseract's own page layout misreads vertical groups), so read it region by region.
  if (layout === AUTO_LAYOUT && language.includes('+')) layout = REGIONS_LAYOUT

  if (layout === REGIONS_LAYOUT) return recognizeRegions(image, language, onProgress)

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
