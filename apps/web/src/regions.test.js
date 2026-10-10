import { expect, test } from 'vitest'
import { PSM } from 'tesseract.js'
import { cropPadding, findRegions, glyphSize, orderRegions, upscaleFor } from './regions'

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

// A vertical bar, like the long-vowel mark ー in vertical text.
const bar = (img, x, y, len = 10, thick = 2) => {
  for (let yy = y; yy < y + len; yy++) for (let xx = x; xx < x + thick; xx++) img.data[(yy * img.width + xx) * 4] = 0
}

test('strict rejects a group of wildly different blob sizes (artwork)', () => {
  const img = blank(600, 300)
  const sizes = [60, 12, 55, 10, 65, 14, 58, 9] // big and small shapes alternating
  let x = 20
  for (const s of sizes) {
    ring(img, x, 20, s)
    x += s + 5
  }
  expect(findRegions(img, 'strict')).toEqual([])
})

test('two columns split by a wide gap are one text area', () => {
  const img = blank(400, 300)
  column(img, 100, 40, 10)
  column(img, 100 + 10 + 14, 40, 10) // about 1.4 glyphs apart: past the glyph gap, within merge reach
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].direction).toBe('vertical')
  expect(regions[0].w).toBeGreaterThan(30) // spans both columns
})

test('boxes are padded so edge strokes are not clipped', () => {
  const img = blank(400, 200)
  row(img, 100, 80, 8)
  const [r] = findRegions(img)
  expect(r.x).toBeLessThan(100)
  expect(r.y).toBeLessThan(80)
  expect(r.x + r.w).toBeGreaterThan(100 + 7 * 13 + 10)
  expect(r.y + r.h).toBeGreaterThan(90)
})

test('a short column of glyphs is judged vertical, not horizontal', () => {
  const img = blank(300, 200)
  column(img, 100, 40, 3) // 3 glyphs: the box is only about 3:1, below the strip ratio
  const [r] = findRegions(img)
  expect(r.direction).toBe('vertical')
  expect(r.psm).toBe(PSM.SINGLE_BLOCK_VERT_TEXT)
})

test('a vertical bar (dash) among vertical glyphs stays part of the column', () => {
  const img = blank(300, 300)
  column(img, 100, 40, 3)
  bar(img, 104, 40 + 3 * 13, 10) // ー drawn as a vertical line, one glyph tall
  column(img, 100, 40 + 4 * 13, 2)
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].h).toBeGreaterThan(6 * 13)
})

test('a vertical block records where each column is', () => {
  const img = blank(400, 300)
  column(img, 100, 40, 10)
  column(img, 100 + 10 + 14, 40, 10)
  column(img, 100 + 2 * 24, 40, 10)
  const [r] = findRegions(img)
  expect(r.direction).toBe('vertical')
  expect(r.columns).toHaveLength(3)
  expect(r.columns.map((c) => c.x)).toEqual([100, 124, 148])
})

test('upscaleFor brings glyphs to the size Tesseract reads best, enlarging small text and shrinking big', () => {
  // a 3-column block, 90px of text across: each column is 30px, so it is enlarged a little
  expect(upscaleFor({ w: 90, h: 400, lines: 3, direction: 'vertical' })).toBeCloseTo(34 / 30)
  expect(upscaleFor({ w: 400, h: 90, lines: 3, direction: 'horizontal' })).toBeCloseTo(34 / 30)
  // a small line, 17px tall: doubled
  expect(upscaleFor({ w: 200, h: 17, lines: 1, direction: 'horizontal' })).toBe(2)
  // big text is shrunk instead of left alone: a 240px-wide column becomes 34px glyphs
  expect(upscaleFor({ w: 240, h: 1000, lines: 1, direction: 'vertical' })).toBeCloseTo(34 / 240)
  // the text's own extent is used when known, ignoring the padding around it
  expect(upscaleFor({ w: 120, h: 500, lines: 1, direction: 'vertical', core: { w: 60, h: 440 } })).toBeCloseTo(34 / 60)
  // never absurdly small or large
  expect(upscaleFor({ w: 5000, h: 9000, lines: 1, direction: 'vertical' })).toBe(0.1)
  expect(upscaleFor({ w: 4, h: 100, lines: 1, direction: 'vertical' })).toBe(4)
})

test('a busy page of large artwork does not swallow the text into one page-sized box', () => {
  const img = blank(800, 800)
  // Lots of large, scattered shapes (artwork) that would skew a size estimate.
  for (let i = 0; i < 25; i++) ring(img, 20 + (i % 5) * 150, 20 + Math.floor(i / 5) * 150, 40 + (i % 3) * 15)
  // Real text in a clear spot: one horizontal line and one vertical column.
  row(img, 40, 740, 12)
  column(img, 760, 100, 8)

  const regions = findRegions(img)
  expect(regions.length).toBeGreaterThanOrEqual(1)
  expect(regions.every((r) => r.w * r.h < 0.6 * 800 * 800)).toBe(true) // nothing covers the page
  const h = regions.find((r) => r.direction === 'horizontal')
  const v = regions.find((r) => r.direction === 'vertical')
  expect(h && h.y).toBeGreaterThan(700)
  expect(v && v.x).toBeGreaterThan(700)
})

test('sensitivity trades junk boxes for missed text', () => {
  const img = blank(600, 300)
  row(img, 20, 20, 3) // a very short run: only three glyphs
  ring(img, 300, 100, 10) // plus a lone glyph
  ring(img, 313, 100, 10)
  const count = (s) => findRegions(img, s).length
  expect(count('strict')).toBeLessThanOrEqual(count('normal'))
  expect(count('normal')).toBeLessThanOrEqual(count('loose'))
  expect(count('loose')).toBeGreaterThan(count('strict')) // loose finds the two-glyph pair strict ignores
})

// A glyph drawn in two pieces, like a kanji with a separate radical.
function pieces(img, x, y) {
  ring(img, x, y, 12)
  ring(img, x + 2, y + 14, 7)
}

test('vertical text whose glyphs split into pieces of different sizes is still found', () => {
  const img = blank(300, 400)
  for (let i = 0; i < 6; i++) pieces(img, 150, 40 + i * 26)
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].direction).toBe('vertical')
})

test('two short columns of two glyphs each join into one vertical text area', () => {
  const img = blank(300, 300)
  column(img, 200, 60, 2)
  column(img, 200 - 20, 60, 2) // the neighbouring column, to its left
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].direction).toBe('vertical')
})

test('furigana-sized marks beside a column are absorbed, not boxed on their own', () => {
  const img = blank(300, 400)
  column(img, 150, 40, 8)
  for (let i = 0; i < 10; i++) ring(img, 166, 40 + i * 9, 5) // small readings next to the column
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].h).toBeGreaterThan(8 * 13)
  expect(regions[0].w).toBeLessThan(30) // the box is the column, not the readings next to it
})

test('a page-sized junk group does not swallow real text inside its bounds', () => {
  const img = blank(600, 600)
  // A dense grid of large shapes covering most of the page. It forms one big group that is
  // later thrown out for being the whole page, with a clear hole in the middle...
  for (let gx = 0; gx < 16; gx++) {
    for (let gy = 0; gy < 16; gy++) {
      const x = 20 + gx * 35
      const y = 20 + gy * 35
      if (x > 245 && x < 385 && y > 60 && y < 320) continue // the hole
      ring(img, x, y, 30)
    }
  }
  // ...where a real column of text sits, inside the grid's bounding box.
  column(img, 300, 120, 6)

  const regions = findRegions(img)
  const col = regions.find((r) => r.direction === 'vertical' && r.x > 250 && r.x < 380)
  expect(col).toBeTruthy()
})

// ---- Regressions found by running the real app on rendered Japanese pages ----

// A small blob (a dakuten dot).
const dot = (img, x, y) => ring(img, x, y, 4)

test('a first glyph with dakuten dots is part of its column, not dropped as furigana', () => {
  // The real case: ど (a body plus two dots) above こ, whose first stroke is small and sits 31px away.
  const img = blank(300, 500)
  ring(img, 100, 20, 34) // the glyph body
  dot(img, 136, 20) // two tiny dots beside it
  dot(img, 142, 26)
  ring(img, 104, 85, 22) // the next glyph's first (small) stroke, a wide gap below
  for (let i = 0; i < 6; i++) ring(img, 100, 130 + i * 40, 34) // the rest of the column
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].y).toBeLessThan(20) // the box starts at the first glyph
  expect(regions[0].y + regions[0].h).toBeGreaterThan(130 + 5 * 40)
})

test('glyphSize follows the glyph bodies, so dakuten dots do not make a group look tiny', () => {
  const blob = (size) => ({ minX: 0, maxX: size - 1, minY: 0, maxY: size - 1 })
  // A body plus two dots: the median blob is 4px (looks like furigana), the glyph is 34px.
  expect(glyphSize({ members: [blob(34), blob(4), blob(4)] })).toBe(34)
  // Genuine furigana stays small.
  expect(glyphSize({ members: [blob(12), blob(11), blob(13), blob(12)] })).toBeLessThanOrEqual(13)
})

test('text filling a tightly cropped image is still found, not thrown out as "the page"', () => {
  const img = blank(70, 116)
  for (const x of [6, 30, 54]) column(img, x, 6, 8) // three columns that fill most of the image
  const regions = findRegions(img)
  expect(regions.length).toBeGreaterThanOrEqual(1)
  for (const x of [6, 30, 54]) {
    expect(regions.some((r) => r.x <= x && r.x + r.w >= x + 10)).toBe(true) // every column is inside a box
  }
})

test('glyphs with wide gaps between them (single strokes) still form one line', () => {
  const img = blank(300, 60)
  for (let i = 0; i < 8; i++) ring(img, 10 + i * 26, 20, 12) // 14px gaps: wider than the linking reach
  const regions = findRegions(img)
  expect(regions).toHaveLength(1)
  expect(regions[0].direction).toBe('horizontal')
  expect(regions[0].w).toBeGreaterThan(8 * 20)
})

test('a vertical block of several columns reports its columns', () => {
  const img = blank(120, 200)
  for (const x of [10, 34, 58]) column(img, x, 10, 8)
  const [region] = findRegions(img)
  expect(region.direction).toBe('vertical')
  expect(region.columns).toHaveLength(3)
  expect(region.lines).toBeGreaterThanOrEqual(3)
})

test('crop padding follows the short side, so a tall column does not reach its neighbour', () => {
  expect(cropPadding(81, 910)).toBeLessThanOrEqual(8)
  expect(cropPadding(910, 81)).toBeLessThanOrEqual(8)
  expect(cropPadding(100, 100)).toBe(7)
})

test('screentone dots are not text, however regular they are', () => {
  const img = blank(300, 300)
  for (let y = 10; y < 290; y += 6) for (let x = 10; x < 290; x += 6) ring(img, x, y, 3) // a grid of tiny dots
  expect(findRegions(img)).toEqual([])
})
