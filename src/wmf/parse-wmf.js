import { PLACEABLE_WMF_KEY, META_EOF } from './constants.js'

function toArrayBuffer(buffer) {
  if (buffer instanceof Uint8Array) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  if (buffer instanceof ArrayBuffer) {
    return buffer
  }

  throw new TypeError('parseWmf expects an ArrayBuffer or Uint8Array')
}

function resolveStandardHeaderOffset(view) {
  const candidates = [0, 22, 24]

  for (const offset of candidates) {
    if (offset + 18 > view.byteLength) {
      continue
    }

    const headerSizeWords = view.getUint16(offset + 2, true)
    const version = view.getUint16(offset + 4, true)
    const sizeWords = view.getUint32(offset + 6, true)

    if (headerSizeWords >= 9 && sizeWords > 0 && (version === 0x0100 || version === 0x0300)) {
      return offset
    }
  }

  throw new Error('Invalid WMF header')
}

export function parseWmf(buffer) {
  const source = toArrayBuffer(buffer)
  const view = new DataView(source)
  const hasPlaceableHeader = view.byteLength >= 4 && view.getUint32(0, true) === PLACEABLE_WMF_KEY
  const standardHeaderOffset = resolveStandardHeaderOffset(view)
  const headerSizeWords = view.getUint16(standardHeaderOffset + 2, true)
  const recordsOffset = standardHeaderOffset + headerSizeWords * 2
  const records = []
  const warnings = []

  let offset = recordsOffset

  while (offset + 6 <= view.byteLength) {
    const sizeWords = view.getUint32(offset, true)
    const sizeBytes = sizeWords * 2
    const type = view.getUint16(offset + 4, true)

    if (sizeWords < 3 || offset + sizeBytes > view.byteLength) {
      warnings.push('Ignored trailing truncated WMF record')
      break
    }

    const params = []

    for (let cursor = offset + 6; cursor + 1 < offset + sizeBytes; cursor += 2) {
      params.push(view.getInt16(cursor, true))
    }

    records.push({
      type,
      sizeWords,
      sizeBytes,
      offset,
      dataOffset: offset + 6,
      dataSize: sizeBytes - 6,
      params
    })

    offset += sizeBytes

    if (type === META_EOF) {
      break
    }
  }

  const bounds = hasPlaceableHeader
    ? {
        left: view.getInt16(6, true),
        top: view.getInt16(8, true),
        right: view.getInt16(10, true),
        bottom: view.getInt16(12, true)
      }
    : { left: 0, top: 0, right: 0, bottom: 0 }

  return {
    view,
    header: {
      bounds,
      inch: hasPlaceableHeader ? view.getUint16(14, true) : 0,
      hasPlaceableHeader,
      standardHeaderOffset,
      type: view.getUint16(standardHeaderOffset, true),
      headerSizeWords,
      version: view.getUint16(standardHeaderOffset + 4, true),
      sizeWords: view.getUint32(standardHeaderOffset + 6, true),
      objectCount: view.getUint16(standardHeaderOffset + 10, true),
      maxRecordSize: view.getUint32(standardHeaderOffset + 12, true),
      parameterCount: view.getUint16(standardHeaderOffset + 16, true)
    },
    records,
    warnings
  }
}
