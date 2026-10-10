import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OcrTool from './OcrTool'
import { readRegions, recognize } from './ocr'

vi.mock('./ocr', () => ({
  LAYOUTS: [
    { id: 'auto', label: 'Auto-detect' },
    { id: 'regions', label: 'Find text regions (mixed pages)' },
    { id: '3', label: 'Tesseract default' },
    { id: '7', label: 'A single line' },
  ],
  MIN_CONFIDENCE: 40,
  usesRegions: ({ layout }) => layout === 'regions',
  recognize: vi.fn(async () => ({ text: 'hello world', detected: null })),
  findTextRegions: vi.fn(async () => ({
    page: { width: 1000, height: 800 },
    regions: [
      { x: 100, y: 100, w: 200, h: 50, direction: 'horizontal', lines: 1, psm: '7' },
      { x: 700, y: 100, w: 60, h: 400, direction: 'vertical', lines: 1, psm: '5' },
    ],
  })),
  readRegions: vi.fn(async (_image, regions) =>
    regions.map((r) => {
      const text = `text ${r.id}`
      const confidence = r.id === 2 ? 20 : 90
      return { id: r.id, text, entries: Array.from(text, (ch) => ({ ch, conf: confidence })), confidence, language: 'eng' }
    }),
  ),
  classifyRegion: vi.fn(async () => ({ direction: 'horizontal', lines: 1, psm: '7' })),
}))

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

const pick = () => {
  const file = new File(['x'], 'shot.png', { type: 'image/png' })
  fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [file] } })
}

test('extracts text from a chosen image and clears everything', async () => {
  render(<OcrTool />)
  pick()

  fireEvent.click(await screen.findByText('Extract text'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').value).toBe('hello world'))

  fireEvent.click(screen.getByText('Clear'))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  expect(screen.queryByLabelText('Extracted text')).toBeNull()
  expect(screen.queryByAltText('Selected for text extraction')).toBeNull()
})

test('ignores non-image files', () => {
  render(<OcrTool />)
  const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
  fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [file] } })
  expect(screen.queryByText('Extract text')).toBeNull()
})

test('passes the chosen layout and enhance options to OCR, with Japanese as the language', async () => {
  render(<OcrTool />)
  pick()

  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: '7' } })
  fireEvent.click(screen.getByLabelText(/Enhance image/))
  fireEvent.click(screen.getByText('Extract text'))

  await waitFor(() =>
    expect(recognize).toHaveBeenCalledWith(expect.any(File), { language: 'jpn', layout: '7', enhance: true }, expect.any(Function)),
  )
})

test('pasting an image anywhere on the page loads it', async () => {
  render(<OcrTool />)
  const file = new File(['x'], 'clip.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  event.clipboardData = { files: [file] }
  document.body.dispatchEvent(event)

  expect(await screen.findByAltText('Selected for text extraction')).toBeTruthy()
})

// Maps pixel coordinates 1:1 onto the mocked 1000x800 page.
function overlay() {
  const el = document.querySelector('.overlay')
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
  return el
}
const clickAt = (el, x, y) => fireEvent.click(el, { clientX: x, clientY: y })

async function findRegionsMode() {
  render(<OcrTool />)
  pick()
  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: 'regions' } })
  fireEvent.click(screen.getByText('Find text regions'))
  await screen.findByText(/all switched off/)
  return overlay()
}

test('region mode: boxes start off, clicking turns them on, only those are read', async () => {
  const el = await findRegionsMode()
  const boxes = () => [...document.querySelectorAll('.region')]
  expect(boxes()).toHaveLength(2)
  expect(boxes().every((b) => b.classList.contains('off'))).toBe(true)
  expect(screen.getByText('Read 0 regions')).toBeTruthy()

  clickAt(el, 150, 120) // the horizontal box
  expect(boxes().filter((b) => b.classList.contains('on'))).toHaveLength(1)
  fireEvent.click(screen.getByText('Read 1 region'))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').value).toBe('text 1'))
  expect(readRegions.mock.calls.at(-1)[1]).toHaveLength(1)
})

test('region mode: low-confidence regions are hidden until asked for', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByText('All on'))
  fireEvent.click(screen.getByText('Read 2 regions'))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').value).toBe('text 1'))
  fireEvent.click(screen.getByLabelText(/Include regions Tesseract was unsure about/))
  expect(screen.getByLabelText('Extracted text').value).toContain('text 2')
})

test('region mode: dragging over an existing box draws a new one instead of toggling', async () => {
  const el = await findRegionsMode()
  fireEvent.pointerDown(el, { clientX: 710, clientY: 200 }) // inside the vertical box
  fireEvent.pointerMove(el, { clientX: 745, clientY: 260 })
  fireEvent.pointerUp(el, { clientX: 745, clientY: 260 })
  clickAt(el, 745, 260) // the click that follows a drag must not toggle anything

  await waitFor(() => expect(document.querySelectorAll('.region')).toHaveLength(3))
  expect(document.querySelectorAll('.region.on')).toHaveLength(1) // only the new box is on
})

test('region mode: "Read all" switches every box on and hides the unsure ones', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByText('Read all (hide unsure)'))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').value).toBe('text 1'))
  const kinds = [...document.querySelectorAll('.region')].map((b) => (b.classList.contains('low') ? 'low' : 'on'))
  expect(kinds.sort()).toEqual(['low', 'on']) // region 2 was only 20% sure, so it is hidden
})

test('the language dropdown offers Japanese', () => {
  render(<OcrTool />)
  pick()
  const options = [...screen.getByLabelText(/Language/).querySelectorAll('option')].map((o) => o.textContent)
  expect(options).toEqual(['Japanese'])
})

test('the glossary corrects the output live and is remembered in this browser', async () => {
  localStorage.clear()
  const first = render(<OcrTool />)
  pick()
  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: 'regions' } })
  fireEvent.click(screen.getByText('Find text regions'))
  await screen.findByText(/all switched off/)
  fireEvent.click(screen.getByText('Read all (hide unsure)'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').value).toBe('text 1'))

  // A rule applies to the text already read, with no new OCR run.
  fireEvent.change(screen.getByLabelText('Glossary'), { target: { value: 'text → TEXT' } })
  expect(screen.getByLabelText('Extracted text').value).toBe('TEXT 1')
  expect(screen.getByText(/Glossary corrected 1 character/)).toBeTruthy()
  expect(localStorage.getItem('ocr-glossary')).toBe('text → TEXT')

  // It comes back after a reload.
  first.unmount()
  render(<OcrTool />)
  pick()
  expect(screen.getByLabelText('Glossary').value).toBe('text → TEXT')

  fireEvent.click(screen.getByText('Clear glossary'))
  expect(localStorage.getItem('ocr-glossary')).toBeNull()
})
