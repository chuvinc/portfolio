import { expect, test } from 'vitest'
import { fixVerticalDashes, languageFor, tidyText } from './languages'

test('tidyText removes spaces between Japanese characters only', () => {
  expect(tidyText('日 本 語 の テ キ ス ト')).toBe('日本語のテキスト')
  expect(tidyText('Hello 世 界 world')).toBe('Hello 世界 world')
  expect(tidyText('plain english text')).toBe('plain english text')
})

test('languageFor swaps Japanese models to match text direction', () => {
  expect(languageFor('jpn', 'vertical')).toBe('jpn_vert')
  expect(languageFor('jpn_vert', 'horizontal')).toBe('jpn')
  expect(languageFor('eng', 'vertical')).toBe('eng')
})

test('fixVerticalDashes turns stray bars after kana into the long-vowel mark', () => {
  expect(fixVerticalDashes('コ|ヒ|')).toBe('コーヒー')
  expect(fixVerticalDashes('ラメlン')).toBe('ラメーン')
  expect(fixVerticalDashes('a | b')).toBe('a | b') // not after kana: untouched
})
