// Image cleanup applied in the browser before OCR. Tesseract reads best on
// dark text over a light background at roughly 300 DPI.

const MIN_LONG_EDGE = 1600 // upscale small images up to this
const MAX_LONG_EDGE = 3200 // never grow past this (memory)

// Grayscale + Otsu threshold, in place. Inverts if the result is mostly dark,
// since that means light text on a dark background.
export function binarize({ data, width, height }) {
  const pixels = width * height
  const gray = new Uint8Array(pixels)
  const histogram = new Array(256).fill(0)
  for (let i = 0; i < pixels; i++) {
    const g = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
    gray[i] = g
    histogram[g]++
  }

  // Otsu: pick the threshold that maximises between-class variance.
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * histogram[t]
  let sumBack = 0
  let weightBack = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    weightBack += histogram[t]
    if (weightBack === 0) continue
    const weightFore = pixels - weightBack
    if (weightFore === 0) break
    sumBack += t * histogram[t]
    const diff = sumBack / weightBack - (sum - sumBack) / weightFore
    const variance = weightBack * weightFore * diff * diff
    if (variance > best) {
      best = variance
      threshold = t
    }
  }

  let dark = 0
  for (let i = 0; i < pixels; i++) if (gray[i] <= threshold) dark++
  const invert = dark > pixels / 2

  for (let i = 0; i < pixels; i++) {
    const isDark = gray[i] <= threshold
    const v = isDark !== invert ? 0 : 255
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
}

// How much to scale an image so its long edge lands in a good OCR range.
export function scaleFor(width, height) {
  const long = Math.max(width, height)
  if (long < MIN_LONG_EDGE) return Math.min(MIN_LONG_EDGE / long, 4)
  if (long > MAX_LONG_EDGE) return MAX_LONG_EDGE / long
  return 1
}

// Returns a cleaned-up PNG Blob. The input is not modified or kept.
export async function enhanceImage(blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = scaleFor(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  binarize(imageData)
  ctx.putImageData(imageData, 0, 0)

  const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0 // release the pixel buffer
  return result
}
