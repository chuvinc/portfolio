import { createWorker, PSM } from 'tesseract.js'
import { tidyText } from './languages'
import { enhanceImage } from './preprocess'

// Page layout hints. Tesseract guesses the layout by default, which is wrong
// for things like a single caption or scattered labels.
export const LAYOUTS = [
  { id: PSM.AUTO, label: 'Automatic' },
  { id: PSM.SINGLE_BLOCK, label: 'One block of text' },
  { id: PSM.SINGLE_COLUMN, label: 'One column' },
  { id: PSM.SINGLE_LINE, label: 'A single line' },
  { id: PSM.SPARSE_TEXT, label: 'Scattered text' },
]

// Worker, WASM core and language data are self-hosted (see scripts/copy-ocr-assets.mjs),
// so no request leaves the site. Paths must be absolute: the worker resolves them itself.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href

// Extracts text from an image Blob/File entirely in the browser.
// Nothing is uploaded, and cacheMethod 'none' keeps tesseract from writing to IndexedDB.
export async function recognize(image, { language = 'eng', layout = PSM.AUTO, enhance = false } = {}, onProgress) {
  if (enhance) {
    onProgress?.({ status: 'enhancing image', progress: 0 })
    image = await enhanceImage(image)
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
    return tidyText(data.text)
  } finally {
    await worker.terminate()
  }
}
