import { beforeEach, expect, test, vi } from 'vitest'

const crops = []
const confidence = { jpn_vert: 80, jpn: 90, eng: 85 } // what the fake engine reports per model
const attempts = [] // models tried, in order

vi.mock('./regions', () => ({
  cropRegion: vi.fn(async (_image, box) => {
    crops.push(box)
    return `crop@x=${box.x}`
  }),
  upscaleFor: () => 1,
  classifyRegion: vi.fn(),
  detectRegions: vi.fn(),
}))
vi.mock('./layout', () => ({ inferLayout: vi.fn() }))
vi.mock('tesseract.js', () => ({
  PSM: { AUTO: '3', SINGLE_BLOCK: '6', SINGLE_COLUMN: '4', SINGLE_LINE: '7', SPARSE_TEXT: '11', SINGLE_BLOCK_VERT_TEXT: '5' },
  createWorker: vi.fn(async (lang) => ({
    setParameters: vi.fn(),
    // Echoes the model and crop so the test can see what was read, and in what order.
    recognize: vi.fn(async (crop) => {
      attempts.push(lang)
      return { data: { text: `[${lang}:${crop}]`, confidence: confidence[lang] } }
    }),
    terminate: vi.fn(),
  })),
}))

const { readRegions } = await import('./ocr')

beforeEach(() => {
  crops.length = 0
  attempts.length = 0
  Object.assign(confidence, { jpn_vert: 80, jpn: 90, eng: 85 })
})

const verticalBlock = {
  id: 1,
  x: 90,
  y: 40,
  w: 100,
  h: 300,
  direction: 'vertical',
  lines: 3,
  psm: '5',
  columns: [
    { x: 100, w: 20 },
    { x: 130, w: 20 },
    { x: 160, w: 20 },
  ],
}
const horizontalLine = { id: 2, x: 10, y: 10, w: 200, h: 30, direction: 'horizontal', lines: 1, psm: '7' }
const read = (region, language = 'jpn') => readRegions(new Blob(['x']), [region], { language }).then(([r]) => r)

test('vertical blocks are read one column at a time, right to left', async () => {
  const result = await read(verticalBlock)
  expect(result.text).toBe('[jpn_vert:crop@x=155]\n[jpn_vert:crop@x=125]\n[jpn_vert:crop@x=95]') // rightmost first
  expect(result.confidence).toBe(80)
  expect(crops.every((c) => c.y === 40 && c.h === 300)).toBe(true) // full height each time
  expect(attempts).not.toContain('jpn') // confident enough: horizontal never tried
})

test('Japanese is assumed vertical first, even for a horizontal-looking region', async () => {
  const result = await read(horizontalLine)
  expect(attempts[0]).toBe('jpn_vert')
  expect(result.text).toBe('[jpn_vert:crop@x=10]')
})

test('falls back to horizontal when the vertical read is not confident, and keeps the better one', async () => {
  confidence.jpn_vert = 30
  const result = await read(horizontalLine)
  expect(attempts).toEqual(['jpn_vert', 'jpn'])
  expect(result.text).toBe('[jpn:crop@x=10]')
  expect(result.language).toBe('jpn')
})

test('keeps the vertical read if the horizontal one is even worse', async () => {
  confidence.jpn_vert = 50
  confidence.jpn = 20
  const result = await read(horizontalLine)
  expect(result.text).toBe('[jpn_vert:crop@x=10]')
})

test('other languages are read once with their own model', async () => {
  const result = await read(horizontalLine, 'eng')
  expect(attempts).toEqual(['eng'])
  expect(result.text).toBe('[eng:crop@x=10]')
})
