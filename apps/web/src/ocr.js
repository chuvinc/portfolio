import { createWorker, PSM } from 'tesseract.js'
import { inferLayout } from './layout'
import { languageFor, tidyText } from './languages'
import { enhanceImage } from './preprocess'

// Page layout hints. Tesseract guesses the layout by default, which is wrong
// for things like a single caption or scattered labels.
export const AUTO_LAYOUT = 'auto'
export const LAYOUTS = [
  { id: AUTO_LAYOUT, label: 'Auto-detect' },
  { id: PSM.AUTO, label: 'Tesseract default' },
  { id: PSM.SINGLE_BLOCK, label: 'One block of text' },
  { id: PSM.SINGLE_COLUMN, label: 'One column' },
  { id: PSM.SINGLE_LINE, label: 'A single line' },
  { id: PSM.SPARSE_TEXT, label: 'Scattered text' },
]

// Worker, WASM core and language data are self-hosted (see scripts/copy-ocr-assets.mjs),
// so no request leaves the site. Paths must be absolute: the worker resolves them itself.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href

// Extracts text from an image Blob/File entirely in the browser. Resolves to
// { text, detected }, where `detected` describes what auto-detect chose (or null).
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = AUTO_LAYOUT, enhance = false } = {}, onProgress) {
  if (enhance) {
    onProgress?.({ status: 'enhancing image', progress: 0 })
    image = await enhanceImage(image)
  }

  // Several models together: Tesseract picks per block, and a single global guess
  // would be wrong for mixed pages, so skip auto-detect and use its own layout analysis.
  if (layout === AUTO_LAYOUT && language.includes('+')) layout = PSM.AUTO

  let detected = null
  if (layout === AUTO_LAYOUT) {
    onProgress?.({ status: 'detecting layout', progress: 0 })
    const { direction, lines, psm } = await inferLayout(image)
    language = languageFor(language, direction)
    detected = { direction, lines, psm, language }
    layout = psm
  }

  const base = assetBase()
  const worker = await createWorker(language, 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (m) => onProgress?.(m),
  })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: layout })
    const { data } = await worker.recognize(image)
    return { text: tidyText(data.text), detected }
  } finally {
    await worker.terminate()
  }
}
