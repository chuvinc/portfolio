// Languages offered for OCR. Each `id` is a Tesseract language code, and its
// data file is copied into public/ocr/lang by scripts/copy-ocr-assets.mjs
// from the matching @tesseract.js-data/<id> package.
export const LANGUAGES = [
  { id: 'eng', label: 'English' },
  { id: 'jpn', label: 'Japanese' },
  { id: 'jpn_vert', label: 'Japanese (vertical text)' },
]

// Tesseract puts spaces between Japanese characters; drop them.
const CJK = '[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]'
const CJK_GAP = new RegExp(`(?<=${CJK})[ \t]+(?=${CJK})`, 'g')

export function tidyText(text) {
  return text.replace(CJK_GAP, '')
}
