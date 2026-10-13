
export function createRegionMask(width, height, regions) {
  if (!Number.isInteger(width) || width <= 0 ||
      !Number.isInteger(height) || height <= 0) {
    throw new Error('Image dimensions must be positive integers')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  // Start with a black mask: preserve everything.
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  // White areas will be reconstructed later.
  ctx.fillStyle = '#ffffff'

  for (const region of regions ?? []) {
    if (!region.included) continue

    const { x, y, w, h } = region

    if (![x, y, w, h].every(Number.isFinite)) continue
    if (w <= 0 || h <= 0) continue

    ctx.fillRect(x, y, w, h)
  }

  return canvas
}

export function applySolidFills(canvas, maskCanvas, regions, solidFills) {
  const width = canvas.width
  const height = canvas.height
  const context = canvas.getContext('2d')
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!context || !maskContext) throw new Error('Canvas 2D context unavailable')

  const pixels = context.getImageData(0, 0, width, height)
  const maskPixels = maskContext.getImageData(0, 0, width, height)

  for (const region of regions ?? []) {
    const match = /^#([\da-f]{6})$/i.exec(solidFills[region.id] ?? '')
    if (!match || ![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w <= 0 || region.h <= 0) continue

    const color = Number.parseInt(match[1], 16)
    const red = (color >> 16) & 255
    const green = (color >> 8) & 255
    const blue = color & 255
    const left = Math.max(0, Math.floor(region.x))
    const top = Math.max(0, Math.floor(region.y))
    const right = Math.min(width, Math.ceil(region.x + region.w))
    const bottom = Math.min(height, Math.ceil(region.y + region.h))

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4
        if (maskPixels.data[offset] <= 127) continue
        pixels.data[offset] = red
        pixels.data[offset + 1] = green
        pixels.data[offset + 2] = blue
        pixels.data[offset + 3] = 255
      }
    }
  }

  context.putImageData(pixels, 0, 0)
}
