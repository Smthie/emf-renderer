import {
  EMR_ALPHABLEND,
  EMR_BITBLT,
  EMR_MASKBLT,
  EMR_PLGBLT,
  EMR_SETDIBITSTODEVICE,
  EMR_STRETCHBLT,
  EMR_STRETCHDIBITS,
  EMR_TRANSPARENTBLT
} from '../emf/constants.js'
import { decode as decodePng } from 'fast-png'
import { normalizeRect } from '../emfplus/primitives.js'

const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_JPEG = 4
const BI_PNG = 5
const BLACKNESS = 0x00000042
const NOP = 0x00aa0029
const SRCCOPY = 0x00cc0020
const WHITENESS = 0x00ff0062
const AC_SRC_OVER = 0x00
const AC_SRC_ALPHA = 0x01
const EMFPLUS_BITMAP_DATA_TYPE_PIXEL = 0
const EMFPLUS_BITMAP_DATA_TYPE_COMPRESSED = 1
const EMFPLUS_PIXEL_FORMAT_BPP_SHIFT = 8
const EMFPLUS_PIXEL_FORMAT_INDEXED = 0x00010000
const EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED = 0x00030803
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB555 = 0x00021005
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB565 = 0x00021006
const EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555 = 0x00061007
const EMFPLUS_PIXEL_FORMAT_24BPP_RGB = 0x00021808
const EMFPLUS_PIXEL_FORMAT_32BPP_RGB = 0x00022009
const EMFPLUS_PIXEL_FORMAT_32BPP_ARGB = 0x0026200a
const EMFPLUS_PIXEL_FORMAT_32BPP_PARGB = 0x000e200b
const MAX_METAFILE_SURFACE_DIMENSION = 4096
const MAX_METAFILE_SURFACE_PIXELS = 4096 * 4096
const NATIVE_COMPRESSED_BITMAP_FORMATS = new Set(['jpeg', 'gif', 'bmp'])

function addWarning(options, message, details = {}) {
  options.addWarning?.(message, details)
}

function markSurfaceFailure(image, options, message, details = {}) {
  if (image && typeof image === 'object') {
    image.surfaceFailure = {
      message,
      ...details
    }
  }

  addWarning(options, message, details)
}

function getRasterRecordName(record) {
  if (record.type === EMR_ALPHABLEND) {
    return 'EMR_ALPHABLEND'
  }

  if (record.type === EMR_STRETCHDIBITS) {
    return 'EMR_STRETCHDIBITS'
  }

  if (record.type === EMR_BITBLT) {
    return 'EMR_BITBLT'
  }

  if (record.type === EMR_MASKBLT) {
    return 'EMR_MASKBLT'
  }

  if (record.type === EMR_PLGBLT) {
    return 'EMR_PLGBLT'
  }

  if (record.type === EMR_SETDIBITSTODEVICE) {
    return 'EMR_SETDIBITSTODEVICE'
  }

  if (record.type === EMR_STRETCHBLT) {
    return 'EMR_STRETCHBLT'
  }

  if (record.type === EMR_TRANSPARENTBLT) {
    return 'EMR_TRANSPARENTBLT'
  }

  return `record 0x${record.type.toString(16)}`
}

function resolveRecordStart(record) {
  return Number.isFinite(record.offset) ? record.offset : record.dataOffset - 8
}

function resolveRecordEnd(record) {
  if (Number.isFinite(record.offset) && Number.isFinite(record.size)) {
    return record.offset + record.size
  }

  return record.dataOffset + record.dataSize
}

function ensureRecordDataLength(view, record, requiredDataSize, options = {}) {
  const recordName = options.recordName ?? getRasterRecordName(record)
  const recordEnd = resolveRecordEnd(record)

  if (
    !Number.isInteger(record.dataOffset) ||
    !Number.isInteger(requiredDataSize) ||
    requiredDataSize < 0 ||
    record.dataOffset < 0 ||
    record.dataOffset + requiredDataSize > view.byteLength ||
    record.dataOffset + requiredDataSize > recordEnd
  ) {
    addWarning(options, `${recordName} header is truncated`)
    return false
  }

  return true
}

function readAbsoluteBytes(view, offset, size, options = {}) {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0) {
    addWarning(options, `${options.label ?? 'Raster payload'} has invalid offset/size`)
    return null
  }

  if (Number.isFinite(options.rangeStart) && offset < options.rangeStart) {
    addWarning(options, `${options.label ?? 'Raster payload'} begins before record bounds`)
    return null
  }

  if (offset + size > view.byteLength) {
    addWarning(options, `${options.label ?? 'Raster payload'} exceeds record bounds`)
    return null
  }

  if (Number.isFinite(options.rangeEnd) && offset + size > options.rangeEnd) {
    addWarning(options, `${options.label ?? 'Raster payload'} exceeds record bounds`)
    return null
  }

  return new Uint8Array(view.buffer, view.byteOffset + offset, size).slice()
}

function scaleChannel(value, max) {
  if (max <= 0) {
    return 0
  }

  return Math.round((value * 255) / max)
}

function readPaletteColor(bytes, index) {
  const offset = index * 4

  if (offset + 3 >= bytes.byteLength) {
    return [0, 0, 0, 255]
  }

  return [bytes[offset + 2], bytes[offset + 1], bytes[offset], 255]
}

function readEmfPlusPaletteColor(palette, index) {
  const entry = palette?.entries?.[index]

  if (!entry) {
    return [0, 0, 0, 255]
  }

  return [entry.red ?? 0, entry.green ?? 0, entry.blue ?? 0, entry.alpha ?? 255]
}

function unpremultiplyChannel(value, alpha) {
  if (alpha <= 0) {
    return 0
  }

  return Math.min(255, Math.round((value * 255) / alpha))
}

function readBitfieldsMask(view, offset, fallback) {
  if (offset + 4 > view.byteLength) {
    return fallback
  }

  return view.getUint32(offset, true)
}

function createImageDataRecord(context, width, height) {
  if (typeof context.createImageData === 'function') {
    return context.createImageData(width, height)
  }

  if (typeof ImageData !== 'undefined') {
    return new ImageData(width, height)
  }

  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  }
}

function readDibMetadata(image, options = {}) {
  if (!(image.bmiBytes instanceof Uint8Array) || image.bmiBytes.byteLength < 40) {
    addWarning(options, 'DIB metadata is truncated')
    return null
  }

  const view = new DataView(image.bmiBytes.buffer, image.bmiBytes.byteOffset, image.bmiBytes.byteLength)
  const headerSize = view.getUint32(0, true)

  if (headerSize < 40 || headerSize > image.bmiBytes.byteLength) {
    addWarning(options, 'DIB metadata header is invalid')
    return null
  }

  const width = Math.abs(view.getInt32(4, true))
  const rawHeight = view.getInt32(8, true)
  const bitCount = view.getUint16(14, true)
  const compression = view.getUint32(16, true)
  const colorsUsed = view.getUint32(32, true)
  const height = Math.abs(rawHeight)

  if (width === 0 || height === 0) {
    addWarning(options, 'DIB metadata has invalid dimensions')
    return null
  }

  const bitfieldMaskOffset = 40
  const hasBitfieldMasks = compression === BI_BITFIELDS && image.bmiBytes.byteLength >= bitfieldMaskOffset + 12
  const hasAlphaMask = hasBitfieldMasks && image.bmiBytes.byteLength >= bitfieldMaskOffset + 16
  const paletteOffset = compression === BI_BITFIELDS && headerSize === 40
    ? headerSize + (hasAlphaMask ? 16 : 12)
    : headerSize
  const paletteEntries =
    bitCount <= 8
      ? Math.min(
          Math.floor(Math.max(0, image.bmiBytes.byteLength - paletteOffset) / 4),
          colorsUsed || (1 << bitCount)
        )
      : 0

  return {
    width,
    height,
    topDown: rawHeight < 0,
    bitCount,
    compression,
    paletteBytes: image.bmiBytes.subarray(paletteOffset, paletteOffset + paletteEntries * 4),
    masks:
      hasBitfieldMasks
        ? {
            red: readBitfieldsMask(view, bitfieldMaskOffset, 0x00ff0000),
            green: readBitfieldsMask(view, bitfieldMaskOffset + 4, 0x0000ff00),
            blue: readBitfieldsMask(view, bitfieldMaskOffset + 8, 0x000000ff),
            alpha: hasAlphaMask ? readBitfieldsMask(view, bitfieldMaskOffset + 12, 0) : 0
          }
        : null
  }
}

function readMaskedChannel(value, mask) {
  if (!mask) {
    return 0
  }

  let shift = 0
  let normalizedMask = mask >>> 0

  while ((normalizedMask & 1) === 0) {
    normalizedMask >>>= 1
    shift += 1
  }

  return scaleChannel((value & mask) >>> shift, normalizedMask)
}

function decodeRleDibPixels(image, metadata, options = {}) {
  const { width, height, topDown, bitCount, compression, paletteBytes } = metadata
  const expectedBitCount = compression === BI_RLE8 ? 8 : 4

  if (topDown) {
    markSurfaceFailure(
      image,
      options,
      `Unsupported top-down DIB RLE compression: BI_RLE${expectedBitCount}`,
      {
        code: 'unsupported-dib-rle-top-down',
        capability: 'classic-dib-decode',
        reason: `BI_RLE${expectedBitCount}`
      }
    )
    return null
  }

  if (bitCount !== expectedBitCount) {
    markSurfaceFailure(
      image,
      options,
      `Unsupported DIB RLE bit depth: BI_RLE${expectedBitCount} with ${bitCount} bpp`,
      {
        code: 'unsupported-dib-rle-bit-depth',
        capability: 'classic-dib-decode',
        reason: `${bitCount}bpp`
      }
    )
    return null
  }

  const indices = new Uint8Array(width * height)
  let cursor = 0
  let x = 0
  let y = 0
  let endedByEob = false

  const fail = (reason) => {
    markSurfaceFailure(image, options, `DIB RLE payload is truncated: ${reason}`, {
      code: 'dib-rle-decode-failed',
      capability: 'classic-dib-decode',
      reason
    })
    return null
  }

  const writeIndex = (paletteIndex) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      indices[(height - y - 1) * width + x] = paletteIndex & 0xff
    }

    x += 1
  }

  while (cursor < image.bitsBytes.byteLength && y < height) {
    if (cursor + 2 > image.bitsBytes.byteLength) {
      return fail('missing RLE command byte')
    }

    const count = image.bitsBytes[cursor]
    const value = image.bitsBytes[cursor + 1]
    cursor += 2

    if (count > 0) {
      if (compression === BI_RLE8) {
        for (let index = 0; index < count; index += 1) {
          writeIndex(value)
        }
        continue
      }

      const high = (value >> 4) & 0x0f
      const low = value & 0x0f

      for (let index = 0; index < count; index += 1) {
        writeIndex((index & 1) === 0 ? high : low)
      }
      continue
    }

    if (value === 0) {
      x = 0
      y += 1
      continue
    }

    if (value === 1) {
      endedByEob = true
      break
    }

    if (value === 2) {
      if (cursor + 2 > image.bitsBytes.byteLength) {
        return fail('missing RLE delta bytes')
      }

      x += image.bitsBytes[cursor]
      y += image.bitsBytes[cursor + 1]
      cursor += 2
      continue
    }

    if (compression === BI_RLE8) {
      if (cursor + value > image.bitsBytes.byteLength) {
        return fail('missing RLE8 absolute bytes')
      }

      for (let index = 0; index < value; index += 1) {
        writeIndex(image.bitsBytes[cursor + index])
      }

      cursor += value

      if ((value & 1) !== 0) {
        if (cursor + 1 > image.bitsBytes.byteLength) {
          return fail('missing RLE8 absolute padding byte')
        }

        cursor += 1
      }
      continue
    }

    const byteCount = Math.ceil(value / 2)

    if (cursor + byteCount > image.bitsBytes.byteLength) {
      return fail('missing RLE4 absolute bytes')
    }

    for (let index = 0; index < value; index += 1) {
      const packed = image.bitsBytes[cursor + (index >> 1)]
      writeIndex((index & 1) === 0 ? (packed >> 4) & 0x0f : packed & 0x0f)
    }

    cursor += byteCount

    if ((byteCount & 1) !== 0) {
      if (cursor + 1 > image.bitsBytes.byteLength) {
        return fail('missing RLE4 absolute padding byte')
      }

      cursor += 1
    }
  }

  if (!endedByEob) {
    return fail('missing RLE end-of-bitmap marker')
  }

  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < indices.length; index += 1) {
    const [red, green, blue, alpha] = readPaletteColor(paletteBytes, indices[index])
    const pixelOffset = index * 4

    pixels[pixelOffset] = red
    pixels[pixelOffset + 1] = green
    pixels[pixelOffset + 2] = blue
    pixels[pixelOffset + 3] = alpha
  }

  return {
    width,
    height,
    pixels
  }
}

function decodeDibPixels(image, options = {}) {
  const metadata = readDibMetadata(image, options)

  if (!metadata) {
    return null
  }

  const { width, height, topDown, bitCount, compression, paletteBytes, masks } = metadata

  if (compression === BI_RLE8 || compression === BI_RLE4) {
    return decodeRleDibPixels(image, metadata, options)
  }

  if (compression !== BI_RGB && compression !== BI_BITFIELDS) {
    const names = {
      [BI_JPEG]: 'BI_JPEG',
      [BI_PNG]: 'BI_PNG'
    }

    markSurfaceFailure(
      image,
      options,
      `Unsupported DIB compression: ${names[compression] ?? compression}`,
      {
        code: 'unsupported-dib-compression',
        capability: 'classic-dib-decode',
        reason: names[compression] ?? String(compression)
      }
    )
    return null
  }

  const pixels = new Uint8ClampedArray(width * height * 4)
  const rowStride = Math.floor(((width * bitCount) + 31) / 32) * 4
  const bitsView = new DataView(image.bitsBytes.buffer, image.bitsBytes.byteOffset, image.bitsBytes.byteLength)
  const useSourceAlpha = image.sourceAlpha === true

  for (let y = 0; y < height; y += 1) {
    const sourceRow = topDown ? y : height - y - 1
    const rowOffset = sourceRow * rowStride

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 255

      if (bitCount === 1) {
        const byteIndex = rowOffset + (x >> 3)
        const bitIndex = 7 - (x & 0x07)
        const paletteIndex = byteIndex < image.bitsBytes.byteLength ? (image.bitsBytes[byteIndex] >> bitIndex) & 0x01 : 0
        ;[red, green, blue, alpha] = readPaletteColor(paletteBytes, paletteIndex)
      } else if (bitCount === 4) {
        const byteIndex = rowOffset + (x >> 1)
        const packed = byteIndex < image.bitsBytes.byteLength ? image.bitsBytes[byteIndex] : 0
        const paletteIndex = (x & 0x01) === 0 ? (packed >> 4) & 0x0f : packed & 0x0f
        ;[red, green, blue, alpha] = readPaletteColor(paletteBytes, paletteIndex)
      } else if (bitCount === 8) {
        const paletteIndex = rowOffset + x < image.bitsBytes.byteLength ? image.bitsBytes[rowOffset + x] : 0
        ;[red, green, blue, alpha] = readPaletteColor(paletteBytes, paletteIndex)
      } else if (bitCount === 16) {
        const value = rowOffset + x * 2 + 2 <= image.bitsBytes.byteLength ? bitsView.getUint16(rowOffset + x * 2, true) : 0

        if (compression === BI_BITFIELDS && masks) {
          red = readMaskedChannel(value, masks.red)
          green = readMaskedChannel(value, masks.green)
          blue = readMaskedChannel(value, masks.blue)
          alpha = masks.alpha ? readMaskedChannel(value, masks.alpha) : 255
        } else {
          red = scaleChannel((value >> 10) & 0x1f, 0x1f)
          green = scaleChannel((value >> 5) & 0x1f, 0x1f)
          blue = scaleChannel(value & 0x1f, 0x1f)
        }
      } else if (bitCount === 24) {
        const byteIndex = rowOffset + x * 3
        blue = image.bitsBytes[byteIndex] ?? 0
        green = image.bitsBytes[byteIndex + 1] ?? 0
        red = image.bitsBytes[byteIndex + 2] ?? 0
      } else if (bitCount === 32) {
        const byteIndex = rowOffset + x * 4
        const value = byteIndex + 4 <= image.bitsBytes.byteLength ? bitsView.getUint32(byteIndex, true) : 0

        if (compression === BI_BITFIELDS && masks) {
          red = readMaskedChannel(value, masks.red)
          green = readMaskedChannel(value, masks.green)
          blue = readMaskedChannel(value, masks.blue)
          alpha = masks.alpha
            ? readMaskedChannel(value, masks.alpha)
            : useSourceAlpha
              ? image.bitsBytes[byteIndex + 3] ?? 255
              : 255
        } else {
          blue = image.bitsBytes[byteIndex] ?? 0
          green = image.bitsBytes[byteIndex + 1] ?? 0
          red = image.bitsBytes[byteIndex + 2] ?? 0
          alpha = useSourceAlpha ? image.bitsBytes[byteIndex + 3] ?? 255 : 255
        }
      }

      pixels[pixelOffset] = red
      pixels[pixelOffset + 1] = green
      pixels[pixelOffset + 2] = blue
      pixels[pixelOffset + 3] = alpha
    }
  }

  return {
    width,
    height,
    pixels
  }
}

function renderSurfaceFromPixels(image, decoded, options, failureLabel) {
  const createSurface = options.createSurface ?? (() => null)
  const surface = createSurface(decoded.width, decoded.height)

  if (!surface) {
    markSurfaceFailure(image, options, failureLabel, {
      code: 'image-surface-unavailable',
      capability: 'image-surface'
    })
    return image
  }

  surface.width = decoded.width
  surface.height = decoded.height

  const context = surface.getContext?.('2d')

  if (context) {
    context.clearRect?.(0, 0, decoded.width, decoded.height)

    if (typeof context.putImageData === 'function') {
      const imageData = createImageDataRecord(context, decoded.width, decoded.height)
      imageData.data.set(decoded.pixels)
      context.putImageData(imageData, 0, 0)
    }
  }

  image.width = decoded.width
  image.height = decoded.height
  image.canvas = surface
  delete image.surfaceFailure

  return image
}

function normalizeEncodedPng(decoded) {
  const channels = decoded.channels ?? 4
  const source = decoded.data instanceof Uint8ClampedArray ? decoded.data : new Uint8ClampedArray(decoded.data)
  const pixels = new Uint8ClampedArray(decoded.width * decoded.height * 4)

  for (let index = 0; index < decoded.width * decoded.height; index += 1) {
    const sourceOffset = index * channels
    const targetOffset = index * 4

    if (channels === 1) {
      const value = source[sourceOffset] ?? 0
      pixels[targetOffset] = value
      pixels[targetOffset + 1] = value
      pixels[targetOffset + 2] = value
      pixels[targetOffset + 3] = 255
      continue
    }

    if (channels === 2) {
      const value = source[sourceOffset] ?? 0
      pixels[targetOffset] = value
      pixels[targetOffset + 1] = value
      pixels[targetOffset + 2] = value
      pixels[targetOffset + 3] = source[sourceOffset + 1] ?? 255
      continue
    }

    if (channels === 3) {
      pixels[targetOffset] = source[sourceOffset] ?? 0
      pixels[targetOffset + 1] = source[sourceOffset + 1] ?? 0
      pixels[targetOffset + 2] = source[sourceOffset + 2] ?? 0
      pixels[targetOffset + 3] = 255
      continue
    }

    pixels[targetOffset] = source[sourceOffset] ?? 0
    pixels[targetOffset + 1] = source[sourceOffset + 1] ?? 0
    pixels[targetOffset + 2] = source[sourceOffset + 2] ?? 0
    pixels[targetOffset + 3] = source[sourceOffset + 3] ?? 255
  }

  return {
    width: decoded.width,
    height: decoded.height,
    pixels
  }
}

function decodeCompressedBitmapPixels(image, options = {}) {
  if (image.pixels instanceof Uint8ClampedArray && image.width > 0 && image.height > 0) {
    return {
      width: image.width,
      height: image.height,
      pixels: image.pixels
    }
  }

  if (image.compression !== 'png') {
    if (NATIVE_COMPRESSED_BITMAP_FORMATS.has(image.compression)) {
      markSurfaceFailure(
        image,
        options,
        `Compressed EMF+ ${image.compression} bitmap requires browser-native decode, but no decoded pixels are available`,
        {
          code: 'compressed-bitmap-native-decode-unavailable',
          capability: 'compressed-bitmap-decode',
          reason: image.compression
        }
      )
      return null
    }

    markSurfaceFailure(
      image,
      options,
      `Unsupported compressed EMF+ bitmap format: ${image.compression ?? 'unknown'}`,
      {
        code: 'unsupported-compressed-bitmap-format',
        capability: 'compressed-bitmap-decode',
        reason: image.compression ?? 'unknown'
      }
    )
    return null
  }

  try {
    return normalizeEncodedPng(decodePng(image.bytes))
  } catch (error) {
    markSurfaceFailure(image, options, `Failed to decode compressed EMF+ bitmap payload: ${error.message}`, {
      code: 'compressed-bitmap-decode-failed',
      capability: 'compressed-bitmap-decode',
      reason: error.message
    })
    return null
  }
}

function decodeRawBitmapPixels(image, options = {}) {
  const width = image.width
  const height = image.height
  const stride = Math.abs(image.stride)
  const pixelFormat = image.pixelFormat >>> 0
  const bitsPerPixel = (pixelFormat >> EMFPLUS_PIXEL_FORMAT_BPP_SHIFT) & 0xff

  if (!width || !height || !stride || !bitsPerPixel) {
    addWarning(options, 'EMF+ bitmap metadata is invalid')
    return null
  }

  if ((pixelFormat & EMFPLUS_PIXEL_FORMAT_INDEXED) !== 0 && !image.palette) {
    addWarning(options, `Unsupported EMF+ bitmap indexed pixel format without palette: ${image.pixelFormat}`)
    return null
  }

  const pixels = new Uint8ClampedArray(width * height * 4)
  const bitsView = new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength)

  for (let y = 0; y < height; y += 1) {
    const sourceRow = image.stride < 0 ? height - y - 1 : y
    const rowOffset = sourceRow * stride

    for (let x = 0; x < width; x += 1) {
      const targetOffset = (y * width + x) * 4
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 255

      if (pixelFormat === EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED || ((pixelFormat & EMFPLUS_PIXEL_FORMAT_INDEXED) !== 0 && bitsPerPixel === 8)) {
        const sourceOffset = rowOffset + x
        const paletteIndex = sourceOffset < image.bytes.byteLength ? image.bytes[sourceOffset] : 0
        ;[red, green, blue, alpha] = readEmfPlusPaletteColor(image.palette, paletteIndex)
      } else if (
        pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_RGB555 ||
        pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_RGB565 ||
        pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555
      ) {
        const sourceOffset = rowOffset + x * 2
        const value = sourceOffset + 2 <= image.bytes.byteLength ? bitsView.getUint16(sourceOffset, true) : 0

        if (pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_RGB565) {
          red = scaleChannel((value >> 11) & 0x1f, 0x1f)
          green = scaleChannel((value >> 5) & 0x3f, 0x3f)
          blue = scaleChannel(value & 0x1f, 0x1f)
        } else {
          red = scaleChannel((value >> 10) & 0x1f, 0x1f)
          green = scaleChannel((value >> 5) & 0x1f, 0x1f)
          blue = scaleChannel(value & 0x1f, 0x1f)
          alpha = pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555 ? ((value & 0x8000) !== 0 ? 255 : 0) : 255
        }
      } else if (
        pixelFormat === EMFPLUS_PIXEL_FORMAT_32BPP_RGB ||
        pixelFormat === EMFPLUS_PIXEL_FORMAT_32BPP_ARGB ||
        pixelFormat === EMFPLUS_PIXEL_FORMAT_32BPP_PARGB
      ) {
        const sourceOffset = rowOffset + x * 4
        blue = image.bytes[sourceOffset] ?? 0
        green = image.bytes[sourceOffset + 1] ?? 0
        red = image.bytes[sourceOffset + 2] ?? 0
        alpha = pixelFormat === EMFPLUS_PIXEL_FORMAT_32BPP_RGB ? 255 : image.bytes[sourceOffset + 3] ?? 255

        if (pixelFormat === EMFPLUS_PIXEL_FORMAT_32BPP_PARGB) {
          red = unpremultiplyChannel(red, alpha)
          green = unpremultiplyChannel(green, alpha)
          blue = unpremultiplyChannel(blue, alpha)
        }
      } else if (pixelFormat === EMFPLUS_PIXEL_FORMAT_24BPP_RGB) {
        const sourceOffset = rowOffset + x * 3
        blue = image.bytes[sourceOffset] ?? 0
        green = image.bytes[sourceOffset + 1] ?? 0
        red = image.bytes[sourceOffset + 2] ?? 0
      } else {
        addWarning(options, `Unsupported EMF+ bitmap pixel format: ${image.pixelFormat}`)
        return null
      }

      pixels[targetOffset] = red
      pixels[targetOffset + 1] = green
      pixels[targetOffset + 2] = blue
      pixels[targetOffset + 3] = alpha
    }
  }

  return {
    width,
    height,
    pixels
  }
}

function renderBitmapSurface(image, options) {
  const decoded =
    image.bitmapDataType === EMFPLUS_BITMAP_DATA_TYPE_COMPRESSED
      ? decodeCompressedBitmapPixels(image, options)
      : image.bitmapDataType === EMFPLUS_BITMAP_DATA_TYPE_PIXEL
        ? decodeRawBitmapPixels(image, options)
        : null

  if (!decoded) {
    if (image.bitmapDataType !== EMFPLUS_BITMAP_DATA_TYPE_COMPRESSED && image.bitmapDataType !== EMFPLUS_BITMAP_DATA_TYPE_PIXEL) {
      addWarning(options, `Unsupported EMF+ bitmap data type: ${image.bitmapDataType}`)
    }

    return image
  }

  return renderSurfaceFromPixels(image, decoded, options, 'Unable to create image surface for EMF+ bitmap payload')
}

function renderDibSurface(image, options) {
  const decoded = decodeDibPixels(image, options)

  if (!decoded) {
    return image
  }

  return renderSurfaceFromPixels(image, decoded, options, 'Unable to create image surface for DIB payload')
}

function resolveMetafileSourceBounds(header, fallbackWidth, fallbackHeight) {
  const bounds = header?.bounds
  const width = bounds ? bounds.right - bounds.left : fallbackWidth
  const height = bounds ? bounds.bottom - bounds.top : fallbackHeight

  if (width > 0 && height > 0) {
    return {
      x: bounds?.left ?? 0,
      y: bounds?.top ?? 0,
      width,
      height
    }
  }

  if (fallbackWidth > 0 && fallbackHeight > 0) {
    return {
      x: 0,
      y: 0,
      width: fallbackWidth,
      height: fallbackHeight
    }
  }

  return null
}

function isMetafileImage(image) {
  return image?.format === 'wmf' || image?.format === 'emf'
}

function normalizeRequestedMetafileSize(width, height) {
  if (!(width > 0) || !(height > 0)) {
    return {
      width: 1,
      height: 1
    }
  }

  let scale = 1

  if (Math.max(width, height) > MAX_METAFILE_SURFACE_DIMENSION) {
    scale = Math.min(scale, MAX_METAFILE_SURFACE_DIMENSION / Math.max(width, height))
  }

  if (width * height > MAX_METAFILE_SURFACE_PIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_METAFILE_SURFACE_PIXELS / (width * height)))
  }

  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale))
  }
}

function safeParseMetafile(parse, buffer) {
  // Never let a malformed or empty embedded payload turn an unparseable nested
  // metafile into a hard out-of-bounds throw; surface it as a clean diagnostic.
  if (typeof parse !== 'function' || !buffer || buffer.byteLength < 4) {
    return null
  }

  try {
    return parse(buffer)
  } catch {
    return null
  }
}

function resolveMetafilePlayback(parsed, image, options = {}) {
  if (image.format === 'wmf') {
    const resolvedParsed = parsed ?? safeParseMetafile(options.parseWmf, image.buffer)

    if (!resolvedParsed || typeof options.playWmf !== 'function') {
      addWarning(options, 'Unable to parse nested WMF image surface')
      return null
    }

    return {
      parsed: resolvedParsed,
      play(backend, playbackOptions) {
        return options.playWmf(resolvedParsed, backend, playbackOptions)
      }
    }
  }

  const resolvedParsed = parsed ?? safeParseMetafile(options.parseEmf, image.buffer)

  if (!resolvedParsed || typeof options.playEmf !== 'function') {
    addWarning(options, 'Unable to parse nested EMF image surface')
    return null
  }

  return {
    parsed: resolvedParsed,
    play(backend, playbackOptions) {
      return options.playEmf(resolvedParsed, backend, playbackOptions)
    }
  }
}

function resolveMetafileRenderSize(image, parsed, hint = null) {
  const sourceBounds = image.sourceBounds ?? resolveMetafileSourceBounds(parsed?.header, 0, 0)
  const defaultWidth = sourceBounds?.width ?? image.width ?? 1
  const defaultHeight = sourceBounds?.height ?? image.height ?? 1

  if (!hint || !(hint.displayedWidth > 0) || !(hint.displayedHeight > 0)) {
    return normalizeRequestedMetafileSize(defaultWidth, defaultHeight)
  }

  const normalizedSourceRect = normalizeRect(
    hint.sourceRect ?? {
      x: sourceBounds?.x ?? 0,
      y: sourceBounds?.y ?? 0,
      width: defaultWidth,
      height: defaultHeight
    }
  )
  const scaleX =
    sourceBounds?.width > 0 && normalizedSourceRect.width > 0 ? sourceBounds.width / normalizedSourceRect.width : 1
  const scaleY =
    sourceBounds?.height > 0 && normalizedSourceRect.height > 0 ? sourceBounds.height / normalizedSourceRect.height : 1

  return normalizeRequestedMetafileSize(hint.displayedWidth * scaleX, hint.displayedHeight * scaleY)
}

function shouldReuseMetafileSurface(image, renderSize) {
  const surface = image.canvas ?? image.element

  if (!surface || !renderSize) {
    return false
  }

  return (surface.width ?? 0) >= renderSize.width && (surface.height ?? 0) >= renderSize.height
}

function summarizeNestedPlayback(nestedPlayback) {
  const warningCount = nestedPlayback?.warnings?.length ?? 0
  const unsupportedCount = nestedPlayback?.unsupported?.length ?? 0
  const diagnosticCodes = {}

  for (const diagnostic of nestedPlayback?.diagnostics ?? []) {
    diagnosticCodes[diagnostic.code] = (diagnosticCodes[diagnostic.code] ?? 0) + 1
  }

  const diagnosticCount = Object.values(diagnosticCodes).reduce((total, count) => total + count, 0)

  if (warningCount === 0 && unsupportedCount === 0 && diagnosticCount === 0) {
    return null
  }

  const parts = []

  if (warningCount > 0) {
    parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`)
  }

  if (unsupportedCount > 0) {
    parts.push(`${unsupportedCount} unsupported record${unsupportedCount === 1 ? '' : 's'}`)
  }

  if (diagnosticCount > 0) {
    parts.push(`${diagnosticCount} diagnostic${diagnosticCount === 1 ? '' : 's'}`)
  }

  return {
    warningCount,
    unsupportedCount,
    diagnosticCodes,
    warnings: nestedPlayback?.warnings?.slice(0, 3) ?? [],
    unsupported: nestedPlayback?.unsupported?.slice(0, 3) ?? [],
    reason: parts.join(', ')
  }
}

export function ensureImageSurface(image, options = {}, hint = null) {
  if (!image) {
    return image
  }

  if (!isMetafileImage(image) && (image.canvas || image.element)) {
    return image
  }

  if (image.format === 'dib') {
    return renderDibSurface(image, options)
  }

  if (image.format === 'bitmap') {
    return renderBitmapSurface(image, options)
  }

  if (!image.buffer) {
    addWarning(options, 'Unable to prepare backend for nested metafile image surface')
    return image
  }

  const playback = resolveMetafilePlayback(image.parsedMetafile ?? null, image, options)

  if (!playback) {
    return image
  }

  image.parsedMetafile = playback.parsed
  const sourceBounds = resolveMetafileSourceBounds(playback.parsed?.header, image.width ?? 0, image.height ?? 0)

  if (sourceBounds) {
    image.sourceBounds = sourceBounds
  }

  const renderSize = resolveMetafileRenderSize(image, playback.parsed, hint)

  if (shouldReuseMetafileSurface(image, renderSize)) {
    image.width = image.canvas?.width ?? image.width
    image.height = image.canvas?.height ?? image.height
    return image
  }

  const createSurface = options.createSurface ?? (() => null)
  const createBackend = options.createBackend ?? (() => null)
  const surface = createSurface(renderSize.width, renderSize.height)

  if (!surface) {
    markSurfaceFailure(image, options, 'Unable to create image surface for nested metafile', {
      code: 'nested-metafile-surface-unavailable',
      capability: 'nested-metafile-surface'
    })
    return image
  }

  const backend = createBackend(surface)

  if (!backend || !image.buffer) {
    markSurfaceFailure(image, options, 'Unable to prepare backend for nested metafile image surface', {
      code: 'nested-metafile-backend-unavailable',
      capability: 'nested-metafile-surface'
    })
    return image
  }

  try {
    const nestedPlayback = playback.play(backend, renderSize)

    image.canvas = surface
    image.width = surface.width
    image.height = surface.height
    delete image.surfaceFailure

    const nestedSummary = summarizeNestedPlayback(nestedPlayback)

    image.surfaceIncomplete = Boolean(nestedSummary)
    image.surfaceDiagnostics = nestedSummary

    if (nestedSummary) {
      addWarning(
        options,
        `Nested ${image.format === 'wmf' ? 'WMF' : 'EMF'} image surface replay reported ${nestedSummary.reason}`,
        {
          code: 'nested-metafile-surface-incomplete',
          capability: 'nested-metafile-surface',
          reason: nestedSummary.reason
        }
      )
    }
  } catch (error) {
    markSurfaceFailure(
      image,
      options,
      `Failed to render nested ${image.format === 'wmf' ? 'WMF' : 'EMF'} image surface: ${error.message}`,
      {
        code: 'nested-metafile-surface-render-failed',
        capability: 'nested-metafile-surface',
        reason: error.message
      }
    )
    return image
  }

  return image
}

function createDibImage(view, recordStart, bmiOffset, bmiSize, bitsOffset, bitsSize, usage, options = {}) {
  const bmiBytes = readAbsoluteBytes(view, recordStart + bmiOffset, bmiSize, {
    ...options,
    label: `${options.recordName ?? 'Raster payload'} bmi`,
    rangeStart: recordStart,
    rangeEnd: options.recordEnd
  })
  const bitsBytes = readAbsoluteBytes(view, recordStart + bitsOffset, bitsSize, {
    ...options,
    label: `${options.recordName ?? 'Raster payload'} bits`,
    rangeStart: recordStart,
    rangeEnd: options.recordEnd
  })

  if (!bmiBytes || !bitsBytes) {
    return null
  }

  const metadata = readDibMetadata({ bmiBytes, bitsBytes }, options)

  if (!metadata) {
    return null
  }

  return {
    kind: 'image',
    format: 'dib',
    usage,
    width: metadata.width,
    height: metadata.height,
    sourceAlpha: options.sourceAlpha === true,
    bmiBytes,
    bitsBytes
  }
}

function readRectangle(view, offset) {
  return {
    x: view.getInt32(offset, true),
    y: view.getInt32(offset + 4, true),
    width: view.getInt32(offset + 8, true),
    height: view.getInt32(offset + 12, true)
  }
}

function readUint32IfAvailable(view, record, relativeOffset, fallback = 0) {
  const absoluteOffset = record.dataOffset + relativeOffset
  const recordEnd = resolveRecordEnd(record)

  if (absoluteOffset + 4 > view.byteLength || absoluteOffset + 4 > recordEnd) {
    return fallback
  }

  return view.getUint32(absoluteOffset, true)
}

function hasDibPayload(bmiSize, bitsSize) {
  return bmiSize > 0 && bitsSize > 0
}

function addMissingSourcePayloadWarning(options, recordName) {
  addWarning(options, `${recordName} depends on a source DC but does not include a DIB payload`)
}

function readDibPayloadImage(view, recordStart, recordEnd, recordName, usage, bmiOffset, bmiSize, bitsOffset, bitsSize, options) {
  if (!hasDibPayload(bmiSize, bitsSize)) {
    addMissingSourcePayloadWarning(options, recordName)
    return null
  }

  return createDibImage(view, recordStart, bmiOffset, bmiSize, bitsOffset, bitsSize, usage, {
    ...options,
    recordName,
    recordEnd
  })
}

function readBlendFunction(value) {
  return {
    operation: value & 0xff,
    flags: (value >>> 8) & 0xff,
    sourceConstantAlpha: (value >>> 16) & 0xff,
    alphaFormat: (value >>> 24) & 0xff
  }
}

function readAlphaBlendOptions(view, record) {
  const blendFunctionValue = view.getUint32(record.dataOffset + 64, true)
  const blendFunction = readBlendFunction(blendFunctionValue)

  return {
    blendFunction,
    sourceConstantAlpha: blendFunction.sourceConstantAlpha / 255,
    sourceAlpha: (blendFunction.alphaFormat & AC_SRC_ALPHA) !== 0,
    unsupportedBlendFunction:
      blendFunction.operation !== AC_SRC_OVER || blendFunction.flags !== 0
  }
}

function readTransparentColorRef(value) {
  return {
    red: value & 0xff,
    green: (value >>> 8) & 0xff,
    blue: (value >>> 16) & 0xff
  }
}

function readStretchSourceOperation(parsed, record, layout, options = {}) {
  const recordStart = resolveRecordStart(record)
  const recordEnd = resolveRecordEnd(record)
  const { view } = parsed
  const recordName = getRasterRecordName(record)

  if (!ensureRecordDataLength(view, record, layout.requiredDataSize, { ...options, recordName })) {
    return null
  }

  const bmiOffset = view.getUint32(record.dataOffset + layout.bmiOffset, true)
  const bmiSize = view.getUint32(record.dataOffset + layout.bmiSize, true)
  const bitsOffset = view.getUint32(record.dataOffset + layout.bitsOffset, true)
  const bitsSize = view.getUint32(record.dataOffset + layout.bitsSize, true)
  const usage = view.getUint32(record.dataOffset + layout.usage, true)
  const extra = layout.extra ? layout.extra(view, record) : {}
  const image = readDibPayloadImage(
    view,
    recordStart,
    recordEnd,
    recordName,
    usage,
    bmiOffset,
    bmiSize,
    bitsOffset,
    bitsSize,
    {
      ...options,
      sourceAlpha: extra.sourceAlpha === true
    }
  )

  if (!image) {
    return null
  }

  return {
    kind: 'image',
    rasterOp: layout.rasterOp === null ? SRCCOPY : view.getUint32(record.dataOffset + layout.rasterOp, true),
    usage,
    destinationRect: normalizeRect({
      x: view.getInt32(record.dataOffset + 16, true),
      y: view.getInt32(record.dataOffset + 20, true),
      width: view.getInt32(record.dataOffset + layout.destinationWidth, true),
      height: view.getInt32(record.dataOffset + layout.destinationHeight, true)
    }),
    sourceRect: normalizeRect({
      x: view.getInt32(record.dataOffset + 24, true),
      y: view.getInt32(record.dataOffset + 28, true),
      width: view.getInt32(record.dataOffset + 32, true),
      height: view.getInt32(record.dataOffset + 36, true)
    }),
    image,
    ...extra
  }
}

export function readClassicRasterOperation(parsed, record, options = {}) {
  const recordStart = resolveRecordStart(record)
  const recordEnd = resolveRecordEnd(record)
  const { view } = parsed
  const recordName = getRasterRecordName(record)

  if (record.type === EMR_STRETCHDIBITS) {
    return readStretchSourceOperation(parsed, record, {
      requiredDataSize: 72,
      bmiOffset: 40,
      bmiSize: 44,
      bitsOffset: 48,
      bitsSize: 52,
      usage: 56,
      rasterOp: 60,
      destinationWidth: 64,
      destinationHeight: 68
    }, options)
  }

  if (record.type === EMR_STRETCHBLT) {
    return readStretchSourceOperation(parsed, record, {
      requiredDataSize: 100,
      bmiOffset: 84,
      bmiSize: 88,
      bitsOffset: 92,
      bitsSize: 96,
      usage: 80,
      rasterOp: 76,
      destinationWidth: 44,
      destinationHeight: 48
    }, options)
  }

  if (record.type === EMR_ALPHABLEND) {
    return readStretchSourceOperation(parsed, record, {
      requiredDataSize: 108,
      bmiOffset: 92,
      bmiSize: 96,
      bitsOffset: 100,
      bitsSize: 104,
      usage: 88,
      rasterOp: null,
      destinationWidth: 44,
      destinationHeight: 48,
      extra: readAlphaBlendOptions
    }, options)
  }

  if (record.type === EMR_TRANSPARENTBLT) {
    return readStretchSourceOperation(parsed, record, {
      requiredDataSize: 108,
      bmiOffset: 92,
      bmiSize: 96,
      bitsOffset: 100,
      bitsSize: 104,
      usage: 88,
      rasterOp: null,
      destinationWidth: 44,
      destinationHeight: 48,
      extra(view, record) {
        return {
          transparentColor: readTransparentColorRef(view.getUint32(record.dataOffset + 80, true))
        }
      }
    }, options)
  }

  if (record.type === EMR_SETDIBITSTODEVICE) {
    if (!ensureRecordDataLength(view, record, 72, { ...options, recordName })) {
      return null
    }

    const bmiOffset = view.getUint32(record.dataOffset + 40, true)
    const bmiSize = view.getUint32(record.dataOffset + 44, true)
    const bitsOffset = view.getUint32(record.dataOffset + 48, true)
    const bitsSize = view.getUint32(record.dataOffset + 52, true)
    const usage = view.getUint32(record.dataOffset + 56, true)
    const image = readDibPayloadImage(
      view,
      recordStart,
      recordEnd,
      recordName,
      usage,
      bmiOffset,
      bmiSize,
      bitsOffset,
      bitsSize,
      options
    )

    if (!image) {
      return null
    }

    const width = view.getInt32(record.dataOffset + 32, true)
    const height = view.getInt32(record.dataOffset + 36, true)

    return {
      kind: 'image',
      rasterOp: SRCCOPY,
      usage,
      destinationRect: normalizeRect({
        x: view.getInt32(record.dataOffset + 16, true),
        y: view.getInt32(record.dataOffset + 20, true),
        width,
        height
      }),
      sourceRect: normalizeRect({
        x: view.getInt32(record.dataOffset + 24, true),
        y: view.getInt32(record.dataOffset + 28, true),
        width,
        height
      }),
      startScan: view.getUint32(record.dataOffset + 60, true),
      scanLines: view.getUint32(record.dataOffset + 64, true),
      colorMode: readUint32IfAvailable(view, record, 68, 0),
      image
    }
  }

  if (record.type === EMR_BITBLT) {
    if (!ensureRecordDataLength(view, record, 92, { ...options, recordName })) {
      return null
    }

    const rasterOp = view.getUint32(record.dataOffset + 32, true)
    const destinationRect = normalizeRect(readRectangle(view, record.dataOffset + 16))
    const sourceRect = {
      x: view.getInt32(record.dataOffset + 36, true),
      y: view.getInt32(record.dataOffset + 40, true),
      width: destinationRect.width,
      height: destinationRect.height
    }
    const bmiOffset = view.getUint32(record.dataOffset + 76, true)
    const bmiSize = view.getUint32(record.dataOffset + 80, true)
    const bitsOffset = view.getUint32(record.dataOffset + 84, true)
    const bitsSize = view.getUint32(record.dataOffset + 88, true)
    const usage = view.getUint32(record.dataOffset + 72, true)

    if (bmiSize === 0 || bitsSize === 0) {
      if (rasterOp === BLACKNESS) {
        return {
          kind: 'solid',
          color: 'rgb(0, 0, 0)',
          destinationRect
        }
      }

      if (rasterOp === WHITENESS) {
        return {
          kind: 'solid',
          color: 'rgb(255, 255, 255)',
          destinationRect
        }
      }

      if (rasterOp === NOP) {
        return {
          kind: 'noop',
          destinationRect
        }
      }

      addMissingSourcePayloadWarning(options, recordName)
      return null
    }

    const image = createDibImage(view, recordStart, bmiOffset, bmiSize, bitsOffset, bitsSize, usage, {
      ...options,
      recordName,
      recordEnd
    })

    if (!image) {
      return null
    }

    return {
      kind: 'image',
      rasterOp,
      usage,
      destinationRect,
      sourceRect,
      image
    }
  }

  return null
}
