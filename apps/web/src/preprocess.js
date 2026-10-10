// Image helpers that run in the browser. binarize() is only for finding where the ink is (text
// detection); it is not applied to what Tesseract reads, which cost about 10 points of accuracy.

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

// Average brightness of RGBA pixels, 0-255.
export function meanBrightness({ data }) {
  const pixels = data.length / 4
  let sum = 0
  for (let i = 0; i < pixels; i++) sum += 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  return pixels ? sum / pixels : 128
}

// Raises contrast in place: out = (in - mean) * factor + mean on every colour channel.
// The pivot is the image's own average brightness, not mid-gray: on a faded, light page a fixed
// mid-gray pivot pushes everything to plain white, while pivoting on the average darkens the text
// and lightens the paper. Measured on faded, noisy pages, x2 lifted accuracy from 70% to 83%;
// clean pages are unaffected and x4 starts to hurt.
export function adjustContrast({ data }, factor, mean = meanBrightness({ data })) {
  const offset = mean * (1 - factor)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * factor + offset // Uint8ClampedArray clamps to 0-255
    data[i + 1] = data[i + 1] * factor + offset
    data[i + 2] = data[i + 2] * factor + offset
  }
}

async function pixelsOf(blob, longEdge = Infinity) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}

// Average brightness of an image Blob (from a small copy), used as the contrast pivot for the preview.
export async function brightnessOf(blob) {
  const { canvas, imageData } = await pixelsOf(blob, 200)
  canvas.width = canvas.height = 0
  return meanBrightness(imageData)
}

// Returns the image with its contrast raised by `factor` (1 = unchanged, which returns the same Blob).
export async function contrastImage(blob, factor) {
  if (factor <= 1.001) return blob
  const { canvas, ctx, imageData } = await pixelsOf(blob)
  adjustContrast(imageData, factor)
  ctx.putImageData(imageData, 0, 0)
  const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0 // release the pixel buffer
  return result
}
