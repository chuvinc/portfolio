import { describe, expect, it, vi } from 'vitest'
import { createRegionMask } from './masks.js'

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