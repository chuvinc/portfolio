export function wrapText(context, text, maxWidth) {
  const lines = []

  for (const paragraph of text.split('\n')) {
    const segments = paragraph.match(/\S+\s*|\s+/g) ?? ['']
    let line = ''

    for (const segment of segments) {
      const candidate = line + segment
      if (!line || context.measureText(candidate.trimEnd()).width <= maxWidth) {
        line = candidate
      } else {
        lines.push(line.trimEnd())
        line = segment.trimStart()
      }

      while (line && context.measureText(line).width > maxWidth) {
        const characters = Array.from(line)
        let splitAt = characters.length - 1
        while (splitAt > 1 && context.measureText(characters.slice(0, splitAt).join('')).width > maxWidth) {
          splitAt -= 1
        }
        lines.push(characters.slice(0, splitAt).join(''))
        line = characters.slice(splitAt).join('')
      }
    }

    lines.push(line.trim())
  }

  return lines
}

export function createTextLayers(regions, page) {
  return Object.fromEntries(
    regions.filter((region) => region.included).map((region) => {
      const x = region.x / page.width
      const y = region.y / page.height
      return [region.id, {
        text: region.text ?? '',
        x,
        y,
        width: Math.min(1 - x, Math.max(0.05, region.w / page.width)),
        height: Math.min(1 - y, Math.max(0.05, region.h / page.height)),
        fontSize: Math.max(12, Math.min(160, Math.round(Math.min(region.w, region.h) * 0.7))),
        color: '#111111',
        bold: true,
        align: 'center',
        outline: false,
      }]
    }),
  )
}

export function oppositeColor(color) {
  const match = /^#([\da-f]{6})$/i.exec(color)
  if (!match) return '#ffffff'
  const value = Number.parseInt(match[1], 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return (red * 0.299 + green * 0.587 + blue * 0.114) < 128 ? '#ffffff' : '#000000'
}

export function drawTextLayer(context, { text, x, y, fontSize, color, maxWidth, maxHeight, align = 'center', outline = false, bold = true }) {
  const font = `${bold ? 'bold ' : ''}${fontSize}px "CC Wild Words"`
  context.font = font
  context.fillStyle = color
  context.textAlign = align
  context.textBaseline = 'top'
  const textX = x + (align === 'left' ? 0 : align === 'right' ? maxWidth : maxWidth / 2)

  const lines = wrapText(context, text, maxWidth)
  const lineHeight = fontSize * 1.2

  context.save()
  context.beginPath()
  context.rect(x, y, maxWidth, maxHeight)
  context.clip()
  lines.forEach((line, index) => {
    if (outline) {
      context.fillStyle = oppositeColor(color)
      context.lineWidth = Math.max(1, fontSize * 0.16)
      context.lineJoin = 'round'
      context.strokeText(line, textX, y + index * lineHeight)
    }
    context.font = font
    context.fillStyle = color
    context.fillText(line, textX, y + index * lineHeight)
  })
  context.restore()

  return lines
}