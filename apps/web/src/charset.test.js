import { expect, test } from 'vitest'
import { japaneseWhitelist } from './charset'

test('the Japanese whitelist has kana, common kanji, and Japanese punctuation', () => {
  const set = new Set(japaneseWhitelist())
  for (const ch of 'あいうえおアイウエオーン呪術廻戦吾輩猫東京都「」。、！？') expect(set.has(ch), ch).toBe(true)
  expect(set.size).toBeGreaterThan(6000) // hiragana + katakana + both JIS kanji levels
})

test('by default it has no Latin letters, digits or ASCII symbols', () => {
  const set = new Set(japaneseWhitelist())
  for (const ch of 'AZaz09|[]@#$%&*+=<>/\\_~`') expect(set.has(ch), ch).toBe(false)
})

test('allowLatin adds letters, digits and basic punctuation', () => {
  const set = new Set(japaneseWhitelist({ allowLatin: true }))
  for (const ch of 'AZaz09!?.,') expect(set.has(ch), ch).toBe(true)
  expect(set.has('|')).toBe(false) // still no stray symbols
  expect(set.has('呪')).toBe(true)
})
