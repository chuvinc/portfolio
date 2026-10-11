
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
