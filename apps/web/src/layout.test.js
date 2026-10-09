import { expect, test } from 'vitest'
import { PSM } from 'tesseract.js'
import { analyzeInk } from './layout'

// Builds a white binarized image and lets the caller draw black "ink" rectangles.
function draw(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) data[(y * width + x) * 4] = 0
    }
  }
  return { data, width, height }
}

// A line of "characters": 6px glyphs with 3px gaps between them.
const hLine = (x0, x1, y, thick = 8) => {
  const out = []
  for (let x = x0; x + 6 <= x1; x += 9) out.push([x, y, x + 6, y + thick])
  return out
}
const vLine = (x, y0, y1, thick = 8) => {
  const out = []
  for (let y = y0; y + 6 <= y1; y += 9) out.push([x, y, x + thick, y + 6])
  return out
}

test('one horizontal line of text is a single line', () => {
  const img = draw(400, 100, hLine(20, 380, 40))
  expect(analyzeInk(img)).toMatchObject({ direction: 'horizontal', lines: 1, psm: PSM.SINGLE_LINE })
})

test('stacked horizontal lines are one block', () => {
  const rects = [30, 52, 74, 96].flatMap((y) => hLine(20, 380, y))
  const img = draw(400, 140, rects)
  expect(analyzeInk(img)).toMatchObject({ direction: 'horizontal', lines: 4, psm: PSM.SINGLE_BLOCK })
})

test('side-by-side blocks of lines are left to automatic layout', () => {
  const rects = [30, 52, 74].flatMap((y) => [...hLine(20, 170, y), ...hLine(240, 390, y)])
  const img = draw(410, 120, rects)
  expect(analyzeInk(img).psm).toBe(PSM.AUTO)
})

test('side-by-side vertical columns are vertical text', () => {
  const rects = [40, 62, 84, 106].flatMap((x) => vLine(x, 20, 380))
  const img = draw(150, 400, rects)
  expect(analyzeInk(img)).toMatchObject({ direction: 'vertical', psm: PSM.SINGLE_BLOCK_VERT_TEXT })
})

test('a blank image falls back to automatic', () => {
  expect(analyzeInk(draw(50, 50, [])).psm).toBe(PSM.AUTO)
})
