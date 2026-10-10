// Languages offered for OCR. `id` is the language the user picks; `models` are the Tesseract
// data files it needs, copied into public/ocr/lang by scripts/copy-ocr-assets.mjs from
// @tesseract.js-data/<model>. Japanese has separate horizontal and vertical models, and the
// reader chooses between them itself.
export const LANGUAGES = [
  { id: 'eng', label: 'English', models: ['eng'] },
  { id: 'jpn', label: 'Japanese', models: ['jpn', 'jpn_vert'] },
]

// Tesseract puts spaces between Japanese characters; drop them.
const CJK = '[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]'
const CJK_GAP = new RegExp(`(?<=${CJK})[ \t]+(?=${CJK})`, 'g')

export function tidyText(text) {
  return text.replace(CJK_GAP, '')
}

// Pages in these languages are laid out right to left when text is vertical.
export const readsRightToLeft = (id) => id.startsWith('jpn')

// In vertical Japanese the long-vowel mark ー (and a dash) is drawn as a vertical line,
// which Tesseract often reads as a bar or letter after a kana. Restore it.
const KANA = '[\u3040-\u30ff]'
const STRAY_BAR = new RegExp(`(?<=${KANA})[|｜丨¦lI]`, 'g')

export function fixVerticalDashes(text) {
  return text.replace(STRAY_BAR, 'ー')
}
