import { beforeEach, expect, test, vi } from 'vitest'

const crops = []
const confidence = {} // what the fake engine reports per model
const attempts = [] // models tried, in order
const modes = [] // [model, layout mode] for every read
const params = [] // [model, all parameters] for every read
const variantConf = {} // confidence override when the crop was isolated ('dark' / 'light')

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
// A contrast boost tags the crop so the test can see it was applied; 1 (no change) passes through.
vi.mock('./preprocess', () => ({
  contrastImage: vi.fn(async (image, factor) => (factor > 1 ? `${image}+contrast${factor}` : image)),
  isolateInk: vi.fn(async (image, mode) => `${image}+${mode}`),
}))
vi.mock('tesseract.js', () => ({
  PSM: { AUTO: '3', SINGLE_BLOCK: '6', SINGLE_COLUMN: '4', SINGLE_LINE: '7', SPARSE_TEXT: '11', SINGLE_BLOCK_VERT_TEXT: '5' },
  createWorker: vi.fn(async (lang) => ({
    setParameters: vi.fn(async (p) => {
      modes.push([lang, p.tessedit_pageseg_mode])
      params.push([lang, p])
    }),
    // Echoes the model and crop so the test can see what was read, and in what order.
    recognize: vi.fn(async (crop) => {
      attempts.push(lang)
      const variant = ['dark', 'light'].find((m) => String(crop).includes(`+${m}`))
      return { data: { text: `[${lang}:${crop}]`, confidence: variant && variantConf[variant] !== undefined ? variantConf[variant] : confidence[lang] } }
    }),
    terminate: vi.fn(),
  })),
}))

const { readRegions, chooseDirection, expectedGlyphs, plausibleConfidence, findTextRegions } = await import('./ocr')

// What the real models do (measured on rendered text): on vertical text the horizontal model is
// plainly unsure; on horizontal text the vertical model is confidently wrong.
const onVerticalText = () => Object.assign(confidence, { jpn_vert: 90, jpn: 0, eng: 85 })
const onHorizontalText = () => Object.assign(confidence, { jpn_vert: 83, jpn: 90, eng: 85 })

beforeEach(() => {
  crops.length = 0
  attempts.length = 0
  modes.length = 0
  params.length = 0
  for (const k of Object.keys(variantConf)) delete variantConf[k]
  onVerticalText()
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
  expect(result.language).toBe('jpn_vert')
  expect(crops.filter((c) => c.h === 300 && c.y === 40)).toHaveLength(4) // 3 columns + the horizontal try
})

test('Japanese is read both ways, so confident vertical gibberish cannot win by default', async () => {
  onHorizontalText() // the vertical model is 83% sure of nonsense; the horizontal one is 90% sure of the truth
  const result = await read(horizontalLine)
  expect(attempts.sort()).toEqual(['jpn', 'jpn_vert'])
  expect(result.text).toBe('[jpn:crop@x=10]')
  expect(result.language).toBe('jpn')
})

test('vertical text wins when the horizontal model is clearly lost', async () => {
  const result = await read({ ...verticalBlock, columns: undefined })
  expect(result.language).toBe('jpn_vert')
})

test('a close call goes to the shape of the text', async () => {
  Object.assign(confidence, { jpn_vert: 70, jpn: 62 })
  expect((await read({ ...horizontalLine, direction: 'vertical' })).language).toBe('jpn_vert')
  expect((await read({ ...horizontalLine, direction: 'horizontal' })).language).toBe('jpn')
})

test('a clear confidence win beats the shape of the text', async () => {
  Object.assign(confidence, { jpn_vert: 95, jpn: 20 })
  expect((await read({ ...horizontalLine, direction: 'horizontal' })).language).toBe('jpn_vert')
})

test('chooseDirection: the vertical read needs to be clearly better', () => {
  expect(chooseDirection({ confidence: 91 }, { confidence: 75 })).toBe('vertical') // 16 ahead
  expect(chooseDirection({ confidence: 90 }, { confidence: 75 })).toBe('horizontal') // 15 ahead: not enough
  expect(chooseDirection({ confidence: 50 }, { confidence: 90 })).toBe('horizontal')
  expect(chooseDirection({ confidence: 80 }, { confidence: 80 }, 'vertical')).toBe('vertical')
})

test('other languages are read once with their own model', async () => {
  const result = await read(horizontalLine, 'eng')
  expect(attempts).toEqual(['eng'])
  expect(result.text).toBe('[eng:crop@x=10]')
})

test('the horizontal read uses the line mode for one line and the automatic mode for blocks', async () => {
  await read(horizontalLine)
  expect(modes).toContainEqual(['jpn', '7'])

  modes.length = 0
  await read(verticalBlock) // several columns: "single block" mode would give confident gibberish
  expect(modes).toContainEqual(['jpn', '3'])
  expect(modes).not.toContainEqual(['jpn', '6'])
})

test('Japanese reads are limited to Japanese characters, and other languages are not', async () => {
  await read(horizontalLine)
  for (const [lang, p] of params.filter(([l]) => l !== 'eng')) {
    expect(p.tessedit_char_whitelist, lang).toContain('呪')
    expect(p.tessedit_char_whitelist, lang).not.toContain('A')
  }

  params.length = 0
  await readRegions(new Blob(['x']), [horizontalLine], { language: 'jpn', allowLatin: true })
  expect(params[0][1].tessedit_char_whitelist).toContain('A') // opted in to English letters

  params.length = 0
  await read(horizontalLine, 'eng')
  expect(params[0][1].tessedit_char_whitelist).toBeUndefined()
})

test('expectedGlyphs estimates how many characters a box holds', () => {
  // A 1-column box 24 wide and 240 tall: about 10 characters.
  expect(expectedGlyphs({ direction: 'vertical', lines: 1, core: { w: 24, h: 240 } }, 'vertical')).toBeCloseTo(10)
  // 3 columns, each 20 wide, 200 tall: 10 per column.
  expect(expectedGlyphs({ direction: 'vertical', lines: 3, core: { w: 120, h: 200 }, columns: [{ w: 20 }, { w: 20 }, { w: 20 }] }, 'vertical')).toBeCloseTo(30)
  // A horizontal line 300 wide, 30 tall: about 10 characters.
  expect(expectedGlyphs({ direction: 'horizontal', lines: 1, core: { w: 300, h: 30 } }, 'horizontal')).toBeCloseTo(10)
  // Read the other way from the box's shape, it counts as one line or column.
  expect(expectedGlyphs({ direction: 'vertical', lines: 3, core: { w: 90, h: 300 } }, 'horizontal')).toBe(1) // never less than one
})

test('a read with far more characters than the box can hold loses confidence', () => {
  expect(plausibleConfidence(90, 10, 10)).toBe(90) // fits
  expect(plausibleConfidence(90, 16, 10)).toBe(90) // up to 1.6x is tolerated
  expect(plausibleConfidence(90, 160, 10)).toBeCloseTo(9) // ten times too many
})

test('hallucinated floods come back with low confidence', async () => {
  // A tiny box that can hold about 2 characters, but the engine returned a long string.
  const tiny = { id: 3, x: 0, y: 0, w: 20, h: 40, core: { w: 20, h: 40 }, direction: 'vertical', lines: 1, psm: '5' }
  const result = await read(tiny)
  expect(result.confidence).toBeLessThan(40)
})

test('expectedGlyphs uses the glyph size, so a miscounted column count cannot hide a good read', () => {
  // A 3-column block reported as 1 column (113 x 413 px of text, glyphs about 35 px): holds ~38.
  const block = { direction: 'vertical', lines: 1, core: { w: 113, h: 413 }, glyph: 35 }
  expect(expectedGlyphs(block, 'vertical')).toBeGreaterThan(35)
  // 41 characters read from it is fine and keeps its confidence.
  expect(plausibleConfidence(90, 41, expectedGlyphs(block, 'vertical'))).toBe(90)
  // Without the glyph size, the same block would look like it holds about 4 characters.
  expect(expectedGlyphs({ ...block, glyph: undefined }, 'vertical')).toBeLessThan(5)
})

test('the contrast setting is applied to each crop before it is read, and 100% leaves it alone', async () => {
  const plain = await read(horizontalLine)
  expect(plain.text).not.toContain('contrast')

  const boosted = await readRegions(new Blob(['x']), [horizontalLine], { language: 'jpn', contrast: 200 })
  expect(boosted[0].text).toContain('+contrast2')
})

test('detection sees the contrast-adjusted picture too', async () => {
  const { detectRegions } = await import('./regions')
  detectRegions.mockResolvedValue({ regions: [], width: 10, height: 10 })
  await findTextRegions('page', 'normal', 200)
  expect(detectRegions).toHaveBeenLastCalledWith('page+contrast2', 'normal')
  await findTextRegions('page', 'normal')
  expect(detectRegions).toHaveBeenLastCalledWith('page', 'normal')
})

test('a weak read is retried with the ink isolated, and the most confident read wins', async () => {
  Object.assign(confidence, { jpn_vert: 20, jpn: 10 }) // the plain read is hopeless (outlined text)
  variantConf.dark = 88
  variantConf.light = 30
  const result = await read(horizontalLine)
  expect(result.ink).toBe('dark')
  expect(result.text).toContain('+dark')
  expect(result.confidence).toBeGreaterThan(20) // better than the plain read's 20
})

test('a confident read is not retried', async () => {
  const result = await read(horizontalLine) // vertical text: 90% sure
  expect(result.ink).toBeUndefined()
  expect(attempts).toHaveLength(2) // one read per direction, nothing more
})

test("a region's own contrast overrides the page's", async () => {
  const own = await readRegions(new Blob(['x']), [{ ...horizontalLine, contrast: 250 }], { language: 'jpn', contrast: 100 })
  expect(own[0].text).toContain('+contrast2.5')
  const page = await readRegions(new Blob(['x']), [horizontalLine], { language: 'jpn', contrast: 150 })
  expect(page[0].text).toContain('+contrast1.5')
})
