import { expect, test } from 'vitest'
import { tidyText } from './languages'

test('tidyText removes spaces between Japanese characters only', () => {
  expect(tidyText('日 本 語 の テ キ ス ト')).toBe('日本語のテキスト')
  expect(tidyText('Hello 世 界 world')).toBe('Hello 世界 world')
  expect(tidyText('plain english text')).toBe('plain english text')
})
