import { analyzeInk } from './layout'
import { binarize } from './preprocess'

const ANALYSIS_EDGE = 1000 // long edge of the copy we analyse
const MIN_SPECK = 3 // ignore ink blobs smaller than this many pixels
const GAP_FACTOR = 0.9 // blobs closer than this many typical-glyph sizes are one group
const MIN_BLOBS = 2 // a text group has at least this many glyphs
const MAX_DENSITY = 0.65 // ink share of the group's box; above this it's a solid picture
const MIN_DENSITY = 0.02 // ...and below this it's a stray line or smudge
const MAX_REGIONS = 40

// Finds connected blobs of ink (8-connectivity). Ink is black (0) in a binarized RGBA image.
function findBlobs({ data, width, height }) {
  const labels = new Int32Array(width * height)
  const parent = [0]
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  let next = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (data[i * 4] !== 0) continue
      const near = [
        x > 0 ? labels[i - 1] : 0,
        y > 0 ? labels[i - width] : 0,
        x > 0 && y > 0 ? labels[i - width - 1] : 0,
        x < width - 1 && y > 0 ? labels[i - width + 1] : 0,
      ].filter(Boolean)
      if (near.length === 0) {
        parent[next] = next
        labels[i] = next++
      } else {
        const root = Math.min(...near.map(find))
        labels[i] = root
        for (const n of near) parent[find(n)] = root
      }
    }
  }

  const blobs = new Map()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const label = labels[y * width + x]
      if (!label) continue
      const root = find(label)
      const b = blobs.get(root)
      if (b) {
        if (x < b.minX) b.minX = x
        if (x > b.maxX) b.maxX = x
        if (y < b.minY) b.minY = y
        if (y > b.maxY) b.maxY = y
        b.area++
      } else {
        blobs.set(root, { minX: x, maxX: x, minY: y, maxY: y, area: 1 })
      }
    }
  }
  return [...blobs.values()].filter((b) => b.area >= MIN_SPECK)
}

// Copies a box out of a binarized image so it can be analysed on its own.
function crop({ data, width }, box) {
  const w = box.maxX - box.minX + 1
  const h = box.maxY - box.minY + 1
  const out = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = data[((box.minY + y) * width + box.minX + x) * 4]
    }
  }
  return { data: out, width: w, height: h }
}

// Groups ink into text regions on a binarized image. Glyphs close together merge into
// lines/columns, and neighbouring lines/columns merge into blocks. Returns boxes in
// the image's own pixels, each tagged with a direction and a Tesseract layout mode.
export function findRegions(image) {
  const { width, height } = image
  let blobs = findBlobs(image)
  // Drop page-sized frames and rules, and cap the count so noisy art can't blow up the merge.
  blobs = blobs
    .filter((b) => b.maxX - b.minX < width * 0.5 && b.maxY - b.minY < height * 0.5)
    .sort((a, b) => b.area - a.area)
    .slice(0, 4000)
  if (blobs.length < MIN_BLOBS) return []

  const sizes = blobs.map((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1).sort((a, b) => a - b)
  const glyph = sizes[Math.floor(sizes.length * 0.7)]
  const gap = Math.max(2, glyph * GAP_FACTOR)

  // Union blobs whose boxes are within `gap` of each other (sweep over x).
  blobs.sort((a, b) => a.minX - b.minX)
  const parent = blobs.map((_, i) => i)
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      if (blobs[j].minX > blobs[i].maxX + gap) break
      if (blobs[j].minY <= blobs[i].maxY + gap && blobs[i].minY <= blobs[j].maxY + gap) {
        parent[find(j)] = find(i)
      }
    }
  }

  const groups = new Map()
  blobs.forEach((b, i) => {
    const root = find(i)
    const g = groups.get(root)
    if (g) {
      g.minX = Math.min(g.minX, b.minX)
      g.maxX = Math.max(g.maxX, b.maxX)
      g.minY = Math.min(g.minY, b.minY)
      g.maxY = Math.max(g.maxY, b.maxY)
      g.area += b.area
      g.blobs++
    } else {
      groups.set(root, { ...b, blobs: 1 })
    }
  })

  const regions = []
  for (const g of groups.values()) {
    const boxArea = (g.maxX - g.minX + 1) * (g.maxY - g.minY + 1)
    const density = g.area / boxArea
    if (g.blobs < MIN_BLOBS || density > MAX_DENSITY || density < MIN_DENSITY) continue
    const { direction, lines, psm } = analyzeInk(crop(image, g))
    regions.push({
      x: g.minX,
      y: g.minY,
      w: g.maxX - g.minX + 1,
      h: g.maxY - g.minY + 1,
      direction,
      lines,
      psm,
    })
  }
  return regions.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_REGIONS)
}

// Reading order for pages that read right to left: rows top to bottom,
// and within a row (a band 10% of the page tall) right to left. Approximate by design.
export function orderRegions(regions, pageHeight, rightToLeft) {
  const band = (r) => Math.floor(r.y / (pageHeight * 0.1))
  return [...regions].sort((a, b) => band(a) - band(b) || (rightToLeft ? b.x - a.x : a.x - b.x))
}

// Decodes an image Blob (without keeping it), finds its text regions, and returns them
// in the original image's pixels along with that image's size.
export async function detectRegions(blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 0
  binarize(imageData)
  const regions = findRegions(imageData).map((r) => ({
    ...r,
    x: Math.round(r.x / scale),
    y: Math.round(r.y / scale),
    w: Math.round(r.w / scale),
    h: Math.round(r.h / scale),
  }))
  return { regions, ...size }
}

// Copies a region (plus a little padding) out of an image Blob as a PNG Blob.
export async function cropRegion(blob, { x, y, w, h }) {
  const bitmap = await createImageBitmap(blob)
  const pad = Math.round(Math.max(w, h) * 0.04) + 4
  const sx = Math.max(0, x - pad)
  const sy = Math.max(0, y - pad)
  const sw = Math.min(bitmap.width - sx, w + pad * 2)
  const sh = Math.min(bitmap.height - sy, h + pad * 2)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close()
  const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0
  return result
}
