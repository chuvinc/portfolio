import { expect, test } from 'vitest'
import { applyGlossary, parseGlossary } from './glossary'
import { cleanEntries, entriesFromText } from './postprocess'

// Entries with a given confidence per character; `low` maps a position to a lower confidence.
const sure = (text, low = {}) => Array.from(text, (ch, i) => ({ ch, conf: low[i] ?? 99 }))
const run = (entries, glossary) => applyGlossary(entries, parseGlossary(glossary))

test('parseGlossary reads words, rules, comments and blank lines', () => {
  const g = parseGlossary('# names\nワンピース\n\nロ → 口\nA -> B\nx\n')
  expect(g.terms.map((t) => t.join(''))).toEqual(['ワンピース']) // one-character words are ignored
  expect(g.rules).toEqual([
    { from: ['ロ'], to: ['口'] },
    { from: ['A'], to: ['B'] },
  ])
})

test('a word one unsure character off the glossary is corrected', () => {
  const { text, fixed } = run(sure('ワンビース', { 2: 40 }), 'ワンピース') // ビ read for ピ, unsure
  expect(text).toBe('ワンピース')
  expect(fixed).toBe(1)
})

test('a confident character is never overridden', () => {
  const { text, fixed } = run(sure('ワンビース'), 'ワンピース') // same mistake, but the engine was sure
  expect(text).toBe('ワンビース')
  expect(fixed).toBe(0)
})

test('two wrong characters in a short word are left alone', () => {
  const { text } = run(sure('ワビビース', { 1: 30, 2: 30 }), 'ワンピース')
  expect(text).toBe('ワビビース')
})

test('longer words may have two unsure characters fixed', () => {
  const { text, fixed } = run(sure('ワンビースの胃険', { 2: 40, 6: 40 }), 'ワンピースの冒険')
  expect(text).toBe('ワンピースの冒険')
  expect(fixed).toBe(2)
})

test('rules always apply, whatever the confidence', () => {
  const { text, fixed } = run(sure('ロの中'), 'ロ → 口\n')
  expect(text).toBe('口の中')
  expect(fixed).toBe(1)
})

test('a window containing a line break is never matched across lines', () => {
  const entries = [...sure('ワン'), { ch: '\n', conf: 100 }, ...sure('ビース', { 0: 30 })]
  expect(run(entries, 'ワンピース').fixed).toBe(0)
})

test('text that already equals another glossary word is not rewritten', () => {
  const { text } = run(sure('ワンビース', { 2: 40 }), 'ワンピース\nワンビース')
  expect(text).toBe('ワンビース')
})

test('the input entries are not modified', () => {
  const entries = sure('ワンビース', { 2: 40 })
  run(entries, 'ワンピース')
  expect(entries[2].ch).toBe('ビ')
})

test('cleanEntries drops spaces between Japanese characters and trims', () => {
  const cleaned = cleanEntries(entriesFromText(' 日 本 語 abc def\n'))
  expect(cleaned.map((e) => e.ch).join('')).toBe('日本語 abc def')
})

test('cleanEntries restores the long-vowel mark in vertical text only', () => {
  const read = (text, vertical) =>
    cleanEntries(entriesFromText(text), { vertical }).map((e) => e.ch).join('')
  expect(read('コ|ヒ|', true)).toBe('コーヒー')
  expect(read('コ|ヒ|', false)).toBe('コ|ヒ|')
  expect(read('a | b', true)).toBe('a | b') // not after kana
})
