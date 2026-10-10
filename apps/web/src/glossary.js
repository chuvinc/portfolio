import { entriesToText } from './postprocess'

// A glossary is plain text, one entry per line:
//   ワンピース       a word or name you expect to see
//   ロ → 口         a correction rule: always replace the left side with the right
//   # a comment line
// Words fix near-misses: if the text is one character off a glossary word, and the engine
// was unsure about that character, the glossary spelling wins. Rules always apply.

const UNSURE = 85 // a character the engine is less sure of than this may be swapped
const UNSURE_SHORT = 60 // two-character words are riskier to "fix", so they need a lower bar

export function parseGlossary(text) {
  const terms = []
  const rules = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const arrow = line.match(/^(.*?)\s*(?:→|->|=>)\s*(.*)$/)
    if (arrow) {
      const from = Array.from(arrow[1].trim())
      if (from.length) rules.push({ from, to: Array.from(arrow[2].trim()) })
    } else {
      const chars = Array.from(line)
      if (chars.length >= 2) terms.push(chars)
    }
  }
  terms.sort((a, b) => b.length - a.length) // longest words first
  return { terms, rules }
}

// Applies a parsed glossary to entries (see postprocess.js). Returns { entries, text, fixed },
// where `fixed` counts the corrections made. The input is not modified.
export function applyGlossary(entries, { terms, rules }) {
  const out = entries.map((e) => ({ ...e }))
  let fixed = 0

  for (const { from, to } of rules) {
    for (let i = 0; i + from.length <= out.length; i++) {
      if (from.every((ch, k) => out[i + k].ch === ch)) {
        out.splice(i, from.length, ...to.map((ch) => ({ ch, conf: 100 })))
        fixed++
        i += Math.max(0, to.length - 1)
      }
    }
  }

  const known = new Set(terms.map((t) => t.join('')))
  for (const term of terms) {
    const allowed = term.length >= 6 ? 2 : 1
    const bar = term.length === 2 ? UNSURE_SHORT : UNSURE
    for (let i = 0; i + term.length <= out.length; i++) {
      const wrong = []
      let usable = true
      for (let k = 0; k < term.length && usable; k++) {
        const e = out[i + k]
        if (e.ch === '\n') usable = false
        else if (e.ch !== term[k]) {
          if (e.conf >= bar || wrong.length >= allowed) usable = false
          else wrong.push(k)
        }
      }
      if (!usable || wrong.length === 0) continue
      // Leave text that is already a different glossary word alone.
      if (known.has(out.slice(i, i + term.length).map((e) => e.ch).join(''))) continue
      for (const k of wrong) out[i + k] = { ch: term[k], conf: 100 }
      fixed += wrong.length
    }
  }

  return { entries: out, text: entriesToText(out), fixed }
}
