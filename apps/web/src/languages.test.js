import { expect, test } from 'vitest'
import { fixVerticalDashes, tidyText } from './languages'

test('tidyText removes spaces between Japanese characters only', () => {
  expect(tidyText('日 本 語 の テ キ ス ト')).toBe('日本語のテキスト')
  expect(tidyText('Hello 世 界 world')).toBe('Hello 世界 world')
  expect(tidyText('plain english text')).toBe('plain english text')
})


test('fixVerticalDashes turns stray bars after kana into the long-vowel mark', () => {
  expect(fixVerticalDashes('コ|ヒ|')).toBe('コーヒー')
  expect(fixVerticalDashes('ラメlン')).toBe('ラメーン')
  expect(fixVerticalDashes('a | b')).toBe('a | b') // not after kana: untouched
})
