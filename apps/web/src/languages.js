// Languages offered for OCR. Each `id` is a Tesseract language code, or several
// joined with '+' to load them together. Each code's data file is copied into
// public/ocr/lang by scripts/copy-ocr-assets.mjs from @tesseract.js-data/<code>.
export const LANGUAGES = [
  { id: 'eng', label: 'English' },
  { id: 'jpn', label: 'Japanese' },
  { id: 'jpn_vert', label: 'Japanese (vertical text)' },
  { id: 'jpn+jpn_vert', label: 'Japanese (mixed horizontal + vertical)' },
]

// Tesseract puts spaces between Japanese characters; drop them.
const CJK = '[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]'
const CJK_GAP = new RegExp(`(?<=${CJK})[ \t]+(?=${CJK})`, 'g')

export function tidyText(text) {
  return text.replace(CJK_GAP, '')
}

// Japanese has separate horizontal and vertical models; pick the one that matches
// the detected text direction. Other languages are unchanged.
export function languageFor(id, direction) {
  if (direction === 'vertical' && id === 'jpn') return 'jpn_vert'
  if (direction === 'horizontal' && id === 'jpn_vert') return 'jpn'
  return id
}

// Pages in these languages are laid out right to left when text is vertical.
export const readsRightToLeft = (id) => id.startsWith('jpn')
