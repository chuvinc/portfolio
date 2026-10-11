import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OcrTool from './OcrTool'
import { findTextRegions, readRegions, recognize } from './ocr'

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

const clickMore = (name) => {
  const menu = document.querySelector('.more-menu')
  if (!menu.open) fireEvent.click(menu.querySelector('summary'))
  fireEvent.click(screen.getByRole('button', { name }))
}

test('extracts text from a chosen image and clears everything', async () => {
  render(<OcrTool />)
  pick()

  fireEvent.click(await screen.findByText('Extract text'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('hello world'))

  clickMore('Clear Image')
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

test('explains where image processing happens and how to remove the image', () => {
  render(<OcrTool />)
  expect(screen.getByText(/OCR runs in your browser.*stays in this tab while you work.*Clear Image to remove it/i)).toBeTruthy()
})

test('passes the chosen layout and contrast to OCR, with Japanese as the language', async () => {
  render(<OcrTool />)
  pick()

  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: '7' } })
  fireEvent.change(screen.getByLabelText('Contrast'), { target: { value: '200' } })
  fireEvent.click(screen.getByText('Extract text'))

  await waitFor(() =>
    expect(recognize).toHaveBeenCalledWith(expect.any(File), { language: 'jpn', layout: '7', contrast: 200, allowLatin: false }, expect.any(Function)),
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

test('manual boxes can be drawn and read before auto-detection', async () => {
  const detections = findTextRegions.mock.calls.length
  render(<OcrTool />)
  pick()
  const image = await screen.findByAltText('Selected for text extraction')
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 800 },
  })
  fireEvent.load(image)
  const el = overlay()
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100 })
  fireEvent.pointerMove(el, { clientX: 300, clientY: 150 })
  fireEvent.pointerUp(el, { clientX: 300, clientY: 150 })

  fireEvent.click(await screen.findByText(/^Read \(/))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
  expect(findTextRegions.mock.calls.length).toBe(detections)
  expect(readRegions.mock.calls.at(-1)[1]).toEqual([
    expect.objectContaining({ id: 1, x: 100, y: 100, w: 200, h: 50, included: true }),
  ])
})

test('box details start collapsed and bulk deletion works without expanding them', async () => {
  await findRegionsMode()
  const details = screen.getByText('Box details').closest('details')
  const remove = screen.getByRole('button', { name: 'Delete selected' })
  expect(details.open).toBe(false)
  expect(remove.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
  expect(remove.disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
  expect(remove.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
  fireEvent.click(remove)
  expect(document.querySelectorAll('.region')).toHaveLength(0)
  expect(details.open).toBe(false)
})

async function findRegionsMode() {
  render(<OcrTool />)
  pick()
  const image = await screen.findByAltText('Selected for text extraction')
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 800 },
  })
  fireEvent.load(image)
  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: 'regions' } })
  clickMore('Detect Again')
  await screen.findByText(/text regions detected/)
  return overlay()
}

test('region toolbar keeps six primary actions and puts secondary actions in More', async () => {
  await findRegionsMode()
  const bar = document.querySelector('.actions.bar')
  const primary = [...bar.querySelectorAll(':scope > button')].map((button) => button.textContent)
  expect(primary).toEqual(['Read (0)', 'Read All', 'All On', 'All Off', 'Show Mask', 'Erase Mask'])

  fireEvent.click(screen.getByText('More ▾'))
  const menu = document.querySelector('.more-menu')
  expect(menu.open).toBe(true)
  expect([...menu.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'Remove Text',
    'Reset Mask',
    'Detect Again',
    'Clear Image',
  ])
})

test('mask preview explains empty or outdated masks and Reset Mask rebuilds it', async () => {
  const el = await findRegionsMode()
  const fillRect = vi.fn()
  const context = {
    fillRect,
    getImageData: vi.fn((x, y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  }
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)

  try {
    fireEvent.click(screen.getByText('Show Mask'))
    expect(screen.getByText(/mask is empty because no boxes are on/i)).toBeTruthy()
    expect(document.querySelector('.cleanup-mask-preview').style.visibility).toBe('visible')

    clickAt(el, 150, 120)
    expect(screen.getByText(/selection changed after this mask was made/i)).toBeTruthy()

    clickMore('Reset Mask')
    expect(screen.queryByText(/selection changed after this mask was made/i)).toBeNull()
    expect(fillRect).toHaveBeenCalledWith(100, 100, 200, 50)
  } finally {
    getContext.mockRestore()
  }
})

test('region mode: boxes start off, clicking turns them on, only those are read', async () => {
  const el = await findRegionsMode()
  const boxes = () => [...document.querySelectorAll('.region')]
  expect(boxes()).toHaveLength(2)
  expect(boxes().every((b) => b.classList.contains('off'))).toBe(true)
  expect(screen.getByText(/^Read \(/).disabled).toBe(true)

  clickAt(el, 150, 120) // the horizontal box
  expect(boxes().filter((b) => b.classList.contains('on'))).toHaveLength(1)
  fireEvent.click(screen.getByText(/^Read \(/))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
  expect(readRegions.mock.calls.at(-1)[1]).toHaveLength(1)
})

test('region mode: low-confidence regions are hidden until asked for', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByText('All On'))
  fireEvent.click(screen.getByText(/^Read \(/))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
  fireEvent.click(screen.getByLabelText(/Include regions Tesseract was unsure about/))
  expect(screen.getByLabelText('Extracted text').textContent).toContain('text 2')
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
  fireEvent.click(screen.getByText('Read All'))

  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
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
  clickMore('Detect Again')
  await screen.findByText(/text regions detected/)
  fireEvent.click(screen.getByText('Read All'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))

  // A rule applies to the text already read, with no new OCR run.
  fireEvent.change(screen.getByLabelText('Glossary'), { target: { value: 'text → TEXT' } })
  expect(screen.getByLabelText('Extracted text').textContent).toBe('TEXT 1')
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

test('clicking a wrong character adds a corrected word to the glossary', async () => {
  localStorage.clear()
  render(<OcrTool />)
  pick()
  fireEvent.change(await screen.findByLabelText(/Text layout/), { target: { value: 'regions' } })
  clickMore('Detect Again')
  await screen.findByText(/text regions detected/)
  fireEvent.click(screen.getByText('Read All'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))

  fireEvent.click(document.querySelector('[data-i="0"]')) // the "t"
  fireEvent.change(screen.getByLabelText('Correct text'), { target: { value: 'T' } })
  fireEvent.click(screen.getByText(/^Add word:/))

  expect(screen.getByLabelText('Glossary').value).toBe('Tex') // "T" plus two characters of context
  expect(localStorage.getItem('ocr-glossary')).toBe('Tex')
})

test('the contrast slider previews live and can be reset', async () => {
  render(<OcrTool />)
  pick()
  const preview = await screen.findByAltText('Selected for text extraction')
  expect(preview.style.filter).toBe('') // untouched at 100%

  fireEvent.change(screen.getByLabelText('Contrast'), { target: { value: '220' } })
  expect(preview.style.filter).toContain('contrast-preview') // the preview is filtered
  expect(screen.getByText(/220%/)).toBeTruthy()
  const slope = document.querySelector('feFuncR').getAttribute('slope')
  expect(Number(slope)).toBeCloseTo(2.2)

  fireEvent.click(screen.getByText('Reset'))
  expect(preview.style.filter).toBe('')
  expect(screen.queryByText('Reset')).toBeNull()
})

test('clicking a box opens a close-up with its own contrast slider, used when that box is read', async () => {
  const el = await findRegionsMode()
  expect(screen.queryByLabelText('Contrast for this box')).toBeNull() // no box selected yet

  clickAt(el, 150, 120) // the first box
  const slider = await screen.findByLabelText('Contrast for this box')
  expect(screen.getByText('Box #1')).toBeTruthy()
  expect(slider.value).toBe('100') // starts at the page setting

  fireEvent.change(slider, { target: { value: '220' } })
  expect(screen.getByText(/Use the page setting/)).toBeTruthy()
  fireEvent.click(screen.getByText('Read All'))

  await waitFor(() => expect(readRegions).toHaveBeenCalled())
  const sent = readRegions.mock.calls.at(-1)[1]
  expect(sent.find((r) => r.id === 1).contrast).toBe(220) // this box has its own contrast
  expect(sent.find((r) => r.id === 2).contrast).toBeUndefined() // the other follows the page
})

test("a box's own contrast can be reset to follow the page again", async () => {
  const el = await findRegionsMode()
  clickAt(el, 150, 120)
  fireEvent.change(await screen.findByLabelText('Contrast for this box'), { target: { value: '200' } })
  fireEvent.click(screen.getByText(/Use the page setting/))
  expect(screen.queryByText(/Use the page setting/)).toBeNull()
  expect(screen.getByLabelText('Contrast for this box').value).toBe('100')
})

test('the picture is shown full width, not capped to the window height', async () => {
  render(<OcrTool />)
  pick()
  await screen.findByAltText('Selected for text extraction')
  expect(document.querySelector('.previewBox').getAttribute('style')).toBeNull()
})

test('a selected box can be deleted', async () => {
  const el = await findRegionsMode()
  expect(document.querySelectorAll('.region')).toHaveLength(2)
  clickAt(el, 150, 120) // select the first box
  fireEvent.click(await screen.findByText('Delete this box'))

  expect(document.querySelectorAll('.region')).toHaveLength(1)
  expect(screen.queryByLabelText('Contrast for this box')).toBeNull() // nothing is selected any more
})

async function readFirstBox() {
  const el = await findRegionsMode()
  clickAt(el, 150, 120) // switch the first box on
  fireEvent.click(screen.getByText(/^Read \(/))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
  return el
}

test('thorough reading preserves output until a reading is chosen and changes only that box', async () => {
  localStorage.clear()
  await findRegionsMode()
  fireEvent.click(screen.getByText('Read All'))
  await waitFor(() => expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1'))
  fireEvent.click(screen.getByLabelText('Select box 1').closest('li'))
  const alternative = {
    text: 'better text',
    entries: Array.from('better text', (ch) => ({ ch, conf: 90 })),
    confidence: 30,
    engineConfidence: 30,
    language: 'jpn',
    methods: ['Dark fill', 'Original'],
  }
  readRegions.mockResolvedValueOnce([{ id: 1, alternatives: [alternative] }])
  fireEvent.click(screen.getByText('Thorough read'))
  await screen.findByText('Dark fill / Original')
  expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1')
  expect(readRegions.mock.calls.at(-1)[1]).toHaveLength(1)
  expect(readRegions.mock.calls.at(-1)[2].thorough).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Use reading 1 for box 1' }))
  expect(screen.getByLabelText('Extracted text').textContent).toBe('better text')
  fireEvent.click(screen.getByLabelText(/Include regions Tesseract was unsure about/))
  expect(screen.getByLabelText('Extracted text').textContent).toContain('text 2')
  fireEvent.change(screen.getByLabelText('Contrast for this box'), { target: { value: '200' } })
  expect(screen.queryByText('Alternative readings')).toBeNull()
})

test('the box inspector can collapse without losing readings or moving output into it', async () => {
  await readFirstBox()
  const inspector = document.querySelector('details.inspector')
  const summary = screen.getByText('Box #1')
  expect(inspector.open).toBe(true)
  fireEvent.click(summary)
  expect(inspector.open).toBe(false)
  expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1')
  expect(inspector.querySelector('[aria-label="Extracted text"]')).toBeNull()
  fireEvent.click(summary)
  expect(inspector.open).toBe(true)
  expect(screen.getByRole('button', { name: 'Thorough read' })).toBeTruthy()
})

test('thorough alternatives are cleared when OCR options change', async () => {
  const el = await readFirstBox()
  clickAt(el, 150, 120)
  readRegions.mockResolvedValueOnce([{ id: 1, alternatives: [] }])
  fireEvent.click(screen.getByText('Thorough read'))
  await screen.findByText('Alternative readings')
  fireEvent.click(screen.getByLabelText(/Allow English letters and numbers/))
  expect(screen.queryByText('Alternative readings')).toBeNull()
})

test('the result can be edited by hand, and reset', async () => {
  await readFirstBox()
  fireEvent.click(screen.getByText('Edit text'))
  const box = screen.getByLabelText('Edit extracted text')
  expect(box.value).toBe('text 1') // starts from the current text
  fireEvent.change(box, { target: { value: 'text one joined' } })
  fireEvent.click(screen.getByText('Save'))

  expect(screen.getByLabelText('Extracted text').textContent).toBe('text one joined')
  expect(screen.getByText(/Edited by hand/)).toBeTruthy()

  fireEvent.click(screen.getByText('Reset to original'))
  expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1')
  expect(screen.queryByText(/Edited by hand/)).toBeNull()
})

test('cancelling an edit changes nothing', async () => {
  await readFirstBox()
  fireEvent.click(screen.getByText('Edit text'))
  fireEvent.change(screen.getByLabelText('Edit extracted text'), { target: { value: 'oops' } })
  fireEvent.click(screen.getByText('Cancel'))
  expect(screen.getByLabelText('Extracted text').textContent).toBe('text 1')
})

test('a hand edit gives way when the text it was made from changes', async () => {
  const el = await readFirstBox()
  fireEvent.click(screen.getByText('Edit text'))
  fireEvent.change(screen.getByLabelText('Edit extracted text'), { target: { value: 'rewritten' } })
  fireEvent.click(screen.getByText('Save'))
  expect(screen.getByLabelText('Extracted text').textContent).toBe('rewritten')

  clickAt(el, 150, 120) // switch the box off: the underlying text changes
  expect(screen.getByLabelText('Extracted text').textContent).not.toBe('rewritten')
  expect(screen.queryByText(/Edited by hand/)).toBeNull()
})

test('the picture starts on the left with the controls beside it, and can be expanded', async () => {
  const el = await findRegionsMode()
  const workspace = document.querySelector('.workspace')
  expect(workspace.classList.contains('expanded')).toBe(false)
  expect(workspace.querySelector('.stage .previewBox')).toBeTruthy() // the picture
  // the controls are in the sidebar next to it
  expect(workspace.querySelector('.sidebar').textContent).toContain('Read (0)')
  expect(workspace.querySelector('.sidebar').textContent).toContain('All On')
  expect(workspace.querySelector('.stage').textContent).not.toContain('All On')

  fireEvent.click(screen.getByText('Expand image'))
  expect(workspace.classList.contains('expanded')).toBe(true)
  expect(screen.getByText('Shrink image')).toBeTruthy()
  fireEvent.click(screen.getByText('Shrink image'))
  expect(workspace.classList.contains('expanded')).toBe(false)
  expect(el).toBeTruthy()
})

test('double-clicking empty space on the picture expands it, but double-clicking a box does not', async () => {
  const el = await findRegionsMode()
  const workspace = document.querySelector('.workspace')

  fireEvent.doubleClick(el, { clientX: 150, clientY: 120 }) // on the first box
  expect(workspace.classList.contains('expanded')).toBe(false)

  fireEvent.doubleClick(el, { clientX: 900, clientY: 700 }) // empty space
  expect(workspace.classList.contains('expanded')).toBe(true)
})

test('several boxes can be picked from the list and deleted together', async () => {
  await findRegionsMode()
  expect(screen.getByText('Delete selected').disabled).toBe(true)

  fireEvent.click(screen.getByLabelText('Select box 1'))
  fireEvent.click(screen.getByLabelText('Select box 2'))
  expect(screen.getByText('2 selected')).toBeTruthy()

  fireEvent.click(screen.getByText('Delete selected'))
  expect(document.querySelectorAll('.region')).toHaveLength(0)
  expect(screen.getByText('Delete selected').disabled).toBe(true)
  expect(screen.queryByText('2 selected')).toBeNull()
})

test('only the picked boxes are deleted', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByLabelText('Select box 2'))
  fireEvent.click(screen.getByText('Delete selected'))
  expect(document.querySelectorAll('.region')).toHaveLength(1)
  expect(screen.queryByLabelText('Select box 2')).toBeNull()
  expect(screen.getByLabelText('Select box 1')).toBeTruthy()
})

test('Ctrl-click picks a box on the picture without switching it on', async () => {
  const el = await findRegionsMode()
  fireEvent.click(el, { clientX: 150, clientY: 120, ctrlKey: true })
  expect(screen.getByLabelText('Select box 1').checked).toBe(true)
  const states = [...document.querySelectorAll('.region')].map((b) => b.classList.contains('off'))
  expect(states).toEqual([true, true]) // both still off: picking is not toggling
  expect(document.querySelectorAll('.region.selected')).toHaveLength(1)
})

test('picked boxes can be switched on or off together, and select all / none work', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByText('Select all'))
  expect(screen.getByText('2 selected')).toBeTruthy()
  fireEvent.click(screen.getByText('Turn on'))
  expect(screen.getByText(/^Read \(/).disabled).toBe(false)
  fireEvent.click(screen.getByText('Turn off'))
  expect(screen.getByText(/^Read \(/).disabled).toBe(true)
  fireEvent.click(screen.getByText('Select none'))
  expect(screen.getByText('Delete selected').disabled).toBe(true)
})

test('contrast can be set for several picked boxes at once', async () => {
  await findRegionsMode()
  fireEvent.click(screen.getByLabelText('Select box 1'))
  fireEvent.change(screen.getByLabelText('Contrast for selected boxes'), { target: { value: '230' } })
  fireEvent.click(screen.getByText('Read All'))

  await waitFor(() => expect(readRegions).toHaveBeenCalled())
  const sent = readRegions.mock.calls.at(-1)[1]
  expect(sent.find((r) => r.id === 1).contrast).toBe(230)
  expect(sent.find((r) => r.id === 2).contrast).toBeUndefined()
})

test('the result sits under the picture, in its own cell next to the controls, and the buttons stay with you', async () => {
  await readFirstBox()
  const workspace = document.querySelector('.workspace')
  const [stage, sidebar, output] = ['.stage', '.sidebar', '.output'].map((q) => workspace.querySelector(q))
  expect(stage && sidebar && output).toBeTruthy()
  // the three cells, in the order the expanded layout stacks them
  expect([...workspace.children]).toEqual([stage, sidebar, output])
  // the extracted text lives in the output cell, not among the controls
  expect(output.querySelector('[aria-label="Extracted text"]')).toBeTruthy()
  expect(sidebar.querySelector('[aria-label="Extracted text"]')).toBeNull()
  expect(output.textContent).toContain('Copy text')
  // the button bar is the sticky one
  expect(sidebar.firstElementChild.classList.contains('bar')).toBe(true)
  expect(sidebar.firstElementChild.textContent).toContain('Read All')
})

test('progress and errors show beside the buttons', async () => {
  const el = await findRegionsMode()
  expect(el).toBeTruthy()
  readRegions.mockImplementationOnce(() => new Promise(() => {})) // never finishes
  fireEvent.click(screen.getByText('Read All'))
  const bar = await screen.findByRole('progressbar', {}, { timeout: 2000 }).catch(() => null)
  const sidebar = document.querySelector('.sidebar')
  expect(sidebar.querySelector('progress') ?? bar).toBeTruthy()
  expect(document.querySelector('.output progress')).toBeNull()
})
