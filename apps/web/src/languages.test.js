import { expect, test } from 'vitest'
import { LANGUAGES, readsRightToLeft } from './languages'

test('Japanese is the default language and carries both of its models', () => {
  expect(LANGUAGES[0]).toMatchObject({ id: 'jpn', models: ['jpn', 'jpn_vert'] })
})

test('Japanese reads right to left', () => {
  expect(readsRightToLeft('jpn')).toBe(true)
  expect(readsRightToLeft('eng')).toBe(false)
})
