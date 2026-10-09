import { expect, test, vi } from 'vitest'

const crops = []
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
  PSM: { AUTO: '3', SINGLE_BLOCK: '6', SINGLE_COLUMN: '4', SINGLE_LINE: '7', SPARSE_TEXT: '11' },
  createWorker: vi.fn(async () => ({
    setParameters: vi.fn(),
    // Echoes which crop it was given so the test can see the reading order.
    recognize: vi.fn(async (crop) => ({ data: { text: `[${crop}]`, confidence: 80 } })),
    terminate: vi.fn(),
  })),
}))

const { readRegions } = await import('./ocr')

test('vertical blocks are read one column at a time, right to left', async () => {
  const region = {
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
  const [result] = await readRegions(new Blob(['x']), [region], { language: 'jpn' })

  expect(result.text).toBe('[crop@x=155]\n[crop@x=125]\n[crop@x=95]') // rightmost column first
  expect(result.confidence).toBe(80)
  expect(crops.every((c) => c.y === 40 && c.h === 300)).toBe(true) // full height each time
})

test('a region without columns is read in one pass', async () => {
  const region = { id: 2, x: 10, y: 10, w: 200, h: 30, direction: 'horizontal', lines: 1, psm: '7' }
  const [result] = await readRegions(new Blob(['x']), [region], { language: 'jpn' })
  expect(result.text).toBe('[crop@x=10]')
})
