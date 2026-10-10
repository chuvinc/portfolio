import { PSM } from 'tesseract.js'
import { analyzeInk, columnRanges } from './layout'
import { binarize } from './preprocess'

const ANALYSIS_EDGE = 1000 // long edge of the copy we analyse
const MIN_SPECK = 3 // ignore ink blobs smaller than this many pixels
const GAP_FACTOR = 1.2 // two blobs closer than this many (smaller blob) sizes are one group
const MAX_REGION_SHARE = 0.6 // a box covering more than this share of the page is the page, not text
const SAME_SIZE = [0.6, 1.67] // groups merge only if their glyphs are this close in size
const MIN_BLOBS = 3 // fixed floor used when judging a run of glyphs (see SENSITIVITY for groups)
// How picky detection is about what counts as text. "strict" drops more junk but may miss
// small or odd text; "loose" keeps more, at the cost of more junk boxes to switch off.
const SENSITIVITY = {
  strict: { minGlyphs: 4, uniform: 0.7, minArea: 0.0012 },
  normal: { minGlyphs: 3, uniform: 0.6, minArea: 0.0008 },
  loose: { minGlyphs: 2, uniform: 0.45, minArea: 0.0004 },
}
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

const SIZE_SPREAD = [0.4, 2.5] // a glyph is this far (x median) from the group's median size at most
const MAX_DOMINANT = 0.6 // one blob holding more than this share of a group's ink is a drawing
const MERGE_GAP = 1.6 // sibling groups within this many glyphs (and lined up) are one text area
const MERGE_OVERLAP = 0.6 // ...if they overlap this much along the shared edge
const STRIP_SPREAD = 3 // glyph centres spread this much more along one axis = one strip of text
const PAD = 0.5 // grow each box by this many glyphs so edge strokes aren't clipped

const size = (b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// The most common blob size on the page. Text has hundreds of same-sized glyphs, so they
// form the biggest peak in a size histogram; artwork is scattered and can't outvote them.
function typicalGlyph(blobs) {
  const sized = blobs.filter((b) => b.area >= 8).map(size)
  if (sized.length === 0) return 8
  const bin = (s) => Math.round(Math.log2(s) * 4) // quarter-octave bins
  const counts = new Map()
  for (const s of sized) counts.set(bin(s), (counts.get(bin(s)) ?? 0) + 1)
  let best = null
  let bestScore = -1
  for (const key of counts.keys()) {
    const score = (counts.get(key - 1) ?? 0) + counts.get(key) + (counts.get(key + 1) ?? 0)
    if (score > bestScore) {
      best = key
      bestScore = score
    }
  }
  return median(sized.filter((s) => Math.abs(bin(s) - best) <= 1))
}

// Text is made of similar-sized glyphs; drawings are one big shape or a mix of sizes.
function looksLikeText(g, { minGlyphs, uniform }) {
  if (g.members.length < minGlyphs) return false
  const m = median(g.members.map(size))
  const similar = g.members.filter((b) => size(b) >= m * SIZE_SPREAD[0] && size(b) <= m * SIZE_SPREAD[1])
  if (similar.length < minGlyphs || similar.length / g.members.length < uniform) return false
  return Math.max(...g.members.map((b) => b.area)) / g.area <= MAX_DOMINANT
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1)

// Two groups belong to one text area if they sit side by side (columns) or stacked
// (lines), close together, with their edges lined up.
function sameTextArea(a, b, reach) {
  const xGap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)
  const yGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY)
  const yShare = overlap(a.minY, a.maxY, b.minY, b.maxY) / Math.min(a.maxY - a.minY + 1, b.maxY - b.minY + 1)
  const xShare = overlap(a.minX, a.maxX, b.minX, b.maxX) / Math.min(a.maxX - a.minX + 1, b.maxX - b.minX + 1)
  return (xGap <= reach && yShare >= MERGE_OVERLAP) || (yGap <= reach && xShare >= MERGE_OVERLAP)
}

// Only groups with similar-sized glyphs are parts of the same text area.
const comparable = (a, b) => {
  const ratio = median(a.members.map(size)) / median(b.members.map(size))
  return ratio >= SAME_SIZE[0] && ratio <= SAME_SIZE[1]
}

function mergeGroups(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    area: a.area + b.area,
    members: [...a.members, ...b.members],
  }
}

// A handful of glyphs strung along one axis is a single line or column, whatever
// the box shape; this stops a short column being mistaken for horizontal text.
function stripDirection(members, glyph) {
  if (members.length < MIN_BLOBS) return null
  const cx = members.map((b) => (b.minX + b.maxX) / 2)
  const cy = members.map((b) => (b.minY + b.maxY) / 2)
  const sx = Math.max(...cx) - Math.min(...cx)
  const sy = Math.max(...cy) - Math.min(...cy)
  if (sy > glyph && sy >= STRIP_SPREAD * sx) return 'vertical'
  if (sx > glyph && sx >= STRIP_SPREAD * sy) return 'horizontal'
  return null
}

// Groups ink into text regions on a binarized image. Glyphs close together merge into
// lines/columns, neighbouring lines/columns merge into blocks, and groups that don't
// look like text (mixed sizes, one big shape, too dense or too faint) are dropped.
// Returns padded boxes in the image's own pixels, tagged with a direction and layout mode.
export function findRegions(image, sensitivity = 'normal') {
  const cfg = SENSITIVITY[sensitivity] ?? SENSITIVITY.normal
  const { width, height } = image
  let blobs = findBlobs(image)
  // Drop page-sized frames and rules, and cap the count so noisy art can't blow up the merge.
  blobs = blobs
    .filter((b) => b.maxX - b.minX < width * 0.5 && b.maxY - b.minY < height * 0.5)
    .sort((a, b) => b.area - a.area)
    .slice(0, 4000)
  if (blobs.length < cfg.minGlyphs) return []

  const glyph = typicalGlyph(blobs)

  // Union blobs whose boxes are within a gap set by the SMALLER of the two, so a drawing
  // next to text can't pull the text towards it. Sweep over x for speed.
  blobs.sort((a, b) => a.minX - b.minX)
  const parent = blobs.map((_, i) => i)
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      if (blobs[j].minX > blobs[i].maxX + GAP_FACTOR * size(blobs[i])) break
      const gap = Math.max(2, GAP_FACTOR * Math.min(size(blobs[i]), size(blobs[j])))
      if (
        blobs[j].minX <= blobs[i].maxX + gap &&
        blobs[j].minY <= blobs[i].maxY + gap &&
        blobs[i].minY <= blobs[j].maxY + gap
      ) {
        parent[find(j)] = find(i)
      }
    }
  }

  const grouped = new Map()
  blobs.forEach((b, i) => {
    const root = find(i)
    const g = grouped.get(root)
    if (g) grouped.set(root, mergeGroups(g, { ...b, members: [b] }))
    else grouped.set(root, { ...b, members: [b] })
  })

  // Keep text-like groups, then join siblings that are one text area split by a wide gap.
  let groups = [...grouped.values()].filter((g) => looksLikeText(g, cfg))
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (comparable(groups[i], groups[j]) && sameTextArea(groups[i], groups[j], glyph * MERGE_GAP)) {
          groups[i] = mergeGroups(groups[i], groups[j])
          groups.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }

  const pad = Math.round(glyph * PAD)
  const regions = []
  for (const g of groups) {
    const boxArea = (g.maxX - g.minX + 1) * (g.maxY - g.minY + 1)
    const density = g.area / boxArea
    if (boxArea < cfg.minArea * width * height || boxArea > MAX_REGION_SHARE * width * height) continue
    if (density > MAX_DENSITY || density < MIN_DENSITY) continue

    let { direction, lines, psm } = analyzeInk(crop(image, g))
    const strip = stripDirection(g.members, glyph)
    if (strip && strip !== direction) {
      direction = strip
      lines = 1
      psm = strip === 'vertical' ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_LINE
    }

    // Several vertical columns: remember where each one is so they can be read one at a time.
    let columns
    if (direction === 'vertical' && lines > 1) {
      const found = columnRanges(crop(image, g)).map((c) => ({ x: g.minX + c.x, w: c.w }))
      if (found.length > 1) columns = found
    }

    const x0 = Math.max(0, g.minX - pad)
    const y0 = Math.max(0, g.minY - pad)
    const x1 = Math.min(width - 1, g.maxX + pad)
    const y1 = Math.min(height - 1, g.maxY + pad)
    regions.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, direction, lines, psm, columns })
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
export async function detectRegions(blob, sensitivity) {
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
  const regions = findRegions(imageData, sensitivity).map((r) => ({
    ...r,
    x: Math.round(r.x / scale),
    y: Math.round(r.y / scale),
    w: Math.round(r.w / scale),
    h: Math.round(r.h / scale),
    columns: r.columns?.map((c) => ({ x: Math.round(c.x / scale), w: Math.round(c.w / scale) })),
  }))
  return { regions, ...size }
}

// Tesseract reads best when a glyph is around this many pixels tall.
const TARGET_GLYPH = 48
const MAX_UPSCALE = 4

// Enlarge small text towards a comfortable glyph size. For one line/column the short side is
// one glyph; for a block, a line (or column) pitch is a good stand-in.
export const upscaleFor = ({ w, h, lines, direction }) => {
  const glyph = lines <= 1 ? Math.min(w, h) : direction === 'vertical' ? w / lines : h / lines
  return Math.min(MAX_UPSCALE, Math.max(1, TARGET_GLYPH / glyph))
}

// Copies a region (plus a little padding) out of an image Blob as a PNG Blob, optionally enlarged.
export async function cropRegion(blob, { x, y, w, h }, scale = 1) {
  const bitmap = await createImageBitmap(blob)
  const pad = Math.round(Math.max(w, h) * 0.04) + 4
  const sx = Math.max(0, x - pad)
  const sy = Math.max(0, y - pad)
  const sw = Math.min(bitmap.width - sx, w + pad * 2)
  const sh = Math.min(bitmap.height - sy, h + pad * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = canvas.height = 0
  return result
}

// Works out direction and layout mode for a box the user drew by hand.
export async function classifyRegion(blob, { x, y, w, h }) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 0
  binarize(imageData)
  const { direction, lines, psm } = analyzeInk(imageData)
  let columns
  if (direction === 'vertical' && lines > 1) {
    const found = columnRanges(imageData).map((c) => ({ x: x + Math.round(c.x / scale), w: Math.round(c.w / scale) }))
    if (found.length > 1) columns = found
  }
  return { direction, lines, psm, columns }
}
