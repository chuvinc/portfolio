import { describe, expect, test, vi } from 'vitest'
import { createTextLayers, drawTextLayer, oppositeColor, wrapText } from './textLayer'

const context = () => ({
  measureText: (text) => ({ width: Array.from(text).length * 10 }),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  save: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  restore: vi.fn(),
})

describe('wrapText', () => {
  test('wraps words and preserves explicit line breaks', () => {
    expect(wrapText(context(), 'one two three\nfour', 70)).toEqual(['one two', 'three', 'four'])
  })

  test('breaks long words to fit the available width', () => {
    expect(wrapText(context(), 'manga', 20)).toEqual(['ma', 'ng', 'a'])
  })
})

test('createTextLayers makes positioned layers for included regions only', () => {
  const layers = createTextLayers([
    { id: 1, x: 100, y: 80, w: 200, h: 60, text: 'hello', included: true },
    { id: 2, x: 500, y: 300, w: 80, h: 240, text: 'vertical', included: true },
    { id: 3, x: 0, y: 0, w: 50, h: 50, included: false },
  ], { width: 1000, height: 800 })

  expect(layers[1]).toMatchObject({ text: 'hello', x: 0.1, y: 0.1, width: 0.2, height: 0.075, bold: true, align: 'center', outline: false })
  expect(layers[2]).toMatchObject({ text: 'vertical', x: 0.5, y: 0.375, width: 0.08, height: 0.3 })
  expect(layers[3]).toBeUndefined()
})

test('drawTextLayer uses the project font and places each wrapped line', () => {
  const canvasContext = context()

  const lines = drawTextLayer(canvasContext, {
    text: 'one two three',
    x: 12,
    y: 24,
    fontSize: 10,
    color: '#000000',
    maxWidth: 70,
    maxHeight: 30,
    align: 'left',
    bold: false,
  })

  expect(canvasContext.font).toBe('10px "CC Wild Words"')
  expect(canvasContext.fillStyle).toBe('#000000')
  expect(canvasContext.rect).toHaveBeenCalledWith(12, 24, 70, 30)
  expect(lines).toEqual(['one two', 'three'])
  expect(canvasContext.fillText).toHaveBeenNthCalledWith(1, 'one two', 12, 24)
  expect(canvasContext.fillText).toHaveBeenNthCalledWith(2, 'three', 12, 36)
})

test('center alignment outlines text without changing its size or position', () => {
  const canvasContext = context()

  drawTextLayer(canvasContext, {
    text: 'hello',
    x: 12,
    y: 24,
    fontSize: 10,
    color: '#111111',
    maxWidth: 70,
    maxHeight: 30,
    outline: true,
  })

  expect(oppositeColor('#ffffff')).toBe('#000000')
  expect(oppositeColor('#111111')).toBe('#ffffff')
  expect(canvasContext.strokeStyle).toBe('#ffffff')
  expect(canvasContext.textAlign).toBe('center')
  expect(canvasContext.strokeText).toHaveBeenCalledWith('hello', 47, 24)
  expect(canvasContext.fillText).toHaveBeenCalledWith('hello', 47, 24)
  expect(canvasContext.font).toBe('bold 10px "CC Wild Words"')
  expect(canvasContext.lineWidth).toBe(1.6)
})