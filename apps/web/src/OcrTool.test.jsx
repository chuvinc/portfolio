import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OcrTool from './OcrTool'
import { recognize } from './ocr'

vi.mock('./ocr', () => ({
  LAYOUTS: [
    { id: 'auto', label: 'Auto-detect' },
    { id: '3', label: 'Tesseract default' },
    { id: '7', label: 'A single line' },
  ],
  recognize: vi.fn(async () => ({ text: 'hello world', detected: null })),
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

test('passes the chosen language, layout and enhance options to OCR', async () => {
  render(<OcrTool />)
  pick()

  fireEvent.change(await screen.findByLabelText(/Language/), { target: { value: 'jpn' } })
  fireEvent.change(screen.getByLabelText(/Text layout/), { target: { value: '7' } })
  fireEvent.click(screen.getByLabelText(/Enhance image/))
  fireEvent.click(screen.getByText('Extract text'))

  await waitFor(() =>
    expect(recognize).toHaveBeenCalledWith(expect.any(File), { language: 'jpn', layout: '7', enhance: true }, expect.any(Function)),
  )
})
