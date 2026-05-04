const EMFPLUS_IMAGE_TYPE_BITMAP = 1
const EMFPLUS_IMAGE_TYPE_METAFILE = 2
const EMFPLUS_BITMAP_DATA_TYPE_PIXEL = 0
const EMFPLUS_BITMAP_DATA_TYPE_COMPRESSED = 1
const EMFPLUS_PIXEL_FORMAT_INDEXED = 0x00010000

function readArgbColor(value) {
  return {
    red: (value >>> 16) & 0xff,
    green: (value >>> 8) & 0xff,
    blue: value & 0xff,
    alpha: (value >>> 24) & 0xff
  }
}

function detectCompressedBitmapFormat(bytes) {
  if (bytes.byteLength >= 8) {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

    if (pngSignature.every((value, index) => bytes[index] === value)) {
      return 'png'
    }
  }

  if (bytes.byteLength >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp'
  }

  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }

  if (bytes.byteLength >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6))

    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'gif'
    }
  }

  return 'unknown'
}

function decodeIndexedBitmapPayload(bytes) {
  if (bytes.byteLength < 8) {
    return {
      palette: null,
      bytes: new Uint8Array(0),
      buffer: new ArrayBuffer(0)
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint32(0, true)
  const count = view.getUint32(4, true)
  const paletteByteLength = 8 + count * 4

  if (count <= 0 || paletteByteLength > bytes.byteLength) {
    return {
      palette: null,
      bytes: new Uint8Array(0),
      buffer: new ArrayBuffer(0)
    }
  }

  const entries = []

  for (let index = 0; index < count; index += 1) {
    entries.push(readArgbColor(view.getUint32(8 + index * 4, true)))
  }

  const pixelBytes = bytes.subarray(paletteByteLength).slice()

  return {
    palette: {
      flags,
      entries
    },
    bytes: pixelBytes,
    buffer: pixelBytes.buffer.slice(pixelBytes.byteOffset, pixelBytes.byteOffset + pixelBytes.byteLength)
  }
}

export function decodeImageObject(view, offset, dataSize) {
  const imageType = view.getUint32(offset + 4, true)

  if (imageType === EMFPLUS_IMAGE_TYPE_BITMAP) {
    const width = view.getUint32(offset + 8, true)
    const height = view.getUint32(offset + 12, true)
    const stride = view.getInt32(offset + 16, true)
    const pixelFormat = view.getUint32(offset + 20, true)
    const bitmapDataType = view.getUint32(offset + 24, true)
    const payloadOffset = offset + 28
    const payloadLength = Math.max(0, dataSize - 28)
    const bytes = new Uint8Array(view.buffer, view.byteOffset + payloadOffset, payloadLength).slice()
    const compression =
      bitmapDataType === EMFPLUS_BITMAP_DATA_TYPE_COMPRESSED
        ? detectCompressedBitmapFormat(bytes)
        : null
    const indexedPayload =
      bitmapDataType === EMFPLUS_BITMAP_DATA_TYPE_PIXEL && (pixelFormat & EMFPLUS_PIXEL_FORMAT_INDEXED) !== 0
        ? decodeIndexedBitmapPayload(bytes)
        : null
    const pixelBytes = indexedPayload?.bytes ?? bytes
    const pixelBuffer = indexedPayload?.buffer ?? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    return {
      kind: 'image',
      format: 'bitmap',
      imageType,
      width,
      height,
      stride,
      pixelFormat,
      bitmapDataType,
      compression,
      compressedBytes:
        compression === 'jpeg' || compression === 'gif' || compression === 'bmp'
          ? bytes
          : null,
      palette: indexedPayload?.palette ?? null,
      rawBytes: indexedPayload ? bytes : null,
      bytes: pixelBytes,
      buffer: pixelBuffer
    }
  }

  if (imageType === EMFPLUS_IMAGE_TYPE_METAFILE) {
    const imageDataType = view.getUint32(offset + 8, true)
    const imageDataSize = view.getUint32(offset + 12, true)
    const payloadOffset = offset + 16
    const payloadLength = Math.min(imageDataSize, dataSize - 16)
    const bytes = new Uint8Array(view.buffer, view.byteOffset + payloadOffset, payloadLength).slice()
    const format =
      bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x9ac6cdd7
        ? 'wmf'
        : 'emf'

    return {
      kind: 'image',
      format,
      imageType,
      imageDataType,
      bytes,
      buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
  }

  return {
    kind: 'image',
    format: 'unknown',
    imageType,
    bytes: new Uint8Array(0),
    buffer: new ArrayBuffer(0)
  }
}
