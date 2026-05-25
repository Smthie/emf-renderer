import { IDENTITY_MATRIX, multiplyMatrices } from '../runtime/matrix.js'
import { processHotkeyPrefix } from '../runtime/text-layout.js'

const STRING_TRIMMING_NONE = 0
const STRING_TRIMMING_CHARACTER = 1
const STRING_TRIMMING_WORD = 2
const STRING_TRIMMING_ELLIPSIS_CHARACTER = 3
const STRING_TRIMMING_ELLIPSIS_WORD = 4
const STRING_TRIMMING_ELLIPSIS_PATH = 5
const ELLIPSIS = '…'
const TEXT_WIDTH_EPSILON = 0.001
const VECTOR_EPSILON = 0.000001
const DEFAULT_TAB_SPACE_COUNT = 4
const DEFAULT_LINE_HEIGHT_SCALE = 1.2
const ROP2_NOTCOPYPEN = 0x04
const ROP2_XORPEN = 0x07
const ROP2_COPYPEN = 0x0d
const PEN_ALIGNMENT_CENTER = 0
const PEN_ALIGNMENT_INSET = 1
const BLACKNESS = 0x00000042
const PATCOPY = 0x00f00021
const SRCCOPY = 0x00cc0020
const SRCAND = 0x008800c6
const SRCPAINT = 0x00ee0086
const SRCINVERT = 0x00660046
const WHITENESS = 0x00ff0062
const AC_SRC_OVER = 0x00
const MAX_WRAPPED_GRADIENT_TILES = 512
const MAX_WRAPPED_GRADIENT_STOPS = 2048

function createFallbackContext() {
  return {
    clearRect() {},
    save() {},
    restore() {},
    setTransform() {},
    translate() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    ellipse() {},
    rect() {},
    clip() {},
    drawImage() {},
    fillText() {},
    setLineDash() {},
    createLinearGradient() {
      return {
        addColorStop() {}
      }
    },
    createRadialGradient() {
      return {
        addColorStop() {}
      }
    },
    createPattern() {
      return {
        setTransform() {}
      }
    },
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }
    },
    getImageData(x, y, width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }
    },
    putImageData() {}
  }
}

function createFallbackSurface(width, height) {
  const context = createFallbackContext()

  return {
    __canvasBackendImageSource: false,
    width,
    height,
    getContext(kind) {
      return kind === '2d' ? context : null
    }
  }
}

function resolveImageSource(image) {
  const source = image?.canvas ?? image?.element ?? null

  if (source?.__canvasBackendImageSource === false) {
    return null
  }

  return source
}

function markSurface(surface, canDrawImage) {
  if (surface && typeof surface === 'object') {
    surface.__canvasBackendImageSource = canDrawImage
  }

  return surface
}

function rectToBounds(rect) {
  return {
    x: Math.min(rect.left, rect.right),
    y: Math.min(rect.top, rect.bottom),
    width: Math.abs(rect.right - rect.left),
    height: Math.abs(rect.bottom - rect.top)
  }
}

function ellipseToBounds(rect) {
  return rectToBounds(rect)
}

function accumulateBounds(bounds, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return bounds
  }

  if (!bounds) {
    return {
      minX: x,
      minY: y,
      maxX: x,
      maxY: y
    }
  }

  bounds.minX = Math.min(bounds.minX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.maxY = Math.max(bounds.maxY, y)
  return bounds
}

function boundsToRect(bounds) {
  if (!bounds) {
    return null
  }

  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  }
}

function pathToBounds(path) {
  let bounds = null

  for (const figure of path?.figures ?? []) {
    for (const point of figure.points ?? []) {
      bounds = accumulateBounds(bounds, point.x, point.y)
    }

    for (const segment of figure.segments ?? []) {
      if (segment.type === 'bezier') {
        bounds = accumulateBounds(bounds, segment.control1.x, segment.control1.y)
        bounds = accumulateBounds(bounds, segment.control2.x, segment.control2.y)
      }

      if (segment.type === 'arc') {
        bounds = accumulateBounds(bounds, segment.center.x - segment.radiusX, segment.center.y - segment.radiusY)
        bounds = accumulateBounds(bounds, segment.center.x + segment.radiusX, segment.center.y + segment.radiusY)
      }

      bounds = accumulateBounds(bounds, segment.point.x, segment.point.y)
    }
  }

  return boundsToRect(bounds)
}

function normalizeBounds(bounds) {
  if (!bounds) {
    return null
  }

  return {
    x: bounds.width >= 0 ? bounds.x : bounds.x + bounds.width,
    y: bounds.height >= 0 ? bounds.y : bounds.y + bounds.height,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height)
  }
}

function insetRectBounds(bounds, inset) {
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: bounds.width - inset * 2,
    height: bounds.height - inset * 2
  }
}

function isAffineMatrix(matrix) {
  return Array.isArray(matrix) && matrix.length === 6 && matrix.every((value) => Number.isFinite(value))
}

function transformPoint(matrix, point) {
  if (!isAffineMatrix(matrix)) {
    return point
  }

  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
  }
}

function transformPathGeometry(path, matrix) {
  if (!isAffineMatrix(matrix)) {
    return path
  }

  return {
    ...path,
    figures: (path?.figures ?? []).map((figure) => ({
      ...figure,
      points: (figure.points ?? []).map((point) => transformPoint(matrix, point)),
      segments: Array.isArray(figure.segments)
        ? figure.segments.map((segment) => ({
            ...segment,
            control1: segment.control1 ? transformPoint(matrix, segment.control1) : segment.control1,
            control2: segment.control2 ? transformPoint(matrix, segment.control2) : segment.control2,
            center: segment.center ? transformPoint(matrix, segment.center) : segment.center,
            point: segment.point ? transformPoint(matrix, segment.point) : segment.point
          }))
        : figure.segments
    }))
  }
}

function resolveTextWidth(metrics, text, fallbackWidth) {
  if (Number.isFinite(metrics?.width) && metrics.width >= 0) {
    return metrics.width
  }

  if (Number.isFinite(fallbackWidth) && fallbackWidth > 0) {
    return fallbackWidth
  }

  return String(text ?? '').length * 10
}

function extractFontSize(font, cssFont) {
  if (Number.isFinite(font?.height) && font.height !== 0) {
    return Math.max(1, Math.abs(font.height))
  }

  const match = typeof cssFont === 'string' ? cssFont.match(/(\d+(?:\.\d+)?)px/) : null

  return match ? Math.max(1, Number.parseFloat(match[1])) : 10
}

function measureTextWidth(ctx, text, fallbackWidth) {
  const value = String(text ?? '')
  const metrics = typeof ctx?.measureText === 'function' ? ctx.measureText(value) : null

  return resolveTextWidth(metrics, value, fallbackWidth)
}

function fitCharacterPrefix(text, maxWidth, measure, suffix = '') {
  const chars = Array.from(String(text ?? ''))
  let low = 0
  let high = chars.length
  let best = ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${chars.slice(0, middle).join('')}${suffix}`

    if (measure(candidate) <= maxWidth + TEXT_WIDTH_EPSILON) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return best
}

function resolveWordPrefixCandidates(text) {
  const value = String(text ?? '')

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    const candidates = []

    for (const segment of segmenter.segment(value)) {
      const end = segment.index + segment.segment.length

      if (segment.isWordLike || (!/\s/.test(segment.segment) && segment.segment !== '')) {
        candidates.push(value.slice(0, end).trimEnd())
      }
    }

    return candidates.length > 0 ? candidates : splitTextGraphemes(value)
  }

  const words = value.trim().split(/\s+/).filter(Boolean)

  if (words.length > 0) {
    return words.map((_word, index) => words.slice(0, index + 1).join(' '))
  }

  return splitTextGraphemes(value).map((_cluster, index, clusters) => clusters.slice(0, index + 1).join(''))
}

function fitWordPrefix(text, maxWidth, measure, suffix = '') {
  const candidates = resolveWordPrefixCandidates(text)
  let low = 0
  let high = candidates.length
  let best = suffix && measure(suffix) <= maxWidth + TEXT_WIDTH_EPSILON ? suffix : ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prefix = middle > 0 ? candidates[middle - 1] : ''
    const candidate = prefix ? `${prefix}${suffix}` : suffix

    if (measure(candidate) <= maxWidth + TEXT_WIDTH_EPSILON) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return best
}

function trimTextToWidth(text, trimming, maxWidth, ctx) {
  const value = String(text ?? '')
  const mode = Number.isFinite(trimming) ? trimming : STRING_TRIMMING_NONE

  if (mode === STRING_TRIMMING_NONE || !Number.isFinite(maxWidth) || maxWidth < 0) {
    return value
  }

  const measure = (candidate) => measureTextWidth(ctx, candidate)

  if (measure(value) <= maxWidth + TEXT_WIDTH_EPSILON) {
    return value
  }

  if (mode === STRING_TRIMMING_CHARACTER) {
    return fitCharacterPrefix(value, maxWidth, measure)
  }

  if (mode === STRING_TRIMMING_WORD) {
    return fitWordPrefix(value, maxWidth, measure)
  }

  if (mode === STRING_TRIMMING_ELLIPSIS_CHARACTER || mode === STRING_TRIMMING_ELLIPSIS_PATH) {
    return measure(ELLIPSIS) <= maxWidth + TEXT_WIDTH_EPSILON
      ? fitCharacterPrefix(value, maxWidth, measure, ELLIPSIS)
      : ''
  }

  if (mode === STRING_TRIMMING_ELLIPSIS_WORD) {
    return fitWordPrefix(value, maxWidth, measure, ELLIPSIS)
  }

  return value
}

function hasStringTrimming(format = {}) {
  return (Number.isFinite(format.trimming) ? format.trimming : STRING_TRIMMING_NONE) !== STRING_TRIMMING_NONE
}

function resolveVisibleUnderlineRange(range, sourceText, displayText) {
  if (!range) {
    return null
  }

  const start = Math.trunc(range.start)
  const length = Math.trunc(range.length)

  if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0) {
    return null
  }

  const sourceSegment = String(sourceText ?? '').slice(start, start + length)

  if (!sourceSegment || String(displayText ?? '').slice(start, start + length) !== sourceSegment) {
    return null
  }

  return { start, length }
}

function resolveTextStartX(textAlign, x, textWidth) {
  return textAlign === 'center' ? x - textWidth / 2 : textAlign === 'right' ? x - textWidth : x
}

function resolveDecorationSegment(ctx, text, range, lineStartX) {
  const prefix = text.slice(0, range.start)
  const segment = text.slice(range.start, range.start + range.length)
  const startX = lineStartX + measureTextWidth(ctx, prefix)

  return {
    startX,
    endX: startX + measureTextWidth(ctx, segment)
  }
}

function splitTextLayoutLines(text) {
  const value = String(text ?? '')
  const lines = []
  const newlinePattern = /\r\n|\r|\n/g
  let lineStart = 0
  let match

  while ((match = newlinePattern.exec(value)) !== null) {
    lines.push({
      text: value.slice(lineStart, match.index),
      start: lineStart
    })
    lineStart = match.index + match[0].length
  }

  lines.push({
    text: value.slice(lineStart),
    start: lineStart
  })

  return lines
}

function createLayoutLine(text, start) {
  return {
    text,
    start
  }
}

function resolveWrapSegments(text) {
  const value = String(text ?? '')

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    return Array.from(segmenter.segment(value), (entry) => ({
      text: entry.segment,
      start: entry.index
    }))
  }

  const segments = []
  const pattern = /\s+|\S+/g
  let match

  while ((match = pattern.exec(value)) !== null) {
    segments.push({
      text: match[0],
      start: match.index
    })
  }

  return segments.length > 0 ? segments : [{ text: value, start: 0 }]
}

function splitLongWrapSegment(ctx, segment, maxWidth) {
  const clusters = splitTextGraphemes(segment.text)
  const lines = []
  let current = ''
  let currentStart = segment.start

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index]
    const candidate = `${current}${cluster}`

    if (current && measureTextWidth(ctx, candidate) > maxWidth + TEXT_WIDTH_EPSILON) {
      lines.push(createLayoutLine(current, currentStart))
      current = cluster
      currentStart = segment.start + currentStartOffset(clusters, index)
      continue
    }

    current = candidate
  }

  if (current) {
    lines.push(createLayoutLine(current, currentStart))
  }

  return lines
}

function currentStartOffset(clusters, index) {
  let offset = 0

  for (let cursor = 0; cursor < index; cursor += 1) {
    offset += clusters[cursor].length
  }

  return offset
}

function wrapLayoutLine(ctx, line, maxWidth, format = {}) {
  if (
    format.noWrap ||
    !Number.isFinite(maxWidth) ||
    maxWidth <= 0 ||
    measureTextWidth(ctx, line.text) <= maxWidth + TEXT_WIDTH_EPSILON
  ) {
    return [line]
  }

  const wrapped = []
  const segments = resolveWrapSegments(line.text)
  let current = ''
  let currentStart = line.start

  const pushCurrent = () => {
    if (!current) {
      return
    }

    wrapped.push(createLayoutLine(current.trimEnd(), currentStart))
    current = ''
  }

  for (const segment of segments) {
    const segmentText = segment.text
    const segmentStart = line.start + segment.start
    const candidate = `${current}${segmentText}`

    if (!current) {
      if (measureTextWidth(ctx, segmentText) > maxWidth + TEXT_WIDTH_EPSILON && !/^\s+$/.test(segmentText)) {
        wrapped.push(...splitLongWrapSegment(ctx, { text: segmentText, start: segmentStart }, maxWidth))
      } else if (!/^\s+$/.test(segmentText)) {
        current = segmentText
        currentStart = segmentStart
      }
      continue
    }

    if (measureTextWidth(ctx, candidate) <= maxWidth + TEXT_WIDTH_EPSILON) {
      current = candidate
      continue
    }

    pushCurrent()

    if (/^\s+$/.test(segmentText)) {
      continue
    }

    if (measureTextWidth(ctx, segmentText) > maxWidth + TEXT_WIDTH_EPSILON) {
      wrapped.push(...splitLongWrapSegment(ctx, { text: segmentText, start: segmentStart }, maxWidth))
    } else {
      current = segmentText
      currentStart = segmentStart
    }
  }

  pushCurrent()

  return wrapped.length > 0 ? wrapped : [line]
}

function resolveLayoutLines(ctx, text, maxWidth, format = {}) {
  const explicitLines = splitTextLayoutLines(text)

  if (
    format.disableAutoWrap ||
    format.noWrap ||
    hasStringTrimming(format) ||
    hasGlyphRunSpacing(format) ||
    format.explicitMaxWidth !== undefined
  ) {
    return explicitLines
  }

  return explicitLines.flatMap((line) => wrapLayoutLine(ctx, line, maxWidth, format))
}

function applyLineLimit(lines, bounds, y, lineHeight, format = {}, requireFullLine = true) {
  if (!format.lineLimit || !requireFullLine) {
    return lines
  }

  if (!Number.isFinite(bounds.height) || bounds.height <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
    return []
  }

  const maxLines = Math.max(0, Math.floor((bounds.y + bounds.height - y) / lineHeight))

  return lines.slice(0, maxLines)
}

function sliceTextRange(range, start, length) {
  if (!range) {
    return null
  }

  const rangeStart = Math.trunc(range.start)
  const rangeEnd = rangeStart + Math.trunc(range.length)
  const sliceStart = start
  const sliceEnd = start + length
  const visibleStart = Math.max(rangeStart, sliceStart)
  const visibleEnd = Math.min(rangeEnd, sliceEnd)

  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeStart < 0 ||
    visibleStart >= visibleEnd
  ) {
    return null
  }

  return {
    start: visibleStart - sliceStart,
    length: visibleEnd - visibleStart
  }
}

function resolveTabAdvanceWidth(ctx, format = {}) {
  if (Number.isFinite(format.firstTabOffset) && format.firstTabOffset > 0) {
    return format.firstTabOffset
  }

  return measureTextWidth(ctx, ' '.repeat(DEFAULT_TAB_SPACE_COUNT))
}

function resolveNextTabStop(cursor, tabWidth) {
  if (!Number.isFinite(tabWidth) || tabWidth <= 0) {
    return cursor
  }

  return Math.max(tabWidth, Math.ceil((cursor + TEXT_WIDTH_EPSILON) / tabWidth) * tabWidth)
}

function expandTabsForLine(ctx, text, format = {}) {
  const value = String(text ?? '')

  if (!value.includes('\t')) {
    return {
      text: value,
      mapRange(range) {
        return range
      }
    }
  }

  const tabWidth = resolveTabAdvanceWidth(ctx, format)
  const spaceWidth = Math.max(1, measureTextWidth(ctx, ' '))
  const sourceToExpanded = []
  let expanded = ''
  let cursor = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    sourceToExpanded[index] = expanded.length

    if (char === '\t') {
      const nextTabStop = resolveNextTabStop(cursor, tabWidth)
      const spaces = Math.max(1, Math.ceil((nextTabStop - cursor) / spaceWidth))
      expanded += ' '.repeat(spaces)
      cursor += spaces * spaceWidth
      continue
    }

    expanded += char
    cursor += measureTextWidth(ctx, char)
  }

  sourceToExpanded[value.length] = expanded.length

  return {
    text: expanded,
    mapRange(range) {
      if (!range) {
        return null
      }

      const start = sourceToExpanded[range.start]
      const end = sourceToExpanded[range.start + range.length]

      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return null
      }

      return {
        start,
        length: end - start
      }
    }
  }
}

function resolveTextLineHeight(fontSize, format = {}) {
  return Number.isFinite(format.lineHeight) && format.lineHeight > 0
    ? format.lineHeight
    : fontSize * DEFAULT_LINE_HEIGHT_SCALE
}

function splitTextGraphemes(text) {
  const value = String(text ?? '')

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), (entry) => entry.segment)
  }

  return Array.from(value)
}

function hasGlyphRunSpacing(format = {}) {
  return (
    format.directionVertical === true ||
    (Array.isArray(format.advanceDx) && format.advanceDx.length > 0) ||
    (Number.isFinite(format.tracking) && format.tracking !== 0) ||
    (Number.isFinite(format.textJustificationExtra) && format.textJustificationExtra !== 0)
  )
}

function resolveJustificationAdvance(cluster, format = {}) {
  if (!/\s/.test(cluster)) {
    return 0
  }

  const count = Number.isFinite(format.textJustificationCount) ? format.textJustificationCount : 0
  const extra = Number.isFinite(format.textJustificationExtra) ? format.textJustificationExtra : 0

  return count > 0 ? extra / count : extra
}

function resolveGlyphAdvance(ctx, cluster, index, format = {}) {
  const explicitAdvance = Array.isArray(format.advanceDx) ? format.advanceDx[index] : null
  const tracking = Number.isFinite(format.tracking) ? format.tracking : 0

  if (explicitAdvance) {
    return {
      x: (Number.isFinite(explicitAdvance.x) ? explicitAdvance.x : 0) + tracking + resolveJustificationAdvance(cluster, format),
      y: Number.isFinite(explicitAdvance.y) ? explicitAdvance.y : 0
    }
  }

  return {
    x: measureTextWidth(ctx, cluster) + tracking + resolveJustificationAdvance(cluster, format),
    y: 0
  }
}

function createGlyphRun(ctx, text, x, y, format = {}) {
  const clusters = splitTextGraphemes(text)
  const glyphs = []
  let cursorX = x
  let cursorY = y
  let width = 0
  let height = 0
  const verticalAdvance = Number.isFinite(format.verticalAdvance) ? format.verticalAdvance : 0

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index]
    const advance =
      format.directionVertical === true
        ? {
            x: 0,
            y: verticalAdvance + (Number.isFinite(format.tracking) ? format.tracking : 0)
          }
        : resolveGlyphAdvance(ctx, cluster, index, format)

    glyphs.push({
      text: cluster,
      x: cursorX,
      y: cursorY,
      advance
    })
    cursorX += advance.x
    cursorY += advance.y
    width += advance.x
    height += advance.y
  }

  return {
    glyphs,
    width,
    height,
    endX: cursorX,
    endY: cursorY
  }
}

function warnTextFormatApproximation(format = {}) {
  if (typeof format.addWarning !== 'function') {
    return
  }

  if (format.directionVertical) {
    format.addWarning('Canvas backend approximates StringFormatFlags.DirectionVertical with a top-to-bottom glyph run')
  }

  if (format.displayFormatControl) {
    format.addWarning('Canvas backend does not render StringFormatFlags.DisplayFormatControl control glyphs')
  }

  if (format.noFontFallback) {
    format.addWarning('Canvas backend cannot disable browser font fallback for StringFormatFlags.NoFontFallback')
  }

  if (format.lineLimit) {
    format.addWarning('Canvas backend approximates StringFormatFlags.LineLimit for wrapped or clipped text layout')
  }
}

function resolveDashPattern(stroke) {
  if (Array.isArray(stroke?.dashPattern) && stroke.dashPattern.length > 0) {
    const penWidth = Number.isFinite(stroke.width) && stroke.width > 0 ? stroke.width : 1
    const scale = stroke.dashPatternUnit === 'penWidth' ? penWidth : 1
    return stroke.dashPattern.map((value) => value * scale)
  }

  const unit = Math.max(stroke?.width || 1, 1)

  return (
    {
      dash: [4 * unit, 2 * unit],
      dot: [unit, unit],
      dashDot: [4 * unit, 2 * unit, unit, 2 * unit],
      dashDotDot: [4 * unit, 2 * unit, unit, 2 * unit, unit, 2 * unit]
    }[stroke?.dashStyle] || []
  )
}

function hasDashStroke(stroke) {
  return resolveDashPattern(stroke).length > 0
}

function isTriangleDashStroke(stroke = {}) {
  return hasDashStroke(stroke) && stroke.dashCap === 'triangle' && !stroke.customStartCap && !stroke.customEndCap
}

function resolveDashLineSegments(from, to, stroke = {}) {
  const direction = vectorBetween(from, to)

  if (!direction) {
    return null
  }

  const pattern = resolveDashPattern(stroke).filter((value) => Number.isFinite(value) && value > VECTOR_EPSILON)

  if (pattern.length === 0) {
    return null
  }

  if (pattern.length % 2 === 1) {
    pattern.push(...pattern)
  }

  const lineLength = Math.hypot(to.x - from.x, to.y - from.y)
  const patternLength = pattern.reduce((sum, value) => sum + value, 0)

  if (patternLength <= VECTOR_EPSILON) {
    return null
  }

  let offset = Number.isFinite(stroke.dashOffset) ? stroke.dashOffset : 0
  offset = ((offset % patternLength) + patternLength) % patternLength

  let patternIndex = 0

  while (offset >= pattern[patternIndex] && pattern[patternIndex] > VECTOR_EPSILON) {
    offset -= pattern[patternIndex]
    patternIndex = (patternIndex + 1) % pattern.length
  }

  let cursor = -offset
  const segments = []

  while (cursor < lineLength - VECTOR_EPSILON) {
    const length = pattern[patternIndex]
    const start = Math.max(cursor, 0)
    const end = Math.min(cursor + length, lineLength)

    if (patternIndex % 2 === 0 && end - start > VECTOR_EPSILON) {
      segments.push({
        from: {
          x: from.x + direction.x * start,
          y: from.y + direction.y * start
        },
        to: {
          x: from.x + direction.x * end,
          y: from.y + direction.y * end
        },
        direction
      })
    }

    cursor += length
    patternIndex = (patternIndex + 1) % pattern.length
  }

  return segments
}

function resolveUniformTransformScale(matrix) {
  if (!isAffineMatrix(matrix)) {
    return 1
  }

  const scaleX = Math.hypot(matrix[0], matrix[1])
  const scaleY = Math.hypot(matrix[2], matrix[3])
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3]

  if (scaleX <= VECTOR_EPSILON || scaleY <= VECTOR_EPSILON) {
    return 1
  }

  if (Math.abs(scaleX - scaleY) > VECTOR_EPSILON || Math.abs(dot) > VECTOR_EPSILON) {
    return 1
  }

  return scaleX
}

function classifyPenTransform(matrix) {
  if (!Array.isArray(matrix)) {
    return { kind: 'none', scale: 1 }
  }

  if (!isAffineMatrix(matrix)) {
    return { kind: 'unsupported', scale: 1 }
  }

  const scaleX = Math.hypot(matrix[0], matrix[1])
  const scaleY = Math.hypot(matrix[2], matrix[3])
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3]
  const hasRotationOrShear =
    Math.abs(matrix[1]) > VECTOR_EPSILON || Math.abs(matrix[2]) > VECTOR_EPSILON || Math.abs(dot) > VECTOR_EPSILON

  if (scaleX <= VECTOR_EPSILON || scaleY <= VECTOR_EPSILON) {
    return { kind: 'unsupported', scale: 1 }
  }

  if (Math.abs(scaleX - scaleY) > VECTOR_EPSILON) {
    return { kind: 'nonUniform', scale: 1 }
  }

  if (hasRotationOrShear) {
    return { kind: 'rotatedOrSheared', scale: 1 }
  }

  return Math.abs(scaleX - 1) > VECTOR_EPSILON ? { kind: 'uniformScale', scale: scaleX } : { kind: 'none', scale: 1 }
}

function resolveStrokeForPenTransform(stroke) {
  const scale = resolveUniformTransformScale(stroke?.transform)

  if (!stroke || Math.abs(scale - 1) <= VECTOR_EPSILON) {
    return stroke
  }

  return {
    ...stroke,
    width: (stroke.width || 1) * scale,
    dashOffset: Number.isFinite(stroke.dashOffset) ? stroke.dashOffset * scale : stroke.dashOffset,
    dashPattern:
      Array.isArray(stroke.dashPattern) && stroke.dashPatternUnit !== 'penWidth'
        ? stroke.dashPattern.map((value) => value * scale)
        : stroke.dashPattern
  }
}

function resolveCompoundStrokeSegments(stroke = {}) {
  const compound = Array.isArray(stroke.compoundArray) ? stroke.compoundArray : null
  const width = Number.isFinite(stroke.width) && stroke.width > 0 ? stroke.width : 1

  if (!compound || compound.length < 2) {
    return { kind: compound ? 'invalid' : 'none', segments: null }
  }

  if (compound.length % 2 !== 0) {
    return { kind: 'invalid', segments: null }
  }

  const segments = []
  let previousEnd = 0

  for (let index = 0; index + 1 < compound.length; index += 2) {
    const start = compound[index]
    const end = compound[index + 1]

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > 1 ||
      start >= end ||
      start < previousEnd
    ) {
      return { kind: 'invalid', segments: null }
    }

    const segmentWidth = (end - start) * width

    if (segmentWidth > TEXT_WIDTH_EPSILON) {
      segments.push({
        width: segmentWidth,
        offset: ((start + end) / 2 - 0.5) * width
      })
    }

    previousEnd = end
  }

  return segments.length > 0 ? { kind: 'valid', segments } : { kind: 'invalid', segments: null }
}

function withoutCompoundStrokeTransform(stroke = {}) {
  const { compoundArray: _compoundArray, transform: _transform, ...rest } = stroke
  return rest
}

function hasCompoundStroke(stroke = {}) {
  return Array.isArray(stroke.compoundArray) && stroke.compoundArray.length > 0
}

function hasCustomLineCaps(stroke = {}) {
  return Boolean(stroke.customStartCap || stroke.customEndCap)
}

function isInsetPenAlignment(stroke = {}) {
  return stroke.alignment === PEN_ALIGNMENT_INSET || stroke.alignment === 'inset'
}

function isUnsupportedPenAlignment(stroke = {}) {
  return (
    stroke.alignment !== undefined &&
    stroke.alignment !== PEN_ALIGNMENT_CENTER &&
    stroke.alignment !== PEN_ALIGNMENT_INSET &&
    stroke.alignment !== 'center' &&
    stroke.alignment !== 'inset'
  )
}

function createInsetStroke(stroke = {}) {
  const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}

  return {
    stroke: resolvedStroke,
    inset: (resolvedStroke.width || 1) / 2
  }
}

function offsetPointByNormal(point, normal, offset) {
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset
  }
}

function resolveSimpleOpenPolyline(path) {
  const figures = path?.figures ?? []

  if (figures.length !== 1) {
    return null
  }

  const [figure] = figures

  if (figure.closed || (Array.isArray(figure.segments) && figure.segments.length > 0)) {
    return null
  }

  const points = figure.points ?? []

  return points.length >= 2 ? points : null
}

function normalizePolylinePoints(points = []) {
  const normalized = []

  for (const point of points) {
    const previous = normalized.at(-1)

    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > VECTOR_EPSILON) {
      normalized.push(point)
    }
  }

  return normalized
}

function intersectLines(originA, directionA, originB, directionB) {
  const cross = directionA.x * directionB.y - directionA.y * directionB.x

  if (Math.abs(cross) <= VECTOR_EPSILON) {
    return null
  }

  const dx = originB.x - originA.x
  const dy = originB.y - originA.y
  const t = (dx * directionB.y - dy * directionB.x) / cross

  return {
    x: originA.x + directionA.x * t,
    y: originA.y + directionA.y * t
  }
}

function offsetPolylinePoints(points, offset) {
  const normalizedPoints = normalizePolylinePoints(points)

  if (normalizedPoints.length < 2) {
    return null
  }

  const segments = []

  for (let index = 0; index + 1 < normalizedPoints.length; index += 1) {
    const from = normalizedPoints[index]
    const to = normalizedPoints[index + 1]
    const tangent = vectorBetween(from, to)

    if (!tangent) {
      return null
    }

    segments.push({
      from,
      to,
      tangent,
      normal: {
        x: -tangent.y,
        y: tangent.x
      }
    })
  }

  const offsetPoints = [offsetPointByNormal(segments[0].from, segments[0].normal, offset)]

  for (let index = 1; index + 1 < normalizedPoints.length; index += 1) {
    const point = normalizedPoints[index]
    const previousSegment = segments[index - 1]
    const nextSegment = segments[index]
    const previousOffsetPoint = offsetPointByNormal(point, previousSegment.normal, offset)
    const nextOffsetPoint = offsetPointByNormal(point, nextSegment.normal, offset)
    const joinPoint = intersectLines(
      previousOffsetPoint,
      previousSegment.tangent,
      nextOffsetPoint,
      nextSegment.tangent
    )

    const dot = previousSegment.tangent.x * nextSegment.tangent.x + previousSegment.tangent.y * nextSegment.tangent.y

    if (!joinPoint && dot < 0) {
      return null
    }

    offsetPoints.push(
      joinPoint ?? {
        x: (previousOffsetPoint.x + nextOffsetPoint.x) / 2,
        y: (previousOffsetPoint.y + nextOffsetPoint.y) / 2
      }
    )
  }

  const lastSegment = segments.at(-1)
  offsetPoints.push(offsetPointByNormal(lastSegment.to, lastSegment.normal, offset))

  return offsetPoints
}

function resolveSimpleClosedPolygon(path) {
  const figures = path?.figures ?? []

  if (figures.length !== 1) {
    return null
  }

  const [figure] = figures

  if (!figure.closed || (Array.isArray(figure.segments) && figure.segments.length > 0)) {
    return null
  }

  const points = figure.points ?? []

  return points.length >= 3 ? points : null
}

function polygonSignedArea(points) {
  let area = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }

  return area / 2
}

function lineIntersection(leftPoint, leftDirection, rightPoint, rightDirection) {
  const cross = leftDirection.x * rightDirection.y - leftDirection.y * rightDirection.x

  if (Math.abs(cross) <= VECTOR_EPSILON) {
    return null
  }

  const delta = {
    x: rightPoint.x - leftPoint.x,
    y: rightPoint.y - leftPoint.y
  }
  const distance = (delta.x * rightDirection.y - delta.y * rightDirection.x) / cross

  return {
    x: leftPoint.x + leftDirection.x * distance,
    y: leftPoint.y + leftDirection.y * distance
  }
}

function insetClosedPolygon(points, inset) {
  if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(inset)) {
    return null
  }

  const clockwise = polygonSignedArea(points) < 0
  const lines = []

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const tangent = vectorBetween(current, next)

    if (!tangent) {
      return null
    }

    const inwardNormal = clockwise
      ? { x: tangent.y, y: -tangent.x }
      : { x: -tangent.y, y: tangent.x }

    lines.push({
      point: offsetPointByNormal(current, inwardNormal, inset),
      direction: tangent
    })
  }

  const insetPoints = []

  for (let index = 0; index < lines.length; index += 1) {
    const previous = lines[(index + lines.length - 1) % lines.length]
    const current = lines[index]
    const point = lineIntersection(previous.point, previous.direction, current.point, current.direction)

    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null
    }

    insetPoints.push(point)
  }

  return insetPoints
}

function pathFromClosedPoints(points) {
  return {
    figures: [
      {
        closed: true,
        points
      }
    ]
  }
}

function resolveDefaultCustomLineCap(cap) {
  if (cap?.kind !== 'customLineCap' || cap.type !== 'default' || cap.unsupported) {
    return null
  }

  return (
    {
      0: 'butt',
      1: 'square',
      2: 'round'
    }[cap.baseCap] ?? null
  )
}

function resolveCanvasLineCap(value, fallback = 'butt') {
  if (typeof value === 'string') {
    return value
  }

  return (
    {
      0: 'butt',
      1: 'square',
      2: 'round',
      3: 'square'
    }[value] ?? fallback
  )
}

function resolveStrokeLineCap(stroke) {
  const cap =
    resolveDefaultCustomLineCap(stroke?.customEndCap) ??
    resolveDefaultCustomLineCap(stroke?.customStartCap) ??
    stroke?.lineCap ??
    stroke?.endCap ??
    stroke?.startCap ??
    'butt'

  if (
    cap === 'butt' &&
    hasDashStroke(stroke) &&
    stroke?.dashCap &&
    stroke.dashCap !== 'butt' &&
    stroke.dashCap !== 'triangle' &&
    !stroke?.customStartCap &&
    !stroke?.customEndCap
  ) {
    return stroke.dashCap
  }

  return cap
}

function resolveCanvasLineJoin(value, fallback = 'miter') {
  if (typeof value === 'string') {
    return value === 'miterClipped' ? 'miter' : value
  }

  return (
    {
      0: 'miter',
      1: 'bevel',
      2: 'round',
      3: 'miter'
    }[value] ?? fallback
  )
}

function normalizeVector(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  const length = Math.hypot(x, y)

  if (length <= VECTOR_EPSILON) {
    return null
  }

  return {
    x: x / length,
    y: y / length
  }
}

function vectorBetween(from, to) {
  if (!from || !to) {
    return null
  }

  return normalizeVector(to.x - from.x, to.y - from.y)
}

function rotateVector(vector, rotation = 0) {
  if (!rotation) {
    return vector
  }

  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)

  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine
  }
}

function resolveArcTangent(segment, angle) {
  const direction = segment.counterclockwise ? -1 : 1
  const tangent = rotateVector(
    {
      x: -segment.radiusX * Math.sin(angle) * direction,
      y: segment.radiusY * Math.cos(angle) * direction
    },
    segment.rotation ?? 0
  )

  return normalizeVector(tangent.x, tangent.y)
}

function resolveSegmentStartTangent(startPoint, segment) {
  if (!segment) {
    return null
  }

  if (segment.type === 'arc') {
    return resolveArcTangent(segment, segment.startAngle)
  }

  if (segment.type === 'bezier') {
    return (
      vectorBetween(startPoint, segment.control1) ??
      vectorBetween(startPoint, segment.control2) ??
      vectorBetween(startPoint, segment.point)
    )
  }

  return vectorBetween(startPoint, segment.point)
}

function resolveSegmentEndTangent(startPoint, segment) {
  if (!segment) {
    return null
  }

  if (segment.type === 'arc') {
    return resolveArcTangent(segment, segment.endAngle)
  }

  if (segment.type === 'bezier') {
    return (
      vectorBetween(segment.control2, segment.point) ??
      vectorBetween(segment.control1, segment.point) ??
      vectorBetween(startPoint, segment.point)
    )
  }

  return vectorBetween(startPoint, segment.point)
}

function resolveSegmentStarts(figure) {
  const starts = []
  let current = figure.points?.[0] ?? null

  for (const segment of figure.segments ?? []) {
    starts.push(current)
    current = segment.point ?? current
  }

  return starts
}

function resolveFigureStartTangent(figure) {
  if (Array.isArray(figure.segments) && figure.segments.length > 0) {
    const starts = resolveSegmentStarts(figure)

    for (let index = 0; index < figure.segments.length; index += 1) {
      const tangent = resolveSegmentStartTangent(starts[index], figure.segments[index])

      if (tangent) {
        return tangent
      }
    }
  }

  const points = figure.points ?? []
  const startPoint = points[0]

  for (const point of points.slice(1)) {
    const tangent = vectorBetween(startPoint, point)

    if (tangent) {
      return tangent
    }
  }

  return null
}

function resolveFigureEndTangent(figure) {
  if (Array.isArray(figure.segments) && figure.segments.length > 0) {
    const starts = resolveSegmentStarts(figure)

    for (let index = figure.segments.length - 1; index >= 0; index -= 1) {
      const tangent = resolveSegmentEndTangent(starts[index], figure.segments[index])

      if (tangent) {
        return tangent
      }
    }
  }

  const points = figure.points ?? []
  const endPoint = points.at(-1)

  for (let index = points.length - 2; index >= 0; index -= 1) {
    const tangent = vectorBetween(points[index], endPoint)

    if (tangent) {
      return tangent
    }
  }

  return null
}

function createAdjustableArrowPoints(point, direction, cap, stroke) {
  const scale = Math.max(stroke?.width || 1, 0) * (Number.isFinite(cap.widthScale) ? cap.widthScale : 1)
  const width = Math.max(Number.isFinite(cap.width) ? cap.width : 0, 0) * scale
  const height = Math.max(Number.isFinite(cap.height) ? cap.height : 0, 0) * scale

  if (width <= VECTOR_EPSILON || height <= VECTOR_EPSILON) {
    return null
  }

  const halfWidth = width / 2
  const inset = Math.max(0, Math.min(height, (Number.isFinite(cap.middleInset) ? cap.middleInset : 0) * scale))
  const normal = {
    x: -direction.y,
    y: direction.x
  }
  const base = {
    x: point.x - direction.x * height,
    y: point.y - direction.y * height
  }
  const points = [
    point,
    {
      x: base.x + normal.x * halfWidth,
      y: base.y + normal.y * halfWidth
    }
  ]

  if (inset > VECTOR_EPSILON) {
    points.push({
      x: base.x + direction.x * inset,
      y: base.y + direction.y * inset
    })
  }

  points.push({
    x: base.x - normal.x * halfWidth,
    y: base.y - normal.y * halfWidth
  })

  return points
}

function createTriangleDashCapPoints(point, direction, stroke) {
  const width = Math.max(stroke?.width || 1, 0)

  if (width <= VECTOR_EPSILON) {
    return null
  }

  const normal = {
    x: -direction.y,
    y: direction.x
  }
  const halfWidth = width / 2

  return [
    point,
    {
      x: point.x - direction.x * width + normal.x * halfWidth,
      y: point.y - direction.y * width + normal.y * halfWidth
    },
    {
      x: point.x - direction.x * width - normal.x * halfWidth,
      y: point.y - direction.y * width - normal.y * halfWidth
    }
  ]
}

function hasDefaultCustomLineCapPath(cap) {
  return cap?.kind === 'customLineCap' && cap.type === 'default' && !cap.unsupported && (cap.fillPath || cap.linePath)
}

function isDrawableCustomLineCap(cap) {
  return cap?.type === 'adjustableArrow' || hasDefaultCustomLineCapPath(cap)
}

function createDefaultCustomLineCapMatrix(point, direction, cap, stroke, hotSpot = null) {
  const scale = Math.max(stroke?.width || 1, 0) * (Number.isFinite(cap.widthScale) ? cap.widthScale : 1)

  if (scale <= VECTOR_EPSILON) {
    return null
  }

  const baseInset = Number.isFinite(cap.baseInset) ? cap.baseInset * scale : 0
  const origin = {
    x: point.x + direction.x * baseInset,
    y: point.y + direction.y * baseInset
  }
  const normal = {
    x: -direction.y,
    y: direction.x
  }
  const matrix = [direction.x * scale, direction.y * scale, normal.x * scale, normal.y * scale, origin.x, origin.y]

  if (hotSpot && Number.isFinite(hotSpot.x) && Number.isFinite(hotSpot.y)) {
    matrix[4] -= matrix[0] * hotSpot.x + matrix[2] * hotSpot.y
    matrix[5] -= matrix[1] * hotSpot.x + matrix[3] * hotSpot.y
  }

  return matrix
}

function parseCssColor(color) {
  if (typeof color !== 'string') {
    return null
  }

  const match = color.match(/rgba?\(\s*([^\)]+)\s*\)/i)

  if (!match) {
    return null
  }

  const components = match[1].split(',').map((value) => Number.parseFloat(value.trim()))

  if (components.length < 3 || components.slice(0, 3).some((value) => !Number.isFinite(value))) {
    return null
  }

  return {
    red: components[0],
    green: components[1],
    blue: components[2],
    alpha: Number.isFinite(components[3]) ? components[3] : 1
  }
}

function invertCssColor(color) {
  const parsed = parseCssColor(color)

  if (!parsed) {
    return null
  }

  return formatCssColor({
    red: 255 - parsed.red,
    green: 255 - parsed.green,
    blue: 255 - parsed.blue,
    alpha: parsed.alpha
  })
}

function averageCssColors(colors) {
  const parsed = colors.map(parseCssColor).filter(Boolean)

  if (parsed.length === 0) {
    return null
  }

  const totals = parsed.reduce(
    (sum, color) => ({
      red: sum.red + color.red,
      green: sum.green + color.green,
      blue: sum.blue + color.blue,
      alpha: sum.alpha + color.alpha
    }),
    { red: 0, green: 0, blue: 0, alpha: 0 }
  )

  return `rgba(${Math.round(totals.red / parsed.length)}, ${Math.round(totals.green / parsed.length)}, ${Math.round(totals.blue / parsed.length)}, ${totals.alpha / parsed.length})`
}

function resolveCanvasCompositeOperation(mode) {
  if (mode === 'sourceCopy') {
    return 'copy'
  }

  return 'source-over'
}

function resolveImageSmoothing(interpolationMode) {
  if (interpolationMode === 5 || interpolationMode === 'nearestNeighbor') {
    return {
      enabled: false,
      quality: 'low'
    }
  }

  if (interpolationMode === 1 || interpolationMode === 'lowQuality') {
    return {
      enabled: true,
      quality: 'low'
    }
  }

  if (
    interpolationMode === 2 ||
    interpolationMode === 4 ||
    interpolationMode === 7 ||
    interpolationMode === 'highQuality' ||
    interpolationMode === 'bicubic' ||
    interpolationMode === 'highQualityBicubic'
  ) {
    return {
      enabled: true,
      quality: 'high'
    }
  }

  return {
    enabled: true,
    quality: 'medium'
  }
}

function resolveStretchModeSmoothing(stretchMode) {
  if (stretchMode === 1 || stretchMode === 2 || stretchMode === 3) {
    return {
      enabled: false,
      quality: 'low'
    }
  }

  if (stretchMode === 4) {
    return {
      enabled: true,
      quality: 'high'
    }
  }

  return null
}

function resolvePixelOffset(pixelOffsetMode) {
  if (pixelOffsetMode === 4 || pixelOffsetMode === 'half') {
    return { x: 0.5, y: 0.5 }
  }

  return { x: 0, y: 0 }
}

function resolveRop2CompositeOperation(rop2) {
  if (rop2 === ROP2_XORPEN) {
    return 'xor'
  }

  return null
}

function isSupportedRop2(rop2) {
  return rop2 === ROP2_COPYPEN || rop2 === ROP2_NOTCOPYPEN || rop2 === ROP2_XORPEN
}

function formatCssColor(color) {
  return `rgba(${clampColorChannel(color.red)}, ${clampColorChannel(color.green)}, ${clampColorChannel(color.blue)}, ${clampUnit(color.alpha)})`
}

function formatOpaqueCssColor(color) {
  return `rgb(${clampColorChannel(color.red)}, ${clampColorChannel(color.green)}, ${clampColorChannel(color.blue)})`
}

function mixCssColors(startColor, endColor, factor) {
  const start = parseCssColor(startColor)
  const end = parseCssColor(endColor)

  if (!start || !end) {
    return factor <= 0 ? endColor : startColor
  }

  const startAmount = clampUnit(factor)
  const endAmount = 1 - startAmount

  return formatCssColor({
    red: start.red * startAmount + end.red * endAmount,
    green: start.green * startAmount + end.green * endAmount,
    blue: start.blue * startAmount + end.blue * endAmount,
    alpha: start.alpha * startAmount + end.alpha * endAmount
  })
}

function resolveGradientStops(brush, startColor, endColor) {
  if (
    Array.isArray(brush.presetColors) &&
    Array.isArray(brush.presetPositions) &&
    brush.presetColors.length === brush.presetPositions.length &&
    brush.presetColors.length > 0
  ) {
    return brush.presetPositions
      .map((offset, index) => [offset, brush.presetColors[index]])
      .filter(([offset]) => Number.isFinite(offset))
      .map(([offset, color]) => [clampUnit(offset), color])
  }

  if (
    Array.isArray(brush.blendFactors) &&
    Array.isArray(brush.blendPositions) &&
    brush.blendFactors.length === brush.blendPositions.length &&
    brush.blendFactors.length > 0
  ) {
    return brush.blendPositions
      .map((offset, index) => [offset, mixCssColors(startColor, endColor, brush.blendFactors[index])])
      .filter(([offset]) => Number.isFinite(offset))
      .map(([offset, color]) => [clampUnit(offset), color])
  }

  return [
    [0, startColor],
    [1, endColor]
  ]
}

function projectPointOntoAxis(point, startPoint, delta, lengthSquared) {
  return (
    ((point.x - startPoint.x) * delta.x + (point.y - startPoint.y) * delta.y) /
    lengthSquared
  )
}

function expandWrappedGradient(startPoint, endPoint, stops, bounds, wrapMode) {
  if (!bounds || !['tile', 'tileFlipX', 'tileFlipY', 'tileFlipXY'].includes(wrapMode)) {
    return { startPoint, endPoint, stops }
  }

  const delta = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y
  }
  const lengthSquared = delta.x * delta.x + delta.y * delta.y

  if (!(lengthSquared > VECTOR_EPSILON)) {
    return { startPoint, endPoint, stops }
  }

  const normalizedBounds = normalizeBounds(bounds)
  const corners = [
    { x: normalizedBounds.x, y: normalizedBounds.y },
    { x: normalizedBounds.x + normalizedBounds.width, y: normalizedBounds.y },
    { x: normalizedBounds.x, y: normalizedBounds.y + normalizedBounds.height },
    {
      x: normalizedBounds.x + normalizedBounds.width,
      y: normalizedBounds.y + normalizedBounds.height
    }
  ]
  const projections = corners.map((point) =>
    projectPointOntoAxis(point, startPoint, delta, lengthSquared)
  )
  const firstTile = Math.floor(Math.min(...projections))
  const lastTile = Math.ceil(Math.max(...projections))
  const tileCount = lastTile - firstTile

  if (
    tileCount < 1 ||
    tileCount > MAX_WRAPPED_GRADIENT_TILES ||
    tileCount * stops.length > MAX_WRAPPED_GRADIENT_STOPS
  ) {
    return { startPoint, endPoint, stops }
  }

  const expandedStops = []
  const flipsAlongGradient = wrapMode === 'tileFlipX' || wrapMode === 'tileFlipXY'

  for (let tileOffset = 0; tileOffset < tileCount; tileOffset += 1) {
    const tileIndex = firstTile + tileOffset
    const flipped = flipsAlongGradient && Math.abs(tileIndex % 2) === 1
    const tileStops = flipped
      ? stops.map(([offset, color]) => [1 - offset, color]).reverse()
      : stops

    for (const [offset, color] of tileStops) {
      expandedStops.push([(tileOffset + offset) / tileCount, color])
    }
  }

  return {
    startPoint: {
      x: startPoint.x + delta.x * firstTile,
      y: startPoint.y + delta.y * firstTile
    },
    endPoint: {
      x: startPoint.x + delta.x * lastTile,
      y: startPoint.y + delta.y * lastTile
    },
    stops: expandedStops
  }
}

function toPatternRepetition(wrapMode) {
  return wrapMode === 'clamp' ? 'no-repeat' : 'repeat'
}

function normalizeImageRect(rect, source) {
  if (!rect) {
    const width = source?.width ?? 0
    const height = source?.height ?? 0

    return width > 0 && height > 0
      ? { x: 0, y: 0, width, height }
      : null
  }

  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  }
}

function shouldPadWrappedImage(imageAttributes) {
  return (
    imageAttributes?.kind === 'imageAttributes' &&
    !(
      imageAttributes.wrapMode === 'tileFlipXY' &&
      imageAttributes.wrapColor === 'rgba(0, 0, 0, 0)' &&
      imageAttributes.clamp === false &&
      imageAttributes.objectClamp === false
    ) &&
    ['tile', 'tileFlipX', 'tileFlipY', 'tileFlipXY', 'clamp'].includes(imageAttributes.wrapMode)
  )
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value))
}

function isTransparentColor(color) {
  const parsed = parseCssColor(color)
  return !parsed || parsed.alpha <= 0
}

function rgbToHsl(red, green, blue) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2

  if (max === min) {
    return { hue: 0, saturation: 0, lightness }
  }

  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue

  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0)
      break
    case g:
      hue = (b - r) / delta + 2
      break
    default:
      hue = (r - g) / delta + 4
      break
  }

  return {
    hue: hue / 6,
    saturation,
    lightness
  }
}

function hueToRgb(p, q, t) {
  let value = t

  if (value < 0) {
    value += 1
  }

  if (value > 1) {
    value -= 1
  }

  if (value < 1 / 6) {
    return p + (q - p) * 6 * value
  }

  if (value < 1 / 2) {
    return q
  }

  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6
  }

  return p
}

function hslToRgb(hue, saturation, lightness) {
  const normalizedHue = ((hue % 1) + 1) % 1
  const normalizedSaturation = clampUnit(saturation)
  const normalizedLightness = clampUnit(lightness)

  if (normalizedSaturation === 0) {
    const gray = clampColorChannel(normalizedLightness * 255)
    return {
      red: gray,
      green: gray,
      blue: gray
    }
  }

  const q =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation
  const p = 2 * normalizedLightness - q

  return {
    red: clampColorChannel(hueToRgb(p, q, normalizedHue + 1 / 3) * 255),
    green: clampColorChannel(hueToRgb(p, q, normalizedHue) * 255),
    blue: clampColorChannel(hueToRgb(p, q, normalizedHue - 1 / 3) * 255)
  }
}

function forEachPixel(data, callback) {
  for (let index = 0; index < data.length; index += 4) {
    const next = callback({
      red: data[index],
      green: data[index + 1],
      blue: data[index + 2],
      alpha: data[index + 3]
    })

    if (!next) {
      continue
    }

    data[index] = clampColorChannel(next.red)
    data[index + 1] = clampColorChannel(next.green)
    data[index + 2] = clampColorChannel(next.blue)
    data[index + 3] = clampColorChannel(next.alpha)
  }
}

function applyColorMatrixToPixels(data, matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 5) {
    return
  }

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] / 255
    const green = data[index + 1] / 255
    const blue = data[index + 2] / 255
    const alpha = data[index + 3] / 255
    const vector = [red, green, blue, alpha, 1]

    data[index] = clampColorChannel(
      vector.reduce((sum, value, row) => sum + value * (matrix[row]?.[0] ?? 0), 0) * 255
    )
    data[index + 1] = clampColorChannel(
      vector.reduce((sum, value, row) => sum + value * (matrix[row]?.[1] ?? 0), 0) * 255
    )
    data[index + 2] = clampColorChannel(
      vector.reduce((sum, value, row) => sum + value * (matrix[row]?.[2] ?? 0), 0) * 255
    )
    data[index + 3] = clampColorChannel(
      vector.reduce((sum, value, row) => sum + value * (matrix[row]?.[3] ?? 0), 0) * 255
    )
  }
}

function applyBrightnessContrastToPixels(data, effect) {
  const brightness = Math.max(-255, Math.min(255, effect.brightnessLevel ?? 0))
  const contrast = Math.max(-100, Math.min(100, effect.contrastLevel ?? 0)) * 2.55
  const factor = contrast === 255 ? 255 : (259 * (contrast + 255)) / (255 * (259 - contrast))

  forEachPixel(data, (pixel) => ({
    red: factor * (pixel.red + brightness - 128) + 128,
    green: factor * (pixel.green + brightness - 128) + 128,
    blue: factor * (pixel.blue + brightness - 128) + 128,
    alpha: pixel.alpha
  }))
}

function applyColorBalanceToPixels(data, effect) {
  const redDelta = ((effect.cyanRed ?? 0) * 255) / 100
  const greenDelta = ((effect.magentaGreen ?? 0) * 255) / 100
  const blueDelta = ((effect.yellowBlue ?? 0) * 255) / 100

  forEachPixel(data, (pixel) => ({
    red: pixel.red + redDelta,
    green: pixel.green + greenDelta,
    blue: pixel.blue + blueDelta,
    alpha: pixel.alpha
  }))
}

function applyHueSaturationLightnessToPixels(data, effect) {
  const hueOffset = (effect.hueLevel ?? 0) / 360
  const saturationOffset = (effect.saturationLevel ?? 0) / 100
  const lightnessOffset = (effect.lightnessLevel ?? 0) / 100

  forEachPixel(data, (pixel) => {
    const hsl = rgbToHsl(pixel.red, pixel.green, pixel.blue)
    const rgb = hslToRgb(hsl.hue + hueOffset, hsl.saturation + saturationOffset, hsl.lightness + lightnessOffset)

    return {
      ...rgb,
      alpha: pixel.alpha
    }
  })
}

function applyLevelsToPixels(data, effect) {
  const shadow = clampUnit((effect.shadow ?? 0) / 100)
  const highlight = Math.max(shadow + 0.001, clampUnit((effect.highlight ?? 100) / 100))
  const gamma = Math.exp(-(effect.midtone ?? 0) / 100)

  forEachPixel(data, (pixel) => {
    const channelValues = [pixel.red, pixel.green, pixel.blue].map((value) => {
      const normalized = clampUnit(value / 255)
      const ranged = clampUnit((normalized - shadow) / (highlight - shadow))
      return clampColorChannel(Math.pow(ranged, gamma) * 255)
    })

    return {
      red: channelValues[0],
      green: channelValues[1],
      blue: channelValues[2],
      alpha: pixel.alpha
    }
  })
}

function applyTintToPixels(data, effect) {
  const amount = clampUnit((effect.amount ?? 0) / 100)
  const tint = hslToRgb((effect.hue ?? 0) / 360, 1, 0.5)

  forEachPixel(data, (pixel) => ({
    red: pixel.red * (1 - amount) + tint.red * amount,
    green: pixel.green * (1 - amount) + tint.green * amount,
    blue: pixel.blue * (1 - amount) + tint.blue * amount,
    alpha: pixel.alpha
  }))
}

function applyLookupTableToPixels(data, effect) {
  const lutB = effect.lutB ?? []
  const lutG = effect.lutG ?? []
  const lutR = effect.lutR ?? []
  const lutA = effect.lutA ?? []

  forEachPixel(data, (pixel) => ({
    red: lutR[pixel.red] ?? pixel.red,
    green: lutG[pixel.green] ?? pixel.green,
    blue: lutB[pixel.blue] ?? pixel.blue,
    alpha: lutA[pixel.alpha] ?? pixel.alpha
  }))
}

function blurPixels(data, width, height, radius) {
  const effectiveRadius = Math.max(0, Math.round(radius))

  if (effectiveRadius === 0) {
    return data.slice()
  }

  const result = new Uint8ClampedArray(data.length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0]
      let count = 0

      for (let offsetY = -effectiveRadius; offsetY <= effectiveRadius; offsetY += 1) {
        for (let offsetX = -effectiveRadius; offsetX <= effectiveRadius; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX))
          const sampleY = Math.max(0, Math.min(height - 1, y + offsetY))
          const sampleIndex = (sampleY * width + sampleX) * 4

          totals[0] += data[sampleIndex]
          totals[1] += data[sampleIndex + 1]
          totals[2] += data[sampleIndex + 2]
          totals[3] += data[sampleIndex + 3]
          count += 1
        }
      }

      const index = (y * width + x) * 4

      result[index] = clampColorChannel(totals[0] / count)
      result[index + 1] = clampColorChannel(totals[1] / count)
      result[index + 2] = clampColorChannel(totals[2] / count)
      result[index + 3] = clampColorChannel(totals[3] / count)
    }
  }

  return result
}

function applyBlurToPixels(data, width, height, effect) {
  data.set(blurPixels(data, width, height, effect.radius ?? 0))
}

function applySharpenToPixels(data, width, height, effect) {
  const blurred = blurPixels(data, width, height, effect.radius ?? 0)
  const amount = Math.max(0, effect.amount ?? 0) / 100

  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampColorChannel(data[index] + (data[index] - blurred[index]) * amount)
    data[index + 1] = clampColorChannel(data[index + 1] + (data[index + 1] - blurred[index + 1]) * amount)
    data[index + 2] = clampColorChannel(data[index + 2] + (data[index + 2] - blurred[index + 2]) * amount)
  }
}

function applyCurveValue(value, adjustment, adjustValue) {
  const normalizedValue = value / 255

  if (adjustment === 0) {
    return clampColorChannel((normalizedValue + adjustValue / 100) * 255)
  }

  if (adjustment === 1) {
    return clampColorChannel(normalizedValue * (1 + adjustValue / 100) * 255)
  }

  if (adjustment === 2) {
    const contrast = Math.max(-100, Math.min(100, adjustValue)) * 2.55
    const factor = contrast === 255 ? 255 : (259 * (contrast + 255)) / (255 * (259 - contrast))
    return clampColorChannel(factor * (value - 128) + 128)
  }

  if (adjustment === 3) {
    return clampColorChannel(value + Math.max(0, value - 160) * (adjustValue / 100))
  }

  if (adjustment === 4) {
    return clampColorChannel(value - Math.max(0, 96 - value) * (adjustValue / 100))
  }

  if (adjustment === 5) {
    return clampColorChannel(Math.pow(normalizedValue, Math.exp(-adjustValue / 100)) * 255)
  }

  if (adjustment === 6) {
    return clampColorChannel(value + (255 - value) * (adjustValue / 100))
  }

  if (adjustment === 7) {
    return clampColorChannel(value * (1 - adjustValue / 100))
  }

  return value
}

function applyColorCurveToPixels(data, effect) {
  const channels =
    {
      1: ['red'],
      2: ['green'],
      3: ['blue'],
      4: ['red', 'green', 'blue'],
      5: ['alpha']
    }[effect.channel] ?? ['red', 'green', 'blue']

  forEachPixel(data, (pixel) => {
    const next = { ...pixel }

    for (const channel of channels) {
      next[channel] = applyCurveValue(pixel[channel], effect.adjustment, effect.adjustValue ?? 0)
    }

    return next
  })
}

function applyRedEyeCorrectionToPixels(data, width, height, effect, originX = 0, originY = 0) {
  const areas = effect.areas ?? []

  if (areas.length === 0) {
    return
  }

  for (const area of areas) {
    const left = Math.max(0, Math.min(width, Math.floor(area.left - originX)))
    const top = Math.max(0, Math.min(height, Math.floor(area.top - originY)))
    const right = Math.max(left, Math.min(width, Math.ceil(area.right - originX)))
    const bottom = Math.max(top, Math.min(height, Math.ceil(area.bottom - originY)))

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = (y * width + x) * 4
        const red = data[index]
        const green = data[index + 1]
        const blue = data[index + 2]

        if (red > green * 1.4 && red > blue * 1.4) {
          data[index] = clampColorChannel(Math.max(green, blue))
        }
      }
    }
  }
}

function applyImageEffectToPixels(data, width, height, effect, options = {}) {
  if (!effect || effect.kind !== 'effect') {
    return
  }

  if (effect.type === 'colorMatrix') {
    applyColorMatrixToPixels(data, effect.matrix)
    return
  }

  if (effect.type === 'brightnessContrast') {
    applyBrightnessContrastToPixels(data, effect)
    return
  }

  if (effect.type === 'colorBalance') {
    applyColorBalanceToPixels(data, effect)
    return
  }

  if (effect.type === 'hueSaturationLightness') {
    applyHueSaturationLightnessToPixels(data, effect)
    return
  }

  if (effect.type === 'levels') {
    applyLevelsToPixels(data, effect)
    return
  }

  if (effect.type === 'tint') {
    applyTintToPixels(data, effect)
    return
  }

  if (effect.type === 'colorLookupTable') {
    applyLookupTableToPixels(data, effect)
    return
  }

  if (effect.type === 'blur') {
    applyBlurToPixels(data, width, height, effect)
    return
  }

  if (effect.type === 'sharpen') {
    applySharpenToPixels(data, width, height, effect)
    return
  }

  if (effect.type === 'colorCurve') {
    applyColorCurveToPixels(data, effect)
    return
  }

  if (effect.type === 'redEyeCorrection') {
    applyRedEyeCorrectionToPixels(
      data,
      width,
      height,
      effect,
      options.originX ?? 0,
      options.originY ?? 0
    )
  }
}

export class CanvasBackend {
  constructor(target) {
    this.canvas = target
    this.ctx = target.getContext('2d')
    this.currentTransform = [...IDENTITY_MATRIX]
    this.clipFrames = [{ explicit: false, hasSnapshot: false }]
    this.pixelOffset = { x: 0, y: 0 }
    this.graphicsStateWarnings = new Set()

    if (!this.ctx) {
      throw new Error('CanvasBackend requires a 2d context')
    }
  }

  resize(width, height) {
    this.canvas.width = width
    this.canvas.height = height
    this.clipFrames = [{ explicit: false, hasSnapshot: false }]
  }

  clear(fill = null) {
    if (!fill?.color) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      return
    }

    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.fillStyle = fill.color
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  createSurface(width = 1, height = 1) {
    if (typeof OffscreenCanvas !== 'undefined') {
      return markSurface(new OffscreenCanvas(width, height), true)
    }

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return markSurface(canvas, true)
    }

    return createFallbackSurface(width, height)
  }

  resolveImageSource(image) {
    return resolveImageSource(image)
  }

  save() {
    this.ctx.save()
    this.clipFrames.push({ explicit: true, hasSnapshot: false })
  }

  restore() {
    const frame = this.clipFrames.pop() ?? { explicit: true, hasSnapshot: false }

    if (frame.hasSnapshot) {
      this.ctx.restore()
    }

    this.ctx.restore()
  }

  setTransform(matrix) {
    this.currentTransform = [...matrix]
    this.ctx.setTransform(...matrix)
  }

  addGraphicsStateWarning(code, message, options = {}) {
    if (this.graphicsStateWarnings.has(code)) {
      return
    }

    this.graphicsStateWarnings.add(code)
    options.addWarning?.(message, { code })
  }

  applyGraphicsState(state = {}, options = {}) {
    this.ctx.globalCompositeOperation = resolveCanvasCompositeOperation(state.compositingMode)

    const smoothing = resolveImageSmoothing(state.interpolationMode)
    this.ctx.imageSmoothingEnabled = smoothing.enabled
    this.ctx.imageSmoothingQuality = smoothing.quality
    this.pixelOffset = resolvePixelOffset(state.pixelOffsetMode)

    if (state.smoothingMode === 3) {
      this.addGraphicsStateWarning(
        'emfplus-smoothing-none-approximation',
        'Canvas backend approximates EMF+ SmoothingMode.None because Canvas 2D cannot fully disable geometry antialiasing',
        options
      )
    }

    if (state.textRenderingHint !== undefined && !['system', 'default', 0].includes(state.textRenderingHint)) {
      this.addGraphicsStateWarning(
        `emfplus-text-rendering-${state.textRenderingHint}`,
        `Canvas backend approximates EMF+ text rendering hint ${state.textRenderingHint}`,
        options
      )
    }

    if (Number.isFinite(options.classicRop2) && !isSupportedRop2(options.classicRop2)) {
      this.addGraphicsStateWarning(
        `classic-rop2-unsupported-${options.classicRop2}`,
        `Canvas backend does not support classic ROP2 mode ${options.classicRop2}; drawing with source-over semantics`,
        options
      )
    }
  }

  createMirroredTextureSurface(source, wrapMode) {
    if (!source?.width || !source?.height || !['tileFlipX', 'tileFlipY', 'tileFlipXY'].includes(wrapMode)) {
      return source
    }

    const width = wrapMode === 'tileFlipY' ? source.width : source.width * 2
    const height = wrapMode === 'tileFlipX' ? source.height : source.height * 2
    const surface = this.createSurface(width, height)
    const context = surface?.getContext?.('2d')

    if (!surface || !context || typeof context.drawImage !== 'function') {
      return source
    }

    context.clearRect?.(0, 0, width, height)
    context.drawImage(source, 0, 0)

    if (wrapMode === 'tileFlipX' || wrapMode === 'tileFlipXY') {
      context.save?.()
      context.setTransform?.(-1, 0, 0, 1, width, 0)
      context.drawImage(source, 0, 0)
      context.restore?.()
    }

    if (wrapMode === 'tileFlipY' || wrapMode === 'tileFlipXY') {
      context.save?.()
      context.setTransform?.(1, 0, 0, -1, 0, height)
      context.drawImage(source, 0, 0)
      context.restore?.()
    }

    if (wrapMode === 'tileFlipXY') {
      context.save?.()
      context.setTransform?.(-1, 0, 0, -1, width, height)
      context.drawImage(source, 0, 0)
      context.restore?.()
    }

    return surface
  }

  resolvePaintStyle(paint, bounds = null) {
    const brush = paint?.kind === 'brush' ? paint : paint?.brush ?? paint

    if (brush?.type === 'linearGradient' && typeof this.ctx.createLinearGradient === 'function') {
      const gradientBounds = normalizeBounds(brush.rect ?? bounds)

      if (gradientBounds && (gradientBounds.width !== 0 || gradientBounds.height !== 0)) {
        // EMF+ linear gradients start along the horizontal axis of RectF; the
        // optional brush transform rotates/scales that axis. Classic
        // GRADIENTFILL pins its own explicit horizontal/vertical endpoints.
        const baseStartPoint = transformPoint(
          brush.transform,
          brush.startPoint ?? { x: gradientBounds.x, y: gradientBounds.y }
        )
        const baseEndPoint = transformPoint(
          brush.transform,
          brush.endPoint ?? {
            x: gradientBounds.x + gradientBounds.width,
            y: gradientBounds.y
          }
        )
        const resolved = expandWrappedGradient(
          baseStartPoint,
          baseEndPoint,
          resolveGradientStops(brush, brush.startColor, brush.endColor),
          bounds,
          brush.wrapMode
        )
        const gradient = this.ctx.createLinearGradient(
          resolved.startPoint.x,
          resolved.startPoint.y,
          resolved.endPoint.x,
          resolved.endPoint.y
        )

        for (const [offset, color] of resolved.stops) {
          gradient.addColorStop(offset, color)
        }

        return gradient
      }
    }

    if (brush?.type === 'pathGradient' && typeof this.ctx.createRadialGradient === 'function') {
      const gradientBounds = normalizeBounds(pathToBounds(brush.boundaryPath) ?? bounds)

      if (gradientBounds && (gradientBounds.width !== 0 || gradientBounds.height !== 0)) {
        const localCenter = brush.centerPoint ?? {
          x: gradientBounds.x + gradientBounds.width / 2,
          y: gradientBounds.y + gradientBounds.height / 2
        }
        const center = transformPoint(brush.transform, localCenter)
        const corners = [
          { x: gradientBounds.x, y: gradientBounds.y },
          { x: gradientBounds.x + gradientBounds.width, y: gradientBounds.y },
          { x: gradientBounds.x, y: gradientBounds.y + gradientBounds.height },
          { x: gradientBounds.x + gradientBounds.width, y: gradientBounds.y + gradientBounds.height }
        ].map((point) => transformPoint(brush.transform, point))
        const radius = Math.max(
          ...corners.map((corner) => Math.hypot(center.x - corner.x, center.y - corner.y))
        )

        if (radius > 0) {
          const focusScaleX = Number.isFinite(brush.focusScale?.x) ? clampUnit(brush.focusScale.x) : 0
          const focusScaleY = Number.isFinite(brush.focusScale?.y) ? clampUnit(brush.focusScale.y) : 0
          const focusRadius = radius * Math.min(focusScaleX, focusScaleY)
          const gradient = this.ctx.createRadialGradient(center.x, center.y, focusRadius, center.x, center.y, radius)
          const boundaryColor =
            Array.isArray(brush.surroundingColors) && brush.surroundingColors.length > 0
              ? averageCssColors(brush.surroundingColors) ?? brush.surroundingColors[0]
              : brush.centerColor
          const centerColor = brush.centerColor ?? boundaryColor ?? 'rgba(0, 0, 0, 1)'
          const resolvedBoundaryColor = boundaryColor ?? brush.centerColor ?? 'rgba(0, 0, 0, 1)'
          const stops = resolveGradientStops(brush, centerColor, resolvedBoundaryColor)

          for (const [offset, color] of stops) {
            gradient.addColorStop(offset, color)
          }

          return gradient
        }
      }
    }

    if (brush?.type === 'texture' && typeof this.ctx.createPattern === 'function') {
      const source = resolveImageSource(brush.image)

      if (source) {
        const tiledSource = this.createMirroredTextureSurface(source, brush.wrapMode)
        const pattern = this.ctx.createPattern(tiledSource, toPatternRepetition(brush.wrapMode))

        if (pattern && typeof pattern.setTransform === 'function' && Array.isArray(brush.transform)) {
          pattern.setTransform({
            a: brush.transform[0] ?? 1,
            b: brush.transform[1] ?? 0,
            c: brush.transform[2] ?? 0,
            d: brush.transform[3] ?? 1,
            e: brush.transform[4] ?? 0,
            f: brush.transform[5] ?? 0
          })
        }

        if (pattern) {
          return pattern
        }
      }
    }

    if (brush?.type === 'hatch') {
      return brush.foreColor ?? brush.color ?? 'rgba(0, 0, 0, 1)'
    }

    return brush?.color ?? paint?.color ?? 'rgba(0, 0, 0, 1)'
  }

  fillRect(rect, fill) {
    this.ctx.fillStyle = this.resolvePaintStyle(fill, rectToBounds(rect))
    this.ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
  }

  resolveStrokeForRop2(stroke) {
    if (stroke?.rop2 !== ROP2_NOTCOPYPEN) {
      return stroke
    }

    const invertedColor = invertCssColor(stroke.color)

    if (!invertedColor) {
      this.addGraphicsStateWarning(
        'classic-rop2-notcopypen-unsupported-paint',
        'Canvas backend can only apply R2_NOTCOPYPEN to solid CSS color pens'
      )
      return stroke
    }

    return {
      ...stroke,
      color: invertedColor
    }
  }

  withStrokeComposite(stroke, draw) {
    const compositeOperation = resolveRop2CompositeOperation(stroke?.rop2)

    if (!compositeOperation) {
      draw(this.resolveStrokeForRop2(stroke))
      return
    }

    this.ctx.save()
    this.ctx.globalCompositeOperation = compositeOperation

    try {
      draw(stroke)
    } finally {
      this.ctx.restore()
    }
  }

  applyStrokeStyle(stroke, bounds = null) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}
    this.warnUnsupportedPenTransform(stroke)
    this.warnUnsupportedDashCap(resolvedStroke)

    this.ctx.strokeStyle = this.resolvePaintStyle(resolvedStroke, bounds)
    this.ctx.lineWidth = resolvedStroke.width || 1
    this.ctx.miterLimit = resolvedStroke.miterLimit || 10

    if (
      'lineCap' in this.ctx ||
      resolvedStroke.lineCap ||
      resolvedStroke.startCap ||
      resolvedStroke.endCap ||
      resolvedStroke.customStartCap ||
      resolvedStroke.customEndCap ||
      resolvedStroke.dashCap
    ) {
      this.ctx.lineCap = resolveStrokeLineCap(resolvedStroke)
    }

    if ('lineJoin' in this.ctx || resolvedStroke.lineJoin) {
      this.ctx.lineJoin = resolveCanvasLineJoin(resolvedStroke.lineJoin)
    }

    if ('lineDashOffset' in this.ctx || Number.isFinite(resolvedStroke.dashOffset)) {
      this.ctx.lineDashOffset = Number.isFinite(resolvedStroke.dashOffset) ? resolvedStroke.dashOffset : 0
    }

    if (typeof this.ctx.setLineDash === 'function') {
      this.ctx.setLineDash(resolveDashPattern(resolvedStroke))
    }
  }

  warnUnsupportedDashCap(stroke) {
    if (isTriangleDashStroke(stroke)) {
      this.addGraphicsStateWarning(
        'emfplus-dash-cap-triangle-unsupported',
        'Canvas backend cannot render EMF+ DashCapTriangle; drawing dashed stroke with butt dash caps',
        stroke
      )
    }
  }

  warnUnsupportedPenTransform(stroke) {
    const transform = classifyPenTransform(stroke?.transform)

    if (transform.kind === 'nonUniform') {
      this.addGraphicsStateWarning(
        'emfplus-pen-transform-non-uniform',
        'Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics',
        stroke
      )
    } else if (transform.kind === 'rotatedOrSheared') {
      this.addGraphicsStateWarning(
        'emfplus-pen-transform-rotated-or-sheared',
        'Canvas backend ignores rotated or sheared EMF+ pen transforms for stroke width and dash metrics',
        stroke
      )
    } else if (transform.kind === 'unsupported') {
      this.addGraphicsStateWarning(
        'emfplus-pen-transform-invalid',
        'Canvas backend ignores invalid EMF+ pen transforms for stroke width and dash metrics',
        stroke
      )
    }
  }

  warnUnsupportedCompoundStroke(stroke, code, message) {
    this.addGraphicsStateWarning(code, message, stroke)
  }

  warnUnsupportedPenAlignment(stroke, message = `Canvas backend does not support EMF+ pen alignment ${stroke?.alignment}; drawing centered stroke`) {
    this.addGraphicsStateWarning(`emfplus-pen-alignment-${stroke?.alignment}-unsupported`, message, stroke)
  }

  warnCompoundInsetAlignment(stroke) {
    this.addGraphicsStateWarning(
      'emfplus-pen-alignment-inset-compound-unsupported',
      'Canvas backend cannot combine EMF+ inset pen alignment with compound lines; drawing centered stroke',
      stroke
    )
  }

  drawCompoundLineStroke(stroke, from, to, bounds) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}
    const result = resolveCompoundStrokeSegments(resolvedStroke)

    if (result.kind !== 'valid') {
      if (hasCompoundStroke(resolvedStroke)) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-invalid',
          'Canvas backend ignores invalid EMF+ compound line data'
        )
      }

      return false
    }

    if (hasCustomLineCaps(resolvedStroke)) {
      this.warnUnsupportedCompoundStroke(
        stroke,
        'emfplus-compound-line-custom-cap-unsupported',
        'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
      )
      return false
    }

    const tangent = vectorBetween(from, to)

    if (!tangent) {
      return false
    }

    const normal = {
      x: -tangent.y,
      y: tangent.x
    }
    const baseStroke = withoutCompoundStrokeTransform(resolvedStroke)
    this.warnUnsupportedPenTransform(stroke)

    for (const segment of result.segments) {
      const segmentFrom = offsetPointByNormal(from, normal, segment.offset)
      const segmentTo = offsetPointByNormal(to, normal, segment.offset)

      this.ctx.save()
      this.applyStrokeStyle({ ...baseStroke, width: segment.width }, bounds)
      this.ctx.beginPath()
      this.ctx.moveTo(segmentFrom.x, segmentFrom.y)
      this.ctx.lineTo(segmentTo.x, segmentTo.y)
      this.ctx.stroke()
      this.ctx.restore()
    }

    return true
  }

  drawCompoundPolylineStroke(stroke, points, bounds) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}
    const result = resolveCompoundStrokeSegments(resolvedStroke)

    if (result.kind !== 'valid') {
      if (hasCompoundStroke(resolvedStroke)) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-invalid',
          'Canvas backend ignores invalid EMF+ compound line data'
        )
      }

      return false
    }

    if (hasCustomLineCaps(resolvedStroke)) {
      this.warnUnsupportedCompoundStroke(
        stroke,
        'emfplus-compound-line-custom-cap-unsupported',
        'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
      )
      return false
    }

    const baseStroke = withoutCompoundStrokeTransform(resolvedStroke)
    this.warnUnsupportedPenTransform(stroke)

    for (const segment of result.segments) {
      const offsetPoints = offsetPolylinePoints(points, segment.offset)

      if (!offsetPoints) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-complex-path-unsupported',
          'Canvas backend cannot offset complex EMF+ compound paths; drawing a single stroke'
        )
        return false
      }

      this.ctx.save()
      this.applyStrokeStyle({ ...baseStroke, width: segment.width }, bounds)
      this.ctx.beginPath()
      this.ctx.moveTo(offsetPoints[0].x, offsetPoints[0].y)

      for (const point of offsetPoints.slice(1)) {
        this.ctx.lineTo(point.x, point.y)
      }

      this.ctx.stroke()
      this.ctx.restore()
    }

    return true
  }

  drawCompoundClosedPolygonStroke(stroke, points, bounds) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}
    const result = resolveCompoundStrokeSegments(resolvedStroke)

    if (result.kind !== 'valid') {
      if (hasCompoundStroke(resolvedStroke)) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-invalid',
          'Canvas backend ignores invalid EMF+ compound line data'
        )
      }

      return false
    }

    if (hasCustomLineCaps(resolvedStroke)) {
      this.warnUnsupportedCompoundStroke(
        stroke,
        'emfplus-compound-line-custom-cap-unsupported',
        'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
      )
      return false
    }

    const baseStroke = withoutCompoundStrokeTransform(resolvedStroke)
    this.warnUnsupportedPenTransform(stroke)
    const insetPaths = []

    for (const segment of result.segments) {
      const insetPoints = insetClosedPolygon(points, segment.offset)

      if (!insetPoints) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-complex-path-unsupported',
          'Canvas backend cannot offset complex EMF+ compound paths; drawing a single stroke'
        )
        return false
      }

      insetPaths.push({
        path: pathFromClosedPoints(insetPoints),
        width: segment.width
      })
    }

    for (const { path: insetPath, width } of insetPaths) {
      this.ctx.save()

      if (this.drawSharedPath(insetPath)) {
        this.applyStrokeStyle({ ...baseStroke, width }, bounds)
        this.ctx.stroke()
      }

      this.ctx.restore()
    }

    return true
  }

  drawCompoundRectStroke(stroke, rect) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}
    const result = resolveCompoundStrokeSegments(resolvedStroke)

    if (result.kind !== 'valid') {
      if (hasCompoundStroke(resolvedStroke)) {
        this.warnUnsupportedCompoundStroke(
          stroke,
          'emfplus-compound-line-invalid',
          'Canvas backend ignores invalid EMF+ compound line data'
        )
      }

      return false
    }

    if (hasCustomLineCaps(resolvedStroke)) {
      this.warnUnsupportedCompoundStroke(
        stroke,
        'emfplus-compound-line-custom-cap-unsupported',
        'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
      )
      return false
    }

    const bounds = rectToBounds(rect)
    const baseStroke = withoutCompoundStrokeTransform(resolvedStroke)
    this.warnUnsupportedPenTransform(stroke)

    for (const segment of result.segments) {
      const left = bounds.x + segment.offset
      const top = bounds.y + segment.offset
      const width = bounds.width - segment.offset * 2
      const height = bounds.height - segment.offset * 2

      if (width <= VECTOR_EPSILON || height <= VECTOR_EPSILON) {
        continue
      }

      this.ctx.save()
      this.applyStrokeStyle({ ...baseStroke, width: segment.width }, bounds)
      this.ctx.strokeRect(left, top, width, height)
      this.ctx.restore()
    }

    return true
  }

  strokeRect(rect, stroke) {
    this.withStrokeComposite(stroke, (resolvedStroke) => {
      if (isInsetPenAlignment(resolvedStroke)) {
        if (hasCompoundStroke(resolvedStroke)) {
          this.warnCompoundInsetAlignment(resolvedStroke)
        } else {
          const { stroke: insetStroke, inset } = createInsetStroke(resolvedStroke)
          const bounds = insetRectBounds(rectToBounds(rect), inset)

          if (bounds.width > VECTOR_EPSILON && bounds.height > VECTOR_EPSILON) {
            this.applyStrokeStyle(insetStroke, bounds)
            this.ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
            return
          }
        }
      } else if (isUnsupportedPenAlignment(resolvedStroke)) {
        this.warnUnsupportedPenAlignment(resolvedStroke)
      }

      if (this.drawCompoundRectStroke(resolvedStroke, rect)) {
        return
      }

      this.applyStrokeStyle(resolvedStroke, rectToBounds(rect))
      this.ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
    })
  }

  fillEllipse(rect, fill) {
    const width = rect.right - rect.left
    const height = rect.bottom - rect.top

    this.ctx.beginPath()
    this.ctx.ellipse(rect.left + width / 2, rect.top + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2)
    this.ctx.fillStyle = this.resolvePaintStyle(fill, ellipseToBounds(rect))
    this.ctx.fill()
  }

  strokeEllipse(rect, stroke) {
    const width = rect.right - rect.left
    const height = rect.bottom - rect.top

    this.withStrokeComposite(stroke, (resolvedStroke) => {
      if (isUnsupportedPenAlignment(resolvedStroke)) {
        this.warnUnsupportedPenAlignment(resolvedStroke)
      }

      if (isInsetPenAlignment(resolvedStroke)) {
        if (hasCompoundStroke(resolvedStroke)) {
          this.warnCompoundInsetAlignment(resolvedStroke)
        } else {
          const { stroke: insetStroke, inset } = createInsetStroke(resolvedStroke)
          const bounds = insetRectBounds(ellipseToBounds(rect), inset)

          if (bounds.width > VECTOR_EPSILON && bounds.height > VECTOR_EPSILON) {
            this.ctx.beginPath()
            this.ctx.ellipse(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
              Math.abs(bounds.width / 2),
              Math.abs(bounds.height / 2),
              0,
              0,
              Math.PI * 2
            )
            this.applyStrokeStyle(insetStroke, bounds)
            this.ctx.stroke()
            return
          }
        }
      }

      this.ctx.beginPath()
      this.ctx.ellipse(rect.left + width / 2, rect.top + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2)
      this.applyStrokeStyle(resolvedStroke, ellipseToBounds(rect))
      this.ctx.stroke()
    })
  }

  clipRect(rect, mode) {
    this.ctx.beginPath()
    this.ctx.rect(rect.x, rect.y, rect.width, rect.height)
    this.ctx.clip()
    this.ctx.__clipMode = mode
  }

  ensureClipSnapshot() {
    const frame = this.clipFrames[this.clipFrames.length - 1]

    if (!frame?.hasSnapshot) {
      this.ctx.save()
      if (frame) {
        frame.hasSnapshot = true
      }
    }
  }

  resetClipToFrameBaseline() {
    this.ensureClipSnapshot()
    this.ctx.restore()
    this.ctx.save()
    this.ctx.setTransform(...this.currentTransform)
  }

  traceGeometry(geometry) {
    this.ctx.beginPath()

    if (!Array.isArray(geometry) || geometry.length === 0) {
      this.ctx.rect(0, 0, 0, 0)
      return
    }

    for (const polygon of geometry) {
      for (const ring of polygon) {
        const firstPoint = ring[0]

        if (!Array.isArray(ring) || ring.length === 0 || !firstPoint) {
          continue
        }

        this.ctx.moveTo(firstPoint[0], firstPoint[1])

        const points =
          ring.length > 1 &&
          ring[ring.length - 1][0] === firstPoint[0] &&
          ring[ring.length - 1][1] === firstPoint[1]
            ? ring.slice(1, -1)
            : ring.slice(1)

        for (const point of points) {
          this.ctx.lineTo(point[0], point[1])
        }

        this.ctx.closePath()
      }
    }
  }

  setClip(clip) {
    this.resetClipToFrameBaseline()

    if (!clip?.geometry) {
      return
    }

    this.traceGeometry(clip.geometry)
    this.ctx.clip('evenodd')
  }

  drawSharedPath(path) {
    const figures = path?.figures ?? []
    let hasGeometry = false

    this.ctx.beginPath()

    for (const figure of figures) {
      const firstPoint = figure.points[0]

      if (!firstPoint) {
        continue
      }

      hasGeometry = true
      this.ctx.moveTo(firstPoint.x, firstPoint.y)

      if (Array.isArray(figure.segments) && figure.segments.length > 0) {
        for (const segment of figure.segments) {
          if (segment.type === 'arc') {
            if (typeof this.ctx.ellipse === 'function') {
              this.ctx.ellipse(
                segment.center.x,
                segment.center.y,
                segment.radiusX,
                segment.radiusY,
                segment.rotation ?? 0,
                segment.startAngle,
                segment.endAngle,
                segment.counterclockwise ?? false
              )
            } else {
              this.ctx.lineTo(segment.point.x, segment.point.y)
            }
            continue
          }

          if (segment.type === 'bezier') {
            if (typeof this.ctx.bezierCurveTo === 'function') {
              this.ctx.bezierCurveTo(
                segment.control1.x,
                segment.control1.y,
                segment.control2.x,
                segment.control2.y,
                segment.point.x,
                segment.point.y
              )
            } else {
              this.ctx.lineTo(segment.point.x, segment.point.y)
            }
            continue
          }

          this.ctx.lineTo(segment.point.x, segment.point.y)
        }
      } else {
        for (const point of figure.points.slice(1)) {
          this.ctx.lineTo(point.x, point.y)
        }
      }

      if (figure.closed) {
        this.ctx.closePath()
      }
    }

    return hasGeometry
  }

  fillPath(path, brush, options = {}) {
    if (!this.drawSharedPath(path)) {
      return
    }

    this.ctx.fillStyle = this.resolvePaintStyle(brush, pathToBounds(path))
    this.ctx.fill(options.fillMode === 'alternate' ? 'evenodd' : 'nonzero')
  }

  fillGeometry(geometry, brush, options = {}) {
    this.traceGeometry(geometry)
    this.ctx.fillStyle = this.resolvePaintStyle(brush)
    this.ctx.fill(options.fillMode === 'alternate' ? 'evenodd' : 'nonzero')
  }

  drawAdjustableArrowLineCap(point, direction, cap, stroke, bounds) {
    const points = createAdjustableArrowPoints(point, direction, cap, stroke)

    if (!points) {
      return
    }

    const paintStyle = this.resolvePaintStyle(stroke, bounds)

    this.ctx.save()
    this.ctx.fillStyle = paintStyle
    this.ctx.strokeStyle = paintStyle
    this.ctx.lineWidth = stroke?.width || 1
    this.ctx.miterLimit = cap.lineMiterLimit || stroke?.miterLimit || 10
    this.ctx.lineJoin = resolveCanvasLineJoin(cap.lineJoin, resolveCanvasLineJoin(stroke?.lineJoin))

    if (typeof this.ctx.setLineDash === 'function') {
      this.ctx.setLineDash([])
    }

    this.ctx.beginPath()
    this.ctx.moveTo(points[0].x, points[0].y)

    for (const nextPoint of points.slice(1)) {
      this.ctx.lineTo(nextPoint.x, nextPoint.y)
    }

    this.ctx.closePath()

    if (cap.fillState) {
      this.ctx.fill()
    } else {
      this.ctx.stroke()
    }

    this.ctx.restore()
  }

  drawDefaultCustomLineCap(point, direction, cap, stroke, bounds) {
    const baseMatrix = createDefaultCustomLineCapMatrix(point, direction, cap, stroke)

    if (!baseMatrix) {
      return
    }

    const paintStyle = this.resolvePaintStyle(stroke, bounds)

    this.ctx.save()

    if (cap.fillPath) {
      const matrix = createDefaultCustomLineCapMatrix(point, direction, cap, stroke, cap.fillHotSpot)
      const fillPath = transformPathGeometry(cap.fillPath, matrix)

      if (this.drawSharedPath(fillPath)) {
        this.ctx.fillStyle = paintStyle
        this.ctx.fill('nonzero')
      }
    }

    if (cap.linePath) {
      const matrix = createDefaultCustomLineCapMatrix(point, direction, cap, stroke, cap.lineHotSpot)
      const linePath = transformPathGeometry(cap.linePath, matrix)

      if (this.drawSharedPath(linePath)) {
        this.ctx.strokeStyle = paintStyle
        this.ctx.lineWidth = stroke?.width || 1
        this.ctx.lineCap = resolveCanvasLineCap(cap.strokeEndCap, resolveStrokeLineCap(stroke))
        this.ctx.lineJoin = resolveCanvasLineJoin(cap.strokeJoin, resolveCanvasLineJoin(stroke?.lineJoin))
        this.ctx.miterLimit = Number.isFinite(cap.strokeMiterLimit) ? cap.strokeMiterLimit : stroke?.miterLimit || 10

        if (typeof this.ctx.setLineDash === 'function') {
          this.ctx.setLineDash([])
        }

        this.ctx.stroke()
      }
    }

    this.ctx.restore()
  }

  drawTriangleDashCap(point, direction, stroke, bounds) {
    const points = createTriangleDashCapPoints(point, direction, stroke)

    if (!points) {
      return
    }

    const paintStyle = this.resolvePaintStyle(stroke, bounds)

    this.ctx.save()
    this.ctx.fillStyle = paintStyle
    this.ctx.strokeStyle = paintStyle

    if (typeof this.ctx.setLineDash === 'function') {
      this.ctx.setLineDash([])
    }

    this.ctx.beginPath()
    this.ctx.moveTo(points[0].x, points[0].y)
    this.ctx.lineTo(points[1].x, points[1].y)
    this.ctx.lineTo(points[2].x, points[2].y)
    this.ctx.closePath()
    this.ctx.fill()
    this.ctx.restore()
  }

  drawTriangleDashLine(from, to, stroke, bounds) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke) ?? {}

    if (!isTriangleDashStroke(resolvedStroke)) {
      return false
    }

    const segments = resolveDashLineSegments(from, to, resolvedStroke)

    if (!segments) {
      return false
    }

    const baseStroke = {
      ...resolvedStroke,
      dashCap: 'butt',
      dashPattern: [],
      dashStyle: 'solid',
      dashOffset: 0,
      transform: null
    }

    this.warnUnsupportedPenTransform(stroke)

    for (const segment of segments) {
      this.ctx.save()
      this.applyStrokeStyle(baseStroke, bounds)
      this.ctx.beginPath()
      this.ctx.moveTo(segment.from.x, segment.from.y)
      this.ctx.lineTo(segment.to.x, segment.to.y)
      this.ctx.stroke()
      this.ctx.restore()
      this.drawTriangleDashCap(segment.from, { x: -segment.direction.x, y: -segment.direction.y }, resolvedStroke, bounds)
      this.drawTriangleDashCap(segment.to, segment.direction, resolvedStroke, bounds)
    }

    return true
  }

  drawCustomLineCaps(path, stroke) {
    const resolvedStroke = resolveStrokeForPenTransform(stroke)
    const hasCustomCaps =
      isDrawableCustomLineCap(resolvedStroke?.customStartCap) || isDrawableCustomLineCap(resolvedStroke?.customEndCap)

    if (!hasCustomCaps) {
      return
    }

    const bounds = pathToBounds(path)

    for (const figure of path?.figures ?? []) {
      if (figure.closed) {
        continue
      }

      const startPoint = figure.points?.[0]
      const endPoint = figure.points?.at(-1)
      const startTangent = isDrawableCustomLineCap(resolvedStroke.customStartCap)
        ? resolveFigureStartTangent(figure)
        : null
      const endTangent = isDrawableCustomLineCap(resolvedStroke.customEndCap) ? resolveFigureEndTangent(figure) : null

      if (startPoint && startTangent) {
        const direction = { x: -startTangent.x, y: -startTangent.y }

        if (resolvedStroke.customStartCap.type === 'adjustableArrow') {
          this.drawAdjustableArrowLineCap(startPoint, direction, resolvedStroke.customStartCap, resolvedStroke, bounds)
        } else {
          this.drawDefaultCustomLineCap(startPoint, direction, resolvedStroke.customStartCap, resolvedStroke, bounds)
        }
      }

      if (endPoint && endTangent) {
        if (resolvedStroke.customEndCap.type === 'adjustableArrow') {
          this.drawAdjustableArrowLineCap(endPoint, endTangent, resolvedStroke.customEndCap, resolvedStroke, bounds)
        } else {
          this.drawDefaultCustomLineCap(endPoint, endTangent, resolvedStroke.customEndCap, resolvedStroke, bounds)
        }
      }
    }
  }

  strokePath(path, pen) {
    if (isInsetPenAlignment(pen)) {
      if (hasCompoundStroke(pen)) {
        this.warnCompoundInsetAlignment(pen)
      } else {
        const points = resolveSimpleClosedPolygon(path)

        if (points) {
          const { stroke: insetStroke, inset } = createInsetStroke(pen)
          const insetPoints = insetClosedPolygon(points, inset)

          if (insetPoints) {
            const insetPath = pathFromClosedPoints(insetPoints)

            if (this.drawSharedPath(insetPath)) {
              this.withStrokeComposite(insetStroke, (resolvedPen) => {
                this.applyStrokeStyle(resolvedPen, pathToBounds(insetPath))
                this.ctx.stroke()
              })
              return
            }
          }
        }

        this.warnUnsupportedPenAlignment(
          pen,
          'Canvas backend cannot inset complex EMF+ pen-aligned paths; drawing centered stroke'
        )
      }
    } else if (isUnsupportedPenAlignment(pen)) {
      this.warnUnsupportedPenAlignment(pen)
    }

    const compoundPolyline = !isInsetPenAlignment(pen) && hasCompoundStroke(pen) ? resolveSimpleOpenPolyline(path) : null
    const compoundPolygon =
      !compoundPolyline && !isInsetPenAlignment(pen) && hasCompoundStroke(pen) ? resolveSimpleClosedPolygon(path) : null

    if (compoundPolyline) {
      let drewCompoundLineStroke = false

      this.withStrokeComposite(pen, (resolvedPen) => {
        drewCompoundLineStroke =
          compoundPolyline.length === 2
            ? this.drawCompoundLineStroke(resolvedPen, compoundPolyline[0], compoundPolyline[1], pathToBounds(path))
            : this.drawCompoundPolylineStroke(resolvedPen, compoundPolyline, pathToBounds(path))
      })

      if (drewCompoundLineStroke) {
        return
      }
    } else if (compoundPolygon) {
      let drewCompoundPolygonStroke = false

      this.withStrokeComposite(pen, (resolvedPen) => {
        drewCompoundPolygonStroke = this.drawCompoundClosedPolygonStroke(resolvedPen, compoundPolygon, pathToBounds(path))
      })

      if (drewCompoundPolygonStroke) {
        return
      }
    } else if (hasCompoundStroke(pen)) {
      this.warnUnsupportedCompoundStroke(
        pen,
        'emfplus-compound-line-complex-path-unsupported',
        'Canvas backend cannot offset complex EMF+ compound paths; drawing a single stroke'
      )
    }

    const triangleDashLine =
      !hasCompoundStroke(pen) && !isInsetPenAlignment(pen) && hasDashStroke(pen) ? resolveSimpleOpenPolyline(path) : null

    if (triangleDashLine?.length === 2) {
      let drewTriangleDashLine = false

      this.withStrokeComposite(pen, (resolvedPen) => {
        drewTriangleDashLine = this.drawTriangleDashLine(
          triangleDashLine[0],
          triangleDashLine[1],
          resolvedPen,
          pathToBounds(path)
        )
      })

      if (drewTriangleDashLine) {
        return
      }
    }

    if (!this.drawSharedPath(path)) {
      return
    }

    this.withStrokeComposite(pen, (resolvedPen) => {
      this.applyStrokeStyle(resolvedPen, pathToBounds(path))
      this.ctx.stroke()
    })

    if (!hasCompoundStroke(pen) || hasCustomLineCaps(pen)) {
      this.drawCustomLineCaps(path, pen)
    }
  }

  drawLine(from, to, pen) {
    let canDrawCompoundLine = true

    if (isInsetPenAlignment(pen)) {
      if (hasCompoundStroke(pen)) {
        this.warnCompoundInsetAlignment(pen)
        canDrawCompoundLine = false
      } else {
        this.warnUnsupportedPenAlignment(
          pen,
          'Canvas backend cannot inset open EMF+ pen-aligned lines; drawing centered stroke'
        )
      }
    } else if (isUnsupportedPenAlignment(pen)) {
      this.warnUnsupportedPenAlignment(pen)
    }

    let drewCompoundLineStroke = false

    if (canDrawCompoundLine) {
      this.withStrokeComposite(pen, (resolvedPen) => {
        drewCompoundLineStroke = this.drawCompoundLineStroke(
          resolvedPen,
          from,
          to,
          {
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            width: Math.abs(to.x - from.x),
            height: Math.abs(to.y - from.y)
          }
        )
      })
    }

    if (!drewCompoundLineStroke) {
      let drewTriangleDashLine = false

      this.withStrokeComposite(pen, (resolvedPen) => {
        drewTriangleDashLine = this.drawTriangleDashLine(
          from,
          to,
          resolvedPen,
          {
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            width: Math.abs(to.x - from.x),
            height: Math.abs(to.y - from.y)
          }
        )
      })

      if (drewTriangleDashLine) {
        return
      }

      this.withStrokeComposite(pen, (resolvedPen) => {
        this.ctx.beginPath()
        this.ctx.moveTo(from.x, from.y)
        this.ctx.lineTo(to.x, to.y)
        this.applyStrokeStyle(resolvedPen, {
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          width: Math.abs(to.x - from.x),
          height: Math.abs(to.y - from.y)
        })
        this.ctx.stroke()
      })

      this.drawCustomLineCaps(
        {
          figures: [
            {
              closed: false,
              points: [from, to]
            }
          ]
        },
        pen
      )
    }
  }

  drawText(text, layoutRect, font, brush, format = {}) {
    const bounds = normalizeBounds(layoutRect)

    if (!bounds || typeof this.ctx.fillText !== 'function') {
      return
    }

    this.ctx.font = font?.cssFont ?? font?.css ?? '10px sans-serif'
    this.ctx.fillStyle = this.resolvePaintStyle(brush, bounds)
    this.ctx.textAlign = format.textAlign ?? 'left'
    this.ctx.textBaseline = format.textBaseline ?? 'top'
    const previousDirection = this.ctx.direction

    if (format.directionRightToLeft) {
      this.ctx.direction = 'rtl'
    }

    warnTextFormatApproximation(format)

    const fontSize = extractFontSize(font, this.ctx.font)
    const leadingInset = Number.isFinite(format.leadingMargin) ? format.leadingMargin * fontSize : 0
    const trailingInset = Number.isFinite(format.trailingMargin) ? format.trailingMargin * fontSize : 0
    const leftInset = format.directionRightToLeft ? trailingInset : leadingInset
    const rightInset = format.directionRightToLeft ? leadingInset : trailingInset
    const effectiveBounds = {
      x: bounds.x + leftInset,
      y: bounds.y,
      width: Math.max(0, bounds.width - leftInset - rightInset),
      height: bounds.height
    }
    const x =
      format.referencePoint?.x ??
      (this.ctx.textAlign === 'center'
        ? effectiveBounds.x + effectiveBounds.width / 2
        : this.ctx.textAlign === 'right'
          ? effectiveBounds.x + effectiveBounds.width
          : effectiveBounds.x)
    const y =
      format.referencePoint?.y ??
      (this.ctx.textBaseline === 'middle'
        ? bounds.y + bounds.height / 2
        : this.ctx.textBaseline === 'bottom' || this.ctx.textBaseline === 'alphabetic'
          ? bounds.y + bounds.height
          : bounds.y)
    const explicitMaxWidth = Number.isFinite(format.maxWidth) && format.maxWidth > 0 ? format.maxWidth : undefined
    const hotkeyText = processHotkeyPrefix(text, format.hotkeyPrefix)
    const sourceUnderlineRange = format.underlineRange ?? hotkeyText.underlineRange

    if (Array.isArray(format.transform) && format.transform.length === 6) {
      this.ctx.save()
      this.ctx.setTransform(...multiplyMatrices(this.currentTransform, format.transform))
    }

    const drawLine = (displayText, lineY, underlineRange, lineFormat = format) => {
      const useGlyphRun = explicitMaxWidth === undefined && hasGlyphRunSpacing(lineFormat)
      let glyphRun = null
      let textStartX = null
      let textEndX = null

      if (useGlyphRun) {
        glyphRun = createGlyphRun(this.ctx, displayText, x, lineY, {
          ...lineFormat,
          verticalAdvance: fontSize
        })
        textStartX = resolveTextStartX(this.ctx.textAlign, x, glyphRun.width)
        const offsetX = textStartX - x

        for (const glyph of glyphRun.glyphs) {
          this.ctx.fillText(glyph.text, glyph.x + offsetX, glyph.y)
        }

        textEndX = textStartX + glyphRun.width
      } else if (explicitMaxWidth !== undefined) {
        this.ctx.fillText(displayText, x, lineY, explicitMaxWidth)
      } else {
        this.ctx.fillText(displayText, x, lineY)
      }

      if (!(font?.underline || font?.strikeOut || underlineRange)) {
        return
      }

      const textWidth = glyphRun?.width ?? measureTextWidth(this.ctx, displayText, explicitMaxWidth)
      const startX = textStartX ?? resolveTextStartX(this.ctx.textAlign, x, textWidth)
      const endX = textEndX ?? startX + textWidth

      this.ctx.strokeStyle = this.ctx.fillStyle
      this.ctx.lineWidth = Math.max(1, fontSize / 16)

      if ((font?.underline || underlineRange) && typeof this.ctx.beginPath === 'function') {
        const underlineY = lineY + fontSize * 0.1
        const underlineSegment = underlineRange
          ? resolveDecorationSegment(this.ctx, displayText, underlineRange, startX)
          : { startX, endX }

        this.ctx.beginPath()
        this.ctx.moveTo(underlineSegment.startX, underlineY)
        this.ctx.lineTo(underlineSegment.endX, underlineY)
        this.ctx.stroke()
      }

      if (font?.strikeOut && typeof this.ctx.beginPath === 'function') {
        const strikeY = lineY - fontSize * 0.275
        this.ctx.beginPath()
        this.ctx.moveTo(startX, strikeY)
        this.ctx.lineTo(endX, strikeY)
        this.ctx.stroke()
      }
    }

    const layoutText = hotkeyText.text

    const hasExplicitLineLayout = /[\r\n\t]/.test(layoutText)
    const canAutoWrap =
      !format.noWrap &&
      !hasStringTrimming(format) &&
      !hasGlyphRunSpacing(format) &&
      explicitMaxWidth === undefined &&
      effectiveBounds.width > 0
    const shouldLayoutLines =
      hasExplicitLineLayout || (canAutoWrap && measureTextWidth(this.ctx, layoutText) > effectiveBounds.width + TEXT_WIDTH_EPSILON)

    if (shouldLayoutLines) {
      const lineHeight = resolveTextLineHeight(fontSize, format)
      const lines = applyLineLimit(
        resolveLayoutLines(this.ctx, layoutText, effectiveBounds.width, {
          ...format,
          explicitMaxWidth,
          disableAutoWrap: hasExplicitLineLayout
        }),
        effectiveBounds,
        y,
        lineHeight,
        format,
        canAutoWrap
      )

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const expandedLine = expandTabsForLine(this.ctx, line.text, format)
        const lineSourceUnderlineRange = sliceTextRange(sourceUnderlineRange, line.start, line.text.length)
        const expandedUnderlineRange = expandedLine.mapRange(lineSourceUnderlineRange)
        const displayText =
          explicitMaxWidth === undefined
            ? trimTextToWidth(expandedLine.text, format.trimming, effectiveBounds.width, this.ctx)
            : expandedLine.text
        const underlineRange = resolveVisibleUnderlineRange(expandedUnderlineRange, expandedLine.text, displayText)
        const lineFormat = { ...format }

        if (Array.isArray(format.advanceDx)) {
          const canUseLineAdvances =
            !line.text.includes('\t') && format.hotkeyPrefix !== 1 && format.hotkeyPrefix !== 2
          lineFormat.advanceDx = canUseLineAdvances
            ? format.advanceDx.slice(line.start, line.start + line.text.length)
            : undefined
        }

        drawLine(displayText, y + lineHeight * index, underlineRange, lineFormat)
      }
    } else {
      const displayText =
        explicitMaxWidth === undefined ? trimTextToWidth(layoutText, format.trimming, effectiveBounds.width, this.ctx) : layoutText
      const underlineRange = resolveVisibleUnderlineRange(sourceUnderlineRange, layoutText, displayText)

      drawLine(displayText, y, underlineRange, format)
    }

    if (Array.isArray(format.transform) && format.transform.length === 6) {
      this.ctx.restore()
    }

    if (previousDirection !== undefined) {
      this.ctx.direction = previousDirection
    }
  }

  drawDriverString(text, positions, font, brush, options = {}, transform = null) {
    if (typeof this.ctx.fillText !== 'function' || typeof text !== 'string' || text.length === 0) {
      return
    }

    if (!Array.isArray(positions) || positions.length === 0) {
      return
    }

    this.ctx.font = font?.cssFont ?? '10px sans-serif'
    this.ctx.fillStyle = this.resolvePaintStyle(brush)
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'alphabetic'

    const drawCalls =
      options.realizedAdvance || positions.length === 1
        ? [[text, positions[0]]]
        : positions.slice(0, text.length).map((position, index) => [text[index], position])

    if (drawCalls.length === 0) {
      return
    }

    if (Array.isArray(transform) && transform.length === 6) {
      this.ctx.save()
      this.ctx.setTransform(...multiplyMatrices(this.currentTransform, transform))
    }

    for (const [glyph, position] of drawCalls) {
      this.ctx.fillText(glyph, position.x, position.y)
    }

    if (Array.isArray(transform) && transform.length === 6) {
      this.ctx.restore()
    }
  }

  createWrappedImageSurface(source, sourceRect, imageAttributes) {
    const normalizedRect = normalizeImageRect(sourceRect, source)

    if (!normalizedRect || normalizedRect.width <= 0 || normalizedRect.height <= 0) {
      return null
    }

    const surface = this.createSurface(
      Math.max(1, Math.ceil(normalizedRect.width + 2)),
      Math.max(1, Math.ceil(normalizedRect.height + 2))
    )
    const context = surface?.getContext?.('2d')

    if (!surface || !context || typeof context.drawImage !== 'function') {
      return null
    }

    context.clearRect?.(0, 0, surface.width, surface.height)

    if (typeof context.fillRect === 'function' && !isTransparentColor(imageAttributes?.wrapColor)) {
      context.fillStyle = imageAttributes.wrapColor
      context.fillRect(0, 0, surface.width, surface.height)
    }

    context.drawImage(
      source,
      normalizedRect.x,
      normalizedRect.y,
      normalizedRect.width,
      normalizedRect.height,
      1,
      1,
      normalizedRect.width,
      normalizedRect.height
    )

    if (imageAttributes?.wrapMode !== 'clamp' && imageAttributes?.objectClamp !== true) {
      const sampleFromLeft = ['tile', 'tileFlipX', 'tileFlipXY'].includes(imageAttributes?.wrapMode)
        ? normalizedRect.x + normalizedRect.width - 1
        : normalizedRect.x
      const sampleFromRight = ['tile', 'tileFlipY'].includes(imageAttributes?.wrapMode)
        ? normalizedRect.x
        : normalizedRect.x + normalizedRect.width - 1
      const sampleFromTop = ['tile', 'tileFlipY', 'tileFlipXY'].includes(imageAttributes?.wrapMode)
        ? normalizedRect.y + normalizedRect.height - 1
        : normalizedRect.y
      const sampleFromBottom = ['tile', 'tileFlipX'].includes(imageAttributes?.wrapMode)
        ? normalizedRect.y
        : normalizedRect.y + normalizedRect.height - 1

      context.drawImage(source, sampleFromLeft, normalizedRect.y, 1, normalizedRect.height, 0, 1, 1, normalizedRect.height)
      context.drawImage(
        source,
        sampleFromRight,
        normalizedRect.y,
        1,
        normalizedRect.height,
        surface.width - 1,
        1,
        1,
        normalizedRect.height
      )
      context.drawImage(source, normalizedRect.x, sampleFromTop, normalizedRect.width, 1, 1, 0, normalizedRect.width, 1)
      context.drawImage(
        source,
        normalizedRect.x,
        sampleFromBottom,
        normalizedRect.width,
        1,
        1,
        surface.height - 1,
        normalizedRect.width,
        1
      )
      context.drawImage(source, sampleFromLeft, sampleFromTop, 1, 1, 0, 0, 1, 1)
      context.drawImage(source, sampleFromRight, sampleFromTop, 1, 1, surface.width - 1, 0, 1, 1)
      context.drawImage(source, sampleFromLeft, sampleFromBottom, 1, 1, 0, surface.height - 1, 1, 1)
      context.drawImage(
        source,
        sampleFromRight,
        sampleFromBottom,
        1,
        1,
        surface.width - 1,
        surface.height - 1,
        1,
        1
      )
    }

    return {
      source: surface,
      sourceRect: {
        x: 1,
        y: 1,
        width: normalizedRect.width,
        height: normalizedRect.height
      }
    }
  }

  createEffectImageSurface(source, sourceRect, imageEffect) {
    const normalizedRect = normalizeImageRect(sourceRect, source)

    if (
      !normalizedRect ||
      normalizedRect.width <= 0 ||
      normalizedRect.height <= 0 ||
      imageEffect?.kind !== 'effect'
    ) {
      return null
    }

    const surface = this.createSurface(normalizedRect.width, normalizedRect.height)
    const context = surface?.getContext?.('2d')

    if (
      !surface ||
      !context ||
      typeof context.drawImage !== 'function' ||
      typeof context.getImageData !== 'function' ||
      typeof context.putImageData !== 'function'
    ) {
      return null
    }

    context.clearRect?.(0, 0, normalizedRect.width, normalizedRect.height)
    context.drawImage(
      source,
      normalizedRect.x,
      normalizedRect.y,
      normalizedRect.width,
      normalizedRect.height,
      0,
      0,
      normalizedRect.width,
      normalizedRect.height
    )

    const imageData = context.getImageData(0, 0, normalizedRect.width, normalizedRect.height)
    applyImageEffectToPixels(imageData.data, normalizedRect.width, normalizedRect.height, imageEffect, {
      originX: normalizedRect.x,
      originY: normalizedRect.y
    })
    context.putImageData(imageData, 0, 0)

    return {
      source: surface,
      sourceRect: {
        x: 0,
        y: 0,
        width: normalizedRect.width,
        height: normalizedRect.height
      }
    }
  }

  prepareImageDrawSource(image, sourceRect, imageAttributes, imageEffect = null) {
    const source = this.resolveImageSource(image)

    if (!source) {
      return {
        source: null,
        sourceRect: null
      }
    }

    const normalizedRect = normalizeImageRect(sourceRect, source)
    const effected = this.createEffectImageSurface(source, normalizedRect, imageEffect)
    const resolvedSource = effected?.source ?? source
    const resolvedSourceRect = effected?.sourceRect ?? (sourceRect ? normalizedRect : null)

    if (!shouldPadWrappedImage(imageAttributes)) {
      return {
        source: resolvedSource,
        sourceRect: resolvedSourceRect
      }
    }

    const wrapped = this.createWrappedImageSurface(resolvedSource, resolvedSourceRect, imageAttributes)

    return wrapped ?? { source: resolvedSource, sourceRect: resolvedSourceRect }
  }

  withStretchModeSmoothing(imageAttributes, draw) {
    const smoothing = resolveStretchModeSmoothing(imageAttributes?.stretchMode)

    if (!smoothing) {
      draw()
      return
    }

    const previousEnabled = this.ctx.imageSmoothingEnabled
    const previousQuality = this.ctx.imageSmoothingQuality

    this.ctx.imageSmoothingEnabled = smoothing.enabled
    this.ctx.imageSmoothingQuality = smoothing.quality

    try {
      draw()
    } finally {
      this.ctx.imageSmoothingEnabled = previousEnabled
      this.ctx.imageSmoothingQuality = previousQuality
    }
  }

  drawPreparedImageSource(source, preparedSourceRect, dx, dy, dw, dh, imageAttributes) {
    if (!preparedSourceRect) {
      this.withStretchModeSmoothing(imageAttributes, () => {
        this.ctx.drawImage(source, dx, dy, dw, dh)
      })
      return
    }

    this.withStretchModeSmoothing(imageAttributes, () => {
      this.ctx.drawImage(
        source,
        preparedSourceRect.x,
        preparedSourceRect.y,
        preparedSourceRect.width,
        preparedSourceRect.height,
        dx,
        dy,
        dw,
        dh
      )
    })
  }

  drawSolidRasterRect(destinationRect, color) {
    this.ctx.save()
    try {
      this.ctx.setTransform(...this.currentTransform)
      this.ctx.fillStyle = formatOpaqueCssColor(color)
      this.ctx.fillRect(
        destinationRect.x + this.pixelOffset.x,
        destinationRect.y + this.pixelOffset.y,
        destinationRect.width,
        destinationRect.height
      )
    } finally {
      this.ctx.restore()
    }
  }

  mapRasterDeviceRect(destinationRect, imageAttributes) {
    const [a, b, c, d, e, f] = this.currentTransform

    if (Math.abs(b) > VECTOR_EPSILON || Math.abs(c) > VECTOR_EPSILON) {
      imageAttributes?.addWarning?.('Canvas backend cannot apply pixel raster operation to rotated or sheared destinations')
      return null
    }

    const left = a * (destinationRect.x + this.pixelOffset.x) + e
    const top = d * (destinationRect.y + this.pixelOffset.y) + f
    const width = a * destinationRect.width
    const height = d * destinationRect.height
    const normalized = {
      x: width >= 0 ? left : left + width,
      y: height >= 0 ? top : top + height,
      width: Math.abs(width),
      height: Math.abs(height)
    }
    const rounded = {
      x: Math.round(normalized.x),
      y: Math.round(normalized.y),
      width: Math.round(normalized.width),
      height: Math.round(normalized.height)
    }

    if (
      Math.abs(normalized.x - rounded.x) > VECTOR_EPSILON ||
      Math.abs(normalized.y - rounded.y) > VECTOR_EPSILON ||
      Math.abs(normalized.width - rounded.width) > VECTOR_EPSILON ||
      Math.abs(normalized.height - rounded.height) > VECTOR_EPSILON ||
      rounded.width <= 0 ||
      rounded.height <= 0
    ) {
      imageAttributes?.addWarning?.('Canvas backend can only apply pixel raster operations to integer device pixel rectangles')
      return null
    }

    return rounded
  }

  createRasterScratchSource(source, preparedSourceRect, width, height, imageAttributes) {
    const surface = this.createSurface(width, height)
    const context = surface?.getContext?.('2d')

    if (
      !surface ||
      !context ||
      typeof context.drawImage !== 'function' ||
      typeof context.getImageData !== 'function'
    ) {
      return null
    }

    const previousSmoothingEnabled = context.imageSmoothingEnabled
    const previousSmoothingQuality = context.imageSmoothingQuality
    const smoothing = resolveStretchModeSmoothing(imageAttributes?.stretchMode)

    if (smoothing) {
      context.imageSmoothingEnabled = smoothing.enabled
      context.imageSmoothingQuality = smoothing.quality
    }

    try {
      if (preparedSourceRect) {
        context.drawImage(
          source,
          preparedSourceRect.x,
          preparedSourceRect.y,
          preparedSourceRect.width,
          preparedSourceRect.height,
          0,
          0,
          width,
          height
        )
      } else {
        context.drawImage(source, 0, 0, width, height)
      }

      return context.getImageData(0, 0, width, height)
    } finally {
      context.imageSmoothingEnabled = previousSmoothingEnabled
      context.imageSmoothingQuality = previousSmoothingQuality
    }
  }

  applyTransparentColorKey(sourceData, color) {
    if (!color) {
      return
    }

    for (let offset = 0; offset < sourceData.length; offset += 4) {
      if (
        sourceData[offset] === color.red &&
        sourceData[offset + 1] === color.green &&
        sourceData[offset + 2] === color.blue
      ) {
        sourceData[offset + 3] = 0
      }
    }
  }

  applyRasterOperationPixels(targetData, sourceData, rasterOp) {
    for (let offset = 0; offset < targetData.length; offset += 4) {
      if (rasterOp === SRCAND) {
        targetData[offset] &= sourceData[offset]
        targetData[offset + 1] &= sourceData[offset + 1]
        targetData[offset + 2] &= sourceData[offset + 2]
        targetData[offset + 3] = Math.max(targetData[offset + 3], sourceData[offset + 3])
      } else if (rasterOp === SRCPAINT) {
        targetData[offset] |= sourceData[offset]
        targetData[offset + 1] |= sourceData[offset + 1]
        targetData[offset + 2] |= sourceData[offset + 2]
        targetData[offset + 3] = Math.max(targetData[offset + 3], sourceData[offset + 3])
      } else if (rasterOp === SRCINVERT) {
        targetData[offset] ^= sourceData[offset]
        targetData[offset + 1] ^= sourceData[offset + 1]
        targetData[offset + 2] ^= sourceData[offset + 2]
        targetData[offset + 3] = Math.max(targetData[offset + 3], sourceData[offset + 3])
      }
    }
  }

  drawPixelRasterOperation(source, preparedSourceRect, destinationRect, imageAttributes) {
    const deviceRect = this.mapRasterDeviceRect(destinationRect, imageAttributes)

    if (!deviceRect) {
      return false
    }

    const sourceImageData = this.createRasterScratchSource(
      source,
      preparedSourceRect,
      deviceRect.width,
      deviceRect.height,
      imageAttributes
    )

    if (!sourceImageData || typeof this.ctx.getImageData !== 'function' || typeof this.ctx.putImageData !== 'function') {
      imageAttributes?.addWarning?.('Canvas backend cannot apply classic raster operation without pixel readback')
      return false
    }

    this.applyTransparentColorKey(sourceImageData.data, imageAttributes?.transparentColor)

    const targetImageData = this.ctx.getImageData(
      deviceRect.x,
      deviceRect.y,
      deviceRect.width,
      deviceRect.height
    )

    if (imageAttributes?.transparentColor) {
      targetImageData.data.set(sourceImageData.data)
    } else {
      this.applyRasterOperationPixels(targetImageData.data, sourceImageData.data, imageAttributes?.rasterOp)
    }

    this.ctx.putImageData(targetImageData, deviceRect.x, deviceRect.y)
    return true
  }

  drawImageRect(image, destinationRect, sourceRect, imageAttributes = null, imageEffect = null) {
    const prepared = this.prepareImageDrawSource(image, sourceRect, imageAttributes, imageEffect)
    const source = prepared.source

    if (!source) {
      return
    }

    const dx = (destinationRect.width >= 0 ? destinationRect.x : destinationRect.x + destinationRect.width) + this.pixelOffset.x
    const dy = (destinationRect.height >= 0 ? destinationRect.y : destinationRect.y + destinationRect.height) + this.pixelOffset.y
    const dw = Math.abs(destinationRect.width)
    const dh = Math.abs(destinationRect.height)
    const previousAlpha = this.ctx.globalAlpha
    const normalizedDestinationRect = {
      x: destinationRect.width >= 0 ? destinationRect.x : destinationRect.x + destinationRect.width,
      y: destinationRect.height >= 0 ? destinationRect.y : destinationRect.y + destinationRect.height,
      width: Math.abs(destinationRect.width),
      height: Math.abs(destinationRect.height)
    }

    if (imageAttributes?.unsupportedBlendFunction) {
      imageAttributes?.addWarning?.('Unsupported EMR_ALPHABLEND blend function')
    }

    if (imageAttributes?.rasterOp === BLACKNESS) {
      this.drawSolidRasterRect(normalizedDestinationRect, { red: 0, green: 0, blue: 0 })
      return
    }

    if (imageAttributes?.rasterOp === WHITENESS) {
      this.drawSolidRasterRect(normalizedDestinationRect, { red: 255, green: 255, blue: 255 })
      return
    }

    if (imageAttributes?.rasterOp === PATCOPY) {
      const brushColor = parseCssColor(imageAttributes?.brush?.color ?? imageAttributes?.patternColor)

      if (brushColor) {
        this.drawSolidRasterRect(normalizedDestinationRect, brushColor)
      } else {
        imageAttributes?.addWarning?.('Canvas backend cannot apply PATCOPY without a solid pattern color')
      }
      return
    }

    if (
      imageAttributes?.transparentColor ||
      imageAttributes?.rasterOp === SRCAND ||
      imageAttributes?.rasterOp === SRCPAINT ||
      imageAttributes?.rasterOp === SRCINVERT
    ) {
      this.drawPixelRasterOperation(source, prepared.sourceRect, normalizedDestinationRect, imageAttributes)
      return
    }

    if (
      imageAttributes?.rasterOp !== undefined &&
      imageAttributes.rasterOp !== SRCCOPY &&
      !imageAttributes.transparentColor &&
      !imageAttributes.blendFunction
    ) {
      imageAttributes?.addWarning?.(`Unsupported classic raster operation: 0x${imageAttributes.rasterOp.toString(16)}`)
      return
    }

    if (
      imageAttributes?.blendFunction &&
      imageAttributes.blendFunction.operation !== AC_SRC_OVER
    ) {
      return
    }

    if (Number.isFinite(imageAttributes?.sourceConstantAlpha)) {
      this.ctx.globalAlpha = previousAlpha * Math.max(0, Math.min(1, imageAttributes.sourceConstantAlpha))
    }

    try {
      this.drawPreparedImageSource(source, prepared.sourceRect, dx, dy, dw, dh, imageAttributes)
    } finally {
      this.ctx.globalAlpha = previousAlpha
    }
  }

  drawImageParallelogram(image, points, sourceRect = null, imageAttributes = null, imageEffect = null) {
    const prepared = this.prepareImageDrawSource(image, sourceRect, imageAttributes, imageEffect)
    const source = prepared.source

    if (!source || points.length < 3) {
      return
    }

    const resolvedSourceRect = prepared.sourceRect
    const sourceWidth = resolvedSourceRect?.width ?? source.width
    const sourceHeight = resolvedSourceRect?.height ?? source.height

    if (!sourceWidth || !sourceHeight) {
      return
    }

    const imageTransform = [
      (points[1].x - points[0].x) / sourceWidth,
      (points[1].y - points[0].y) / sourceWidth,
      (points[2].x - points[0].x) / sourceHeight,
      (points[2].y - points[0].y) / sourceHeight,
      points[0].x + this.pixelOffset.x,
      points[0].y + this.pixelOffset.y
    ]
    const combinedTransform = multiplyMatrices(this.currentTransform, imageTransform)

    this.ctx.save()
    try {
      this.ctx.setTransform(...combinedTransform)

      this.withStretchModeSmoothing(imageAttributes, () => {
        if (resolvedSourceRect) {
          this.ctx.drawImage(
            source,
            resolvedSourceRect.x,
            resolvedSourceRect.y,
            resolvedSourceRect.width,
            resolvedSourceRect.height,
            0,
            0,
            resolvedSourceRect.width,
            resolvedSourceRect.height
          )
        } else {
          this.ctx.drawImage(source, 0, 0)
        }
      })
    } finally {
      this.ctx.restore()
    }
  }
}
