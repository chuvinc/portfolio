import { expect, test } from 'vitest'
import { PSM } from 'tesseract.js'
import { findRegions, orderRegions } from './regions'

function blank(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height }
}

// A hollow 10px "glyph", like a stroke outline, so ink density stays text-like.
function ring(img, x0, y0, size = 10) {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const edge = x === x0 || x === x0 + size - 1 || y === y0 || y === y0 + size - 1
      if (edge) img.data[(y * img.width + x) * 4] = 0
    }
  }
}

const row = (img, x, y, n) => Array.from({ length: n }, (_, i) => ring(img, x + i * 13, y))
const column = (img, x, y, n) => Array.from({ length: n }, (_, i) => ring(img, x, y + i * 13))

test('finds a horizontal line and a vertical column as separate regions', () => {
  const img = blank(500, 300)
  row(img, 20, 20, 10) // horizontal line, top left
  column(img, 400, 40, 10) // vertical column, right side
  const regions = findRegions(img)

  expect(regions).toHaveLength(2)
  const h = regions.find((r) => r.direction === 'horizontal')
  const v = regions.find((r) => r.direction === 'vertical')
  expect(h.psm).toBe(PSM.SINGLE_LINE)
  expect(v.psm).toBe(PSM.SINGLE_BLOCK_VERT_TEXT)
  expect(v.x).toBeGreaterThan(h.x + h.w) // they were not merged
})

test('neighbouring lines merge into one block', () => {
  const img = blank(300, 200)
  for (const y of [20, 36, 52]) row(img, 20, y, 12)
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0]).toMatchObject({ direction: 'horizontal', lines: 3, psm: PSM.SINGLE_BLOCK })
})

test('a solid blob (picture) and lone specks are not text', () => {
  const img = blank(300, 300)
  for (let y = 50; y < 200; y++) for (let x = 50; x < 200; x++) img.data[(y * 300 + x) * 4] = 0
  img.data[(10 * 300 + 10) * 4] = 0
  expect(findRegions(img)).toEqual([])
})

test('orderRegions reads rows top to bottom, right to left when asked', () => {
  const regions = [
    { id: 'a', x: 10, y: 10 },
    { id: 'b', x: 400, y: 20 },
    { id: 'c', x: 200, y: 500 },
  ]
  expect(orderRegions(regions, 1000, true).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  expect(orderRegions(regions, 1000, false).map((r) => r.id)).toEqual(['a', 'b', 'c'])
})
