// Languages offered for OCR. The first is the default: this tool is mainly for Japanese books
// and manga, so text is assumed to run in columns, top to bottom, right to left.
// `id` is the language the user picks; `models` are the Tesseract data files it needs, copied
// into public/ocr/lang by scripts/copy-ocr-assets.mjs from @tesseract.js-data/<model>.
// Japanese has separate horizontal and vertical models, and the reader chooses between them.
export const LANGUAGES = [
  { id: 'jpn', label: 'Japanese', models: ['jpn', 'jpn_vert'] },
]

// Pages in these languages are laid out right to left when text is vertical.
export const readsRightToLeft = (id) => id.startsWith('jpn')
