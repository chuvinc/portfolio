import { PSM } from 'tesseract.js'
import { binarize } from './preprocess'

const ANALYSIS_EDGE = 1000 // long edge of the copy we analyse (speed)
const LINE_INK = 0.05 // a row/column counts as "inked" above this share of the busiest one
const COLUMN_GAP = 0.05 // an empty vertical strip this wide (share of the text area) splits columns
const DIRECTION_BIAS = 1.15 // one axis must beat the other by this factor to call it
const STRIP_RATIO = 4 // a text area this much wider than tall (or the reverse) is one strip of text

// Coefficient of variation (std / mean). High when ink is bunched
// into bands separated by gaps, low when it is spread evenly.
const variation = (profile) => {
  const mean = profile.reduce((a, b) => a + b, 0) / profile.length
  if (mean === 0) return 0
  const variance = profile.reduce((a, b) => a + (b - mean) ** 2, 0) / profile.length
  return Math.sqrt(variance) / mean
}

// Number of runs of "inked" entries in a profile.
const countBands = (profile) => {
  const cutoff = LINE_INK * Math.max(...profile)
  let bands = 0
  let inBand = false
  for (const v of profile) {
    const on = v > cutoff
    if (on && !inBand) bands++
    inBand = on
  }
  return bands
}

// Longest run of zero entries that has ink on both sides.
const widestGap = (profile) => {
  const first = profile.findIndex((v) => v > 0)
  const last = profile.length - 1 - [...profile].reverse().findIndex((v) => v > 0)
  let widest = 0
  let run = 0
  for (let i = first; i <= last; i++) {
    run = profile[i] === 0 ? run + 1 : 0
    widest = Math.max(widest, run)
  }
  return widest
}

// Guesses text direction and layout from a binarized RGBA image (ink = black).
// Text lines make the ink profile along one axis bunch into bands; whichever axis
// is bunchier is the one the lines are stacked along. A single strip is judged by shape.
export function analyzeInk({ data, width, height }) {
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] === 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { direction: 'horizontal', lines: 0, psm: PSM.AUTO }

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const rows = new Array(h).fill(0)
  const cols = new Array(w).fill(0)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * width + x) * 4] === 0) {
        rows[y - minY]++
        cols[x - minX]++
      }
    }
  }

  // A lone strip of text has no stacked lines to measure, so go by its shape.
  // Otherwise compare how bunched the ink is along each axis.
  let vertical
  if (w >= h * STRIP_RATIO) vertical = false
  else if (h >= w * STRIP_RATIO) vertical = true
  else vertical = variation(cols) > variation(rows) * DIRECTION_BIAS
  if (vertical) return { direction: 'vertical', lines: countBands(cols), psm: PSM.SINGLE_BLOCK_VERT_TEXT }

  const lines = countBands(rows)
  let psm = PSM.SINGLE_BLOCK
  if (lines <= 1) psm = PSM.SINGLE_LINE
  else if (widestGap(cols) >= COLUMN_GAP * w) psm = PSM.AUTO // several columns: let Tesseract split them
  return { direction: 'horizontal', lines, psm }
}

// Looks at an image Blob (without keeping it) and returns { direction, lines, psm }.
export async function inferLayout(blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 0
  binarize(imageData)
  return analyzeInk(imageData)
}
