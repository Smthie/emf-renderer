import { decodeBrushObject } from './brush.js'
import { decodeCustomLineCapObject } from './custom-line-cap.js'
import { readMatrix } from '../primitives.js'

const PEN_DATA_TRANSFORM = 0x00000001
const PEN_DATA_START_CAP = 0x00000002
const PEN_DATA_END_CAP = 0x00000004
const PEN_DATA_JOIN = 0x00000008
const PEN_DATA_MITER_LIMIT = 0x00000010
const PEN_DATA_LINE_STYLE = 0x00000020
const PEN_DATA_DASHED_LINE_CAP = 0x00000040
const PEN_DATA_DASH_OFFSET = 0x00000080
const PEN_DATA_DASHED_LINE = 0x00000100
const PEN_DATA_NON_CENTER = 0x00000200
const PEN_DATA_COMPOUND_LINE = 0x00000400
const PEN_DATA_CUSTOM_START_CAP = 0x00000800
const PEN_DATA_CUSTOM_END_CAP = 0x00001000

function decodeLineCap(value) {
  return (
    {
      0: 'butt',
      1: 'square',
      2: 'round',
      3: 'square'
    }[value] || 'butt'
  )
}

function decodeLineJoin(value) {
  return (
    {
      0: 'miter',
      1: 'bevel',
      2: 'round',
      3: 'miterClipped'
    }[value] || 'miter'
  )
}

function decodeDashStyle(value) {
  return (
    {
      0: 'solid',
      1: 'dash',
      2: 'dot',
      3: 'dashDot',
      4: 'dashDotDot',
      5: 'custom'
    }[value] || 'solid'
  )
}

function decodeDashCap(value) {
  return (
    {
      0: 'butt',
      1: 'square',
      2: 'round',
      3: 'triangle'
    }[value] || 'butt'
  )
}

function readFloatArray(view, offset, count) {
  const values = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    values.push(view.getFloat32(cursor, true))
    cursor += 4
  }

  return values
}

function readCustomLineCap(view, offset, end) {
  if (offset + 4 > end) {
    return {
      cap: null,
      cursor: offset
    }
  }

  const dataSize = view.getUint32(offset, true)
  const dataOffset = offset + 4
  const nextCursor = Math.min(end, dataOffset + Math.max(0, dataSize))

  if (dataSize <= 0 || dataOffset + dataSize > end) {
    return {
      cap: null,
      cursor: nextCursor
    }
  }

  return {
    cap: decodeCustomLineCapObject(view, dataOffset, dataSize),
    cursor: nextCursor
  }
}

export function decodePenObject(view, offset, dataSize) {
  if (dataSize < 20) {
    return {
      kind: 'pen',
      width: 1,
      color: 'rgba(0, 0, 0, 1)'
    }
  }

  const penDataFlags = view.getUint32(offset + 8, true)
  const unit = view.getUint32(offset + 12, true)
  const width = view.getFloat32(offset + 16, true)
  const pen = {
    kind: 'pen',
    unit,
    width: Number.isFinite(width) && width > 0 ? width : 1
  }
  const end = offset + dataSize
  let cursor = offset + 20

  if ((penDataFlags & PEN_DATA_TRANSFORM) !== 0 && cursor + 24 <= end) {
    pen.transform = readMatrix(view, cursor)
    cursor += 24
  }

  if ((penDataFlags & PEN_DATA_START_CAP) !== 0 && cursor + 4 <= end) {
    pen.startCap = decodeLineCap(view.getUint32(cursor, true))
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_END_CAP) !== 0 && cursor + 4 <= end) {
    pen.endCap = decodeLineCap(view.getUint32(cursor, true))
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_JOIN) !== 0 && cursor + 4 <= end) {
    pen.lineJoin = decodeLineJoin(view.getUint32(cursor, true))
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_MITER_LIMIT) !== 0 && cursor + 4 <= end) {
    pen.miterLimit = view.getFloat32(cursor, true)
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_LINE_STYLE) !== 0 && cursor + 4 <= end) {
    pen.dashStyle = decodeDashStyle(view.getUint32(cursor, true))
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_DASHED_LINE_CAP) !== 0 && cursor + 4 <= end) {
    pen.dashCap = decodeDashCap(view.getUint32(cursor, true))
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_DASH_OFFSET) !== 0 && cursor + 4 <= end) {
    pen.dashOffset = view.getFloat32(cursor, true)
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_DASHED_LINE) !== 0 && cursor + 4 <= end) {
    const count = view.getUint32(cursor, true)
    cursor += 4

    if (count > 0 && cursor + count * 4 <= end) {
      pen.dashPattern = readFloatArray(view, cursor, count)
      pen.dashPatternUnit = 'penWidth'
      cursor += count * 4
    }
  }

  if ((penDataFlags & PEN_DATA_NON_CENTER) !== 0 && cursor + 4 <= end) {
    pen.alignment = view.getUint32(cursor, true)
    cursor += 4
  }

  if ((penDataFlags & PEN_DATA_COMPOUND_LINE) !== 0 && cursor + 4 <= end) {
    const count = view.getUint32(cursor, true)
    cursor += 4

    if (count > 0 && cursor + count * 4 <= end) {
      pen.compoundArray = readFloatArray(view, cursor, count)
      cursor += count * 4
    }
  }

  if ((penDataFlags & PEN_DATA_CUSTOM_START_CAP) !== 0) {
    const result = readCustomLineCap(view, cursor, end)
    cursor = result.cursor

    if (result.cap) {
      pen.customStartCap = result.cap
    }
  }

  if ((penDataFlags & PEN_DATA_CUSTOM_END_CAP) !== 0) {
    const result = readCustomLineCap(view, cursor, end)
    cursor = result.cursor

    if (result.cap) {
      pen.customEndCap = result.cap
    }
  }

  if (cursor + 12 <= end) {
    pen.brush = decodeBrushObject(view, cursor, end - cursor)
  }

  if (pen.brush?.color) {
    pen.color = pen.brush.color
  }

  if (!pen.color) {
    pen.color = 'rgba(0, 0, 0, 1)'
  }

  if (!pen.lineCap && pen.endCap) {
    pen.lineCap = pen.endCap
  } else if (!pen.lineCap && pen.startCap) {
    pen.lineCap = pen.startCap
  }

  return pen
}
