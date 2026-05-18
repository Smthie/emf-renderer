export const TA_UPDATECP = 0x00000001
export const TA_RIGHT = 0x00000002
export const TA_CENTER = 0x00000006
export const TA_BOTTOM = 0x00000008
export const TA_BASELINE = 0x00000018
const FONT_STYLE_BOLD = 0x0001
const FONT_STYLE_ITALIC = 0x0002
export const STRING_FORMAT_DIRECTION_RIGHT_TO_LEFT = 0x00000001
export const STRING_FORMAT_DIRECTION_VERTICAL = 0x00000002
export const STRING_FORMAT_NO_FIT_BLACK_BOX = 0x00000004
export const STRING_FORMAT_DISPLAY_FORMAT_CONTROL = 0x00000020
export const STRING_FORMAT_NO_FONT_FALLBACK = 0x00000400
export const STRING_FORMAT_MEASURE_TRAILING_SPACES = 0x00000800
export const STRING_FORMAT_NO_WRAP = 0x00001000
export const STRING_FORMAT_LINE_LIMIT = 0x00002000
export const STRING_FORMAT_NO_CLIP = 0x00004000
export const STRING_FORMAT_BYPASS_GDI = 0x80000000
const DEFAULT_CHARSET = 1
const SUPPORTED_CLASSIC_ANSI_CHARSETS = new Set([0, DEFAULT_CHARSET])
const WINDOWS_1252_CONTROL_CODES = [
  0x20ac,
  0x0081,
  0x201a,
  0x0192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x02c6,
  0x2030,
  0x0160,
  0x2039,
  0x0152,
  0x008d,
  0x017d,
  0x008f,
  0x0090,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x02dc,
  0x2122,
  0x0161,
  0x203a,
  0x0153,
  0x009d,
  0x017e,
  0x0178
]

export function mapGdiTextAlignToCanvas(flags = 0) {
  const updateCurrentPosition = (flags & TA_UPDATECP) !== 0

  const textAlign =
    (flags & TA_CENTER) === TA_CENTER ? 'center' : (flags & TA_RIGHT) === TA_RIGHT ? 'right' : 'left'

  // GDI vertical alignment: TA_BASELINE puts the reference point on the
  // alphabetic baseline, TA_BOTTOM on the bottom of the cell, and the default
  // (TA_TOP) on the top of the cell. The default must map to 'top', not
  // 'alphabetic' — otherwise every top-aligned run is lifted by roughly the
  // font ascent, which silently pushes large/scaled text off the top edge.
  const textBaseline =
    (flags & TA_BASELINE) === TA_BASELINE ? 'alphabetic' : (flags & TA_BOTTOM) === TA_BOTTOM ? 'bottom' : 'top'

  return {
    textAlign,
    textBaseline,
    updateCurrentPosition
  }
}

function normalizeClassicCharset(charSet) {
  return Number.isInteger(charSet) ? charSet : DEFAULT_CHARSET
}

function decodeWindows1252Byte(byte) {
  if (byte >= 0x80 && byte <= 0x9f) {
    return WINDOWS_1252_CONTROL_CODES[byte - 0x80]
  }

  return byte
}

export function resolveClassicAnsiCodePage(charSet) {
  const normalizedCharSet = normalizeClassicCharset(charSet)

  return {
    charSet: normalizedCharSet,
    codePage: 'windows-1252',
    supported: SUPPORTED_CLASSIC_ANSI_CHARSETS.has(normalizedCharSet)
  }
}

export function decodeClassicAnsiBytes(bytes, options = {}) {
  const resolved = resolveClassicAnsiCodePage(options.charSet)

  if (!resolved.supported && bytes.length > 0) {
    options.addWarning?.(`Unsupported EXTTEXTOUTA charset ${resolved.charSet}; decoding bytes as Windows-1252`, {
      code: 'classic-text-charset-unsupported',
      capability: 'classic-text-encoding',
      charSet: resolved.charSet,
      codePage: resolved.codePage
    })
  }

  const codePoints = []

  for (const byte of bytes) {
    codePoints.push(decodeWindows1252Byte(byte))
  }

  return String.fromCodePoint(...codePoints)
}

export function readClassicAnsiString(view, offset, length, maxBytes, options = {}) {
  const safeLength = Math.max(0, Math.min(length, maxBytes))
  const bytes = []

  for (let index = 0; index < safeLength; index += 1) {
    const byte = view.getUint8(offset + index)

    if (byte === 0) {
      break
    }

    bytes.push(byte)
  }

  return decodeClassicAnsiBytes(bytes, options)
}

function readNullTerminatedUtf16Le(view, offset, maxChars) {
  const chars = []

  for (let index = 0; index < maxChars; index += 1) {
    const code = view.getUint16(offset + index * 2, true)
    if (code === 0) {
      break
    }
    chars.push(code)
  }

  return String.fromCharCode(...chars)
}

export function decodeLogFontW(view, offset) {
  const height = view.getInt32(offset + 0, true)
  const escapement = view.getInt32(offset + 8, true)
  const orientation = view.getInt32(offset + 12, true)
  const weight = view.getInt32(offset + 16, true)
  const italic = view.getUint8(offset + 20) !== 0
  const underline = view.getUint8(offset + 21) !== 0
  const strikeOut = view.getUint8(offset + 22) !== 0
  const charSet = view.getUint8(offset + 23)
  const faceName = readNullTerminatedUtf16Le(view, offset + 28, 32)

  return {
    height,
    escapement,
    orientation,
    weight,
    italic,
    underline,
    strikeOut,
    charSet,
    faceName
  }
}

function quoteFontFamily(name) {
  if (!name) {
    return 'sans-serif'
  }

  // Canvas font syntax matches CSS: quote family names with spaces.
  return /\s/.test(name) ? `"${name.replaceAll('"', '\\"')}"` : name
}

function readUtf16LeString(view, offset, length) {
  const chars = []

  for (let index = 0; index < length; index += 1) {
    chars.push(view.getUint16(offset + index * 2, true))
  }

  return String.fromCharCode(...chars)
}

export function buildCssFontFromLogFontW(logFont = {}) {
  const px = Number.isFinite(logFont.height) ? Math.max(1, Math.abs(logFont.height)) : 10
  const weight = Number.isFinite(logFont.weight) && logFont.weight > 0 ? logFont.weight : 400
  const italic = logFont.italic ? 'italic ' : ''
  const family = quoteFontFamily(logFont.faceName)

  return `${italic}${weight} ${px}px ${family}`
}

function resolveEmfPlusFontPixels(font = {}) {
  if (!Number.isFinite(font.emSize) || font.emSize <= 0) {
    return 10
  }

  if (font.sizeUnit === 3) {
    return font.emSize * (96 / 72)
  }

  return font.emSize
}

export function buildCssFontFromEmfPlusFont(font = {}) {
  const px = Math.max(1, resolveEmfPlusFontPixels(font))
  const italic = (font.styleFlags & FONT_STYLE_ITALIC) !== 0 ? 'italic ' : ''
  const weight = (font.styleFlags & FONT_STYLE_BOLD) !== 0 ? 'bold ' : ''
  const family = quoteFontFamily(font.familyName)

  return `${italic}${weight}${px}px ${family}`.trim()
}

export function decodeEmfPlusFont(view, offset, dataSize) {
  const familyLength = dataSize >= 24 ? view.getUint32(offset + 20, true) : 0
  const availableChars = Math.max(0, Math.min(familyLength, Math.floor(Math.max(0, dataSize - 24) / 2)))
  const familyName = availableChars > 0 ? readUtf16LeString(view, offset + 24, availableChars) : ''
  const font = {
    kind: 'font',
    emSize: view.getFloat32(offset + 4, true),
    sizeUnit: view.getUint32(offset + 8, true),
    styleFlags: view.getUint32(offset + 12, true),
    reserved: view.getUint32(offset + 16, true),
    familyName
  }

  font.cssFont = buildCssFontFromEmfPlusFont(font)
  return font
}

function mapStringAlignmentToCanvas(value = 0) {
  return (
    {
      1: 'center',
      2: 'right'
    }[value] || 'left'
  )
}

function flipHorizontalTextAlign(align) {
  return align === 'left' ? 'right' : align === 'right' ? 'left' : align
}

function mapLineAlignmentToCanvas(value = 0) {
  return (
    {
      1: 'middle',
      2: 'bottom'
    }[value] || 'top'
  )
}

export function processHotkeyPrefix(text, mode = 0) {
  const source = String(text ?? '')

  if (mode !== 1 && mode !== 2) {
    return { text: source }
  }

  let result = ''
  let underlineRange

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (char !== '&') {
      result += char
      continue
    }

    const next = source[index + 1]

    if (next === '&') {
      result += '&'
      index += 1
      continue
    }

    if (mode === 1 && next !== undefined && !underlineRange) {
      const nextChar = Array.from(source.slice(index + 1))[0] ?? ''
      underlineRange = {
        start: result.length,
        length: nextChar.length
      }
    }
  }

  return underlineRange ? { text: result, underlineRange } : { text: result }
}

export function decodeEmfPlusStringFormat(view, offset, dataSize) {
  const formatFlags = dataSize >= 8 ? view.getUint32(offset + 4, true) : 0
  const format = {
    kind: 'stringFormat',
    formatFlags,
    language: dataSize >= 12 ? view.getUint32(offset + 8, true) : 0,
    stringAlignment: dataSize >= 16 ? view.getUint32(offset + 12, true) : 0,
    lineAlign: dataSize >= 20 ? view.getUint32(offset + 16, true) : 0,
    digitSubstitutionMethod: dataSize >= 24 ? view.getUint32(offset + 20, true) : 0,
    digitSubstitutionLanguage: dataSize >= 28 ? view.getUint32(offset + 24, true) : 0,
    firstTabOffset: dataSize >= 32 ? view.getFloat32(offset + 28, true) : 0,
    hotkeyPrefix: dataSize >= 36 ? view.getInt32(offset + 32, true) : 0,
    leadingMargin: dataSize >= 40 ? view.getFloat32(offset + 36, true) : 0,
    trailingMargin: dataSize >= 44 ? view.getFloat32(offset + 40, true) : 0,
    tracking: dataSize >= 48 ? view.getFloat32(offset + 44, true) : 0,
    trimming: dataSize >= 52 ? view.getUint32(offset + 48, true) : 0
  }

  format.textAlign = mapStringAlignmentToCanvas(format.stringAlignment)
  format.textBaseline = mapLineAlignmentToCanvas(format.lineAlign)
  format.directionRightToLeft = (formatFlags & STRING_FORMAT_DIRECTION_RIGHT_TO_LEFT) !== 0
  format.directionVertical = (formatFlags & STRING_FORMAT_DIRECTION_VERTICAL) !== 0
  format.noFitBlackBox = (formatFlags & STRING_FORMAT_NO_FIT_BLACK_BOX) !== 0
  format.displayFormatControl = (formatFlags & STRING_FORMAT_DISPLAY_FORMAT_CONTROL) !== 0
  format.noFontFallback = (formatFlags & STRING_FORMAT_NO_FONT_FALLBACK) !== 0
  format.measureTrailingSpaces = (formatFlags & STRING_FORMAT_MEASURE_TRAILING_SPACES) !== 0
  format.noWrap = (formatFlags & STRING_FORMAT_NO_WRAP) !== 0
  format.lineLimit = (formatFlags & STRING_FORMAT_LINE_LIMIT) !== 0
  format.noClip = (formatFlags & STRING_FORMAT_NO_CLIP) !== 0
  format.bypassGdi = (formatFlags & STRING_FORMAT_BYPASS_GDI) !== 0

  if (format.directionRightToLeft) {
    format.textAlign = flipHorizontalTextAlign(format.textAlign)
  }

  return format
}
