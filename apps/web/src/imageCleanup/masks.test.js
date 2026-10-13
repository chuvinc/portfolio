import { describe, expect, it, vi } from 'vitest'
import { applySolidFills, createRegionMask } from './masks.js'

describe('createRegionMask', () => {
  it('draws only included regions', () => {
    const fillRect = vi.fn()

    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        fillRect,
        fillStyle: '',
      })

    try {
      const mask = createRegionMask(400, 300, [
        { x: 20, y: 30, w: 50, h: 60, included: true },
        { x: 100, y: 120, w: 40, h: 50, included: false },
      ])

      expect(mask.width).toBe(400)
      expect(mask.height).toBe(300)
      expect(fillRect).toHaveBeenCalledWith(0, 0, 400, 300)
      expect(fillRect).toHaveBeenCalledWith(20, 30, 50, 60)
      expect(fillRect).toHaveBeenCalledTimes(2)
    } finally {
      getContext.mockRestore()
    }
  })
})

describe('applySolidFills', () => {
  it('fills only pixels inside both the selected region and cleanup mask', () => {
    const imagePixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
      10, 20, 30, 255,
    ])
    const maskPixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])
    const putImageData = vi.fn()
    const imageContext = {
      getImageData: vi.fn(() => ({ data: imagePixels })),
      putImageData,
    }
    const maskContext = {
      getImageData: vi.fn(() => ({ data: maskPixels })),
    }

    applySolidFills(
      { width: 3, height: 1, getContext: () => imageContext },
      { getContext: () => maskContext },
      [{ id: 4, x: 0, y: 0, w: 3, h: 1 }],
      { 4: '#112233' },
    )

    expect([...imagePixels]).toEqual([
      17, 34, 51, 255,
      10, 20, 30, 255,
      17, 34, 51, 255,
    ])
    expect(putImageData).toHaveBeenCalledWith({ data: imagePixels }, 0, 0)
  })
})