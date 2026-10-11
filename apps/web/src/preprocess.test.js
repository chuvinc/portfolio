import { expect, test } from 'vitest'
import { adjustContrast, binarize, isolateInkPixels, meanBrightness, normalizeBackgroundPixels } from './preprocess'

// Builds RGBA pixel data from a list of gray values.
const image = (grays) => ({
  width: grays.length,
  height: 1,
  data: new Uint8ClampedArray(grays.flatMap((g) => [g, g, g, 255])),
})
const values = (img) => Array.from({ length: img.width }, (_, i) => img.data[i * 4])

function gradientImage() {
  const width = 161
  const height = 61
  return {
    width,
    height,
    data: new Uint8ClampedArray(Array.from({ length: width * height }, (_, index) => {
      const value = Math.round(30 + (index % width) * 195 / (width - 1))
      return [value, value, value, 255]
    }).flat()),
  }
}

test('local normalization removes a smooth gradient without inventing text', () => {
  for (const mode of ['dark', 'light']) {
    const img = gradientImage()
    normalizeBackgroundPixels(img, mode)
    expect(img.data.every((value) => value === 255)).toBe(true)
  }
})

test('local normalization preserves thin fills and rejects opposite outlines on gradients', () => {
  for (const mode of ['dark', 'light']) {
    const img = gradientImage()
    const fill = mode === 'dark' ? 0 : 255
    const outline = 255 - fill
    const put = (column, row, value) => img.data.set([value, value, value, 255], (row * img.width + column) * 4)
    for (const column of [35, 125]) {
      for (let row = 20; row <= 40; row++) {
        put(column - 1, row, outline)
        put(column, row, fill)
        put(column + 1, row, outline)
      }
      put(column, 10, fill)
    }
    normalizeBackgroundPixels(img, mode)
    for (const column of [35, 125]) {
      expect(img.data[(30 * img.width + column) * 4]).toBe(0)
      expect(img.data[(10 * img.width + column) * 4]).toBe(0)
      expect(img.data[(30 * img.width + column - 1) * 4]).toBe(255)
      expect(img.data[(30 * img.width + column + 1) * 4]).toBe(255)
    }
  }
})

test('local normalization handles tiny uniform crops without false ink', () => {
  const img = image([128])
  normalizeBackgroundPixels(img, 'dark')
  expect(values(img)).toEqual([255])
})

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

test('meanBrightness averages the pixels', () => {
  expect(meanBrightness(image([0, 100, 200]))).toBeCloseTo(100)
})

test('adjustContrast pivots on the average brightness, darkening text and lightening paper', () => {
  // A faded page: light-grey paper (230) with grey text (170). Mean is mostly paper.
  const img = image([230, 230, 230, 230, 170])
  adjustContrast(img, 2)
  const [paper, , , , text] = values(img)
  expect(paper).toBeGreaterThan(230) // lighter
  expect(text).toBeLessThan(170) // darker
})

test('a fixed mid-gray pivot would wipe out a faded page, the mean pivot does not', () => {
  const img = image([230, 230, 230, 230, 170])
  adjustContrast(img, 3)
  expect(values(img)[4]).toBeLessThan(values(img)[0]) // text still darker than paper
})

test('adjustContrast with factor 1 changes nothing, and values stay within 0-255', () => {
  const img = image([10, 128, 240])
  adjustContrast(img, 1)
  expect(values(img)).toEqual([10, 128, 240])
  adjustContrast(img, 10)
  expect(Math.min(...values(img))).toBeGreaterThanOrEqual(0)
  expect(Math.max(...values(img))).toBeLessThanOrEqual(255)
})

test('isolateInkPixels keeps only the darkest pixels for black text with a white outline', () => {
  // black fill (0), white outline (255), grey background (128)
  const img = image([128, 255, 0, 255, 128, 128, 0, 0])
  isolateInkPixels(img, 'dark')
  expect(values(img)).toEqual([255, 255, 0, 255, 255, 255, 0, 0]) // only the black pixels are ink
})

test('isolateInkPixels keeps only the lightest pixels for white text with a black outline', () => {
  // white fill (255), black outline (0), grey background (128)
  const img = image([128, 0, 255, 0, 128, 128, 255, 255])
  isolateInkPixels(img, 'light')
  expect(values(img)).toEqual([255, 255, 0, 255, 255, 255, 0, 0])
})
