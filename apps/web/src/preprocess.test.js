import { expect, test } from 'vitest'
import { binarize } from './preprocess'

// Builds RGBA pixel data from a list of gray values.
const image = (grays) => ({
  width: grays.length,
  height: 1,
  data: new Uint8ClampedArray(grays.flatMap((g) => [g, g, g, 255])),
})
const values = (img) => Array.from({ length: img.width }, (_, i) => img.data[i * 4])

test('binarize turns dark text on a light page into black on white', () => {
  const img = image([250, 250, 250, 250, 250, 20])
  binarize(img)
  expect(values(img)).toEqual([255, 255, 255, 255, 255, 0])
})

test('binarize inverts light text on a dark background', () => {
  const img = image([10, 10, 10, 10, 10, 240])
  binarize(img)
  expect(values(img)).toEqual([255, 255, 255, 255, 255, 0])
})
