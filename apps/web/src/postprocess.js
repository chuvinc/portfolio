// OCR output is handled as "entries": one per character, { ch, conf }, where conf is the
// engine's 0-100 confidence in that character. Keeping confidence alongside each character
// lets later steps (dash fixing, glossary) change only the characters the engine was unsure of.

const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/
const KANA = /[\u3040-\u30ff]/
// In vertical Japanese the long-vowel mark ー (and a dash) is a vertical line, which
// Tesseract often reads as a bar or letter after a kana.
const STRAY_BARS = new Set(['|', '｜', '丨', '¦', 'l', 'I'])

export const entriesToText = (entries) => entries.map((e) => e.ch).join('')

export const entriesFromText = (text, conf = 100) => Array.from(text, (ch) => ({ ch, conf }))

// Builds entries from a tesseract.js result. Uses per-character confidence when the result
// has symbols, and the overall confidence for every character otherwise.
export function entriesFromData(data) {
  if (!data.blocks) return entriesFromText(data.text ?? '', data.confidence)
  const entries = []
  for (const block of data.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (entries.length && entries.at(-1).ch !== '\n') entries.push({ ch: ' ', conf: 100 })
          for (const symbol of word.symbols) {
            for (const ch of Array.from(symbol.text)) entries.push({ ch, conf: symbol.confidence })
          }
        }
        entries.push({ ch: '\n', conf: 100 })
      }
    }
  }
  return entries
}

const isBlank = (e) => e.ch === ' ' || e.ch === '\t' || e.ch === '\n'

// Drops spaces between Japanese characters (Tesseract puts them between "words"), repairs
// stray bars in vertical text, and trims blank space off both ends.
export function cleanEntries(entries, { vertical = false } = {}) {
  const out = []
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].ch === ' ' || entries[i].ch === '\t') {
      let j = i
      while (j < entries.length && (entries[j].ch === ' ' || entries[j].ch === '\t')) j++
      if (out.length && CJK.test(out.at(-1).ch) && j < entries.length && CJK.test(entries[j].ch)) {
        i = j - 1
        continue
      }
    }
    out.push(entries[i])
  }

  if (vertical) {
    for (let i = 1; i < out.length; i++) {
      if (STRAY_BARS.has(out[i].ch) && KANA.test(out[i - 1].ch)) out[i] = { ...out[i], ch: 'ー' }
    }
  }

  while (out.length && isBlank(out[0])) out.shift()
  while (out.length && isBlank(out.at(-1))) out.pop()
  return out
}
