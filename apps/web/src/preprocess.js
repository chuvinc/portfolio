// Black-and-white conversion used by text detection (finding where the ink is). It is not
// applied to the image Tesseract reads: that hurt accuracy by about 10 points in testing.

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
