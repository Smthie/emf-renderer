// Zero-dependency decoders for the primitive value types shared across the EMF /
// EMF+ / WMF code paths — the EMF+ object decoders, the runtime dispatchers, the
// WMF playback, and the image-surface helpers (RectF/PointF/Matrix, ARGB and
// COLORREF colors, rect normalization, and the 7/15-bit packed integers used by
// compressed paths). Keeping them in one dependency-free module avoids the
// byte-for-byte copies that had drifted across these files (a real risk: the
// three clonePoint copies and the packed-integer pair diverged) and prevents the
// import cycle that would arise from hosting them in runtime/dispatch/shared.js
// (which already imports object-decoders/region.js).

export function decodeArgb(value) {
  const alpha = (value >>> 24) & 0xff
  const red = (value >>> 16) & 0xff
  const green = (value >>> 8) & 0xff
  const blue = value & 0xff

  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
}

// Win32 COLORREF (0x00BBGGRR little-endian DWORD); the high alpha/flags byte is
// ignored. Used by classic EMF and WMF color records.
export function readColorRef(value) {
  const red = value & 0xff
  const green = (value >> 8) & 0xff
  const blue = (value >> 16) & 0xff

  return `rgb(${red}, ${green}, ${blue})`
}

// Normalize a {x, y, width, height} rect so width/height are non-negative,
// relocating the origin to the min corner when a dimension is negative.
export function normalizeRect(rect) {
  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  }
}

export function readPointF(view, offset) {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true)
  }
}

export function readPointFArray(view, offset, count) {
  const points = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    points.push(readPointF(view, cursor))
    cursor += 8
  }

  return points
}

export function readRectF(view, offset) {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    width: view.getFloat32(offset + 8, true),
    height: view.getFloat32(offset + 12, true)
  }
}

export function readMatrix(view, offset) {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true),
    view.getFloat32(offset + 16, true),
    view.getFloat32(offset + 20, true)
  ]
}

export function signExtend(value, bits) {
  const shift = 32 - bits
  return (value << shift) >> shift
}

export function readPackedInteger(view, offset) {
  const firstByte = view.getUint8(offset)

  if ((firstByte & 0x80) === 0) {
    return {
      value: signExtend(firstByte & 0x7f, 7),
      size: 1
    }
  }

  return {
    value: signExtend(view.getUint16(offset, true) & 0x7fff, 15),
    size: 2
  }
}
