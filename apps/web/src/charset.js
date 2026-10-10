// The characters the Japanese models may output. Left unrestricted, Tesseract answers things it
// can't read (screentone, hatching, a mis-chosen direction) with Latin letters, digits and symbols;
// restricting it forces every guess to be a Japanese character, which keeps the output roughly
// one character per glyph. In testing it removed all non-Japanese junk and cost under a point of
// accuracy on correct reads.

const EXTRA_KANA = 'ー・ゝゞヽヾヶ々〆'
const PUNCTUATION = '、。，．？！：；「」『』（）【】〈〉《》〔〕…‥〜～―♪※★☆♥'
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,:;-\'"()'

// Every kanji in JIS X 0208 (levels 1 and 2: about 6,300, which covers everything in ordinary
// printing), read from the encoding table the browser already has.
function jisKanji() {
  const decoder = new TextDecoder('shift_jis')
  const out = new Set()
  for (let lead = 0x88; lead <= 0xea; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue
      const ch = decoder.decode(Uint8Array.of(lead, trail))
      const cp = ch.codePointAt(0)
      if (ch.length === 1 && cp >= 0x4e00 && cp <= 0x9fff) out.add(ch)
    }
  }
  return [...out]
}

function kana() {
  const out = []
  for (let cp = 0x3041; cp <= 0x3096; cp++) out.push(String.fromCodePoint(cp)) // hiragana
  for (let cp = 0x30a1; cp <= 0x30fa; cp++) out.push(String.fromCodePoint(cp)) // katakana
  return out
}

const cache = new Map()

// The allowed-character string for Tesseract's `tessedit_char_whitelist`. `allowLatin` adds
// English letters, digits and basic punctuation, for pages that really contain them.
export function japaneseWhitelist({ allowLatin = false } = {}) {
  const key = String(allowLatin)
  if (!cache.has(key)) {
    const chars = [...kana(), ...EXTRA_KANA, ...PUNCTUATION, ...jisKanji()]
    if (allowLatin) chars.push(...LATIN)
    cache.set(key, [...new Set(chars)].join(''))
  }
  return cache.get(key)
}
