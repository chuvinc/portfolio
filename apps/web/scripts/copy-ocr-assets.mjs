// Copies the Tesseract.js worker, WASM core and language data into
// public/ocr so the browser never has to fetch them from a third-party CDN.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { LANGUAGES } from '../src/languages.js'

const require = createRequire(import.meta.url)
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`))

const out = join(import.meta.dirname, '..', 'public', 'ocr')
mkdirSync(join(out, 'core'), { recursive: true })
mkdirSync(join(out, 'lang'), { recursive: true })

cpSync(join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js'))

// The browser build only loads the self-contained `.wasm.js` LSTM variants.
const coreDir = pkgDir('tesseract.js-core')
for (const file of readdirSync(coreDir)) {
  if (file.endsWith('-lstm.wasm.js')) cpSync(join(coreDir, file), join(out, 'core', file))
}

const codes = new Set(LANGUAGES.flatMap(({ models }) => models))
for (const id of codes) {
  cpSync(
    join(pkgDir(`@tesseract.js-data/${id}`), '4.0.0_best_int', `${id}.traineddata.gz`),
    join(out, 'lang', `${id}.traineddata.gz`),
  )
}
