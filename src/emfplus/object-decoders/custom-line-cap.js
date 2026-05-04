import { decodePathObject } from './path.js'
import { readPointF } from '../primitives.js'

const CUSTOM_LINE_CAP_TYPE_DEFAULT = 0
const CUSTOM_LINE_CAP_TYPE_ADJUSTABLE_ARROW = 1
const CUSTOM_LINE_CAP_DATA_FILL_PATH = 0x00000001
const CUSTOM_LINE_CAP_DATA_LINE_PATH = 0x00000002
const CUSTOM_LINE_CAP_HEADER_SIZE = 8
const CUSTOM_LINE_CAP_ARROW_DATA_SIZE = 52
const CUSTOM_LINE_CAP_DEFAULT_DATA_SIZE = 48

function decodeAdjustableArrowCustomLineCap(view, offset) {
  return {
    kind: 'customLineCap',
    type: 'adjustableArrow',
    width: view.getFloat32(offset, true),
    height: view.getFloat32(offset + 4, true),
    middleInset: view.getFloat32(offset + 8, true),
    fillState: view.getInt32(offset + 12, true) !== 0,
    lineStartCap: view.getUint32(offset + 16, true),
    lineEndCap: view.getUint32(offset + 20, true),
    lineJoin: view.getUint32(offset + 24, true),
    lineMiterLimit: view.getFloat32(offset + 28, true),
    widthScale: view.getFloat32(offset + 32, true)
  }
}

function readOptionalPath(view, offset, end) {
  if (offset + 4 > end) {
    return {
      path: null,
      cursor: offset,
      unsupported: 'custom-line-cap-default-path-truncated'
    }
  }

  const pathSize = view.getInt32(offset, true)
  const pathOffset = offset + 4
  const cursor = Math.min(end, pathOffset + Math.max(0, pathSize))

  if (pathSize < 12 || pathOffset + pathSize > end) {
    return {
      path: null,
      cursor,
      unsupported: 'custom-line-cap-default-path-truncated'
    }
  }

  return {
    path: decodePathObject(view, pathOffset, pathSize),
    cursor
  }
}

function decodeDefaultCustomLineCap(view, offset, availableSize) {
  const end = offset + availableSize
  const customLineCapDataFlags = view.getUint32(offset, true)
  const cap = {
    kind: 'customLineCap',
    type: 'default',
    customLineCapDataFlags,
    baseCap: view.getUint32(offset + 4, true),
    baseInset: view.getFloat32(offset + 8, true),
    strokeStartCap: view.getUint32(offset + 12, true),
    strokeEndCap: view.getUint32(offset + 16, true),
    strokeJoin: view.getUint32(offset + 20, true),
    strokeMiterLimit: view.getFloat32(offset + 24, true),
    widthScale: view.getFloat32(offset + 28, true),
    fillHotSpot: readPointF(view, offset + 32),
    lineHotSpot: readPointF(view, offset + 40)
  }
  let cursor = offset + CUSTOM_LINE_CAP_DEFAULT_DATA_SIZE

  if ((customLineCapDataFlags & CUSTOM_LINE_CAP_DATA_FILL_PATH) !== 0) {
    const result = readOptionalPath(view, cursor, end)
    cursor = result.cursor

    if (result.path) {
      cap.fillPath = result.path
    } else if (result.unsupported) {
      cap.unsupported = result.unsupported
    }
  }

  if ((customLineCapDataFlags & CUSTOM_LINE_CAP_DATA_LINE_PATH) !== 0) {
    const result = readOptionalPath(view, cursor, end)
    cursor = result.cursor

    if (result.path) {
      cap.linePath = result.path
    } else if (result.unsupported) {
      cap.unsupported = result.unsupported
    }
  }

  return cap
}

export function decodeCustomLineCapObject(view, offset, dataSize = Number.POSITIVE_INFINITY) {
  const end = offset + Math.max(0, dataSize)

  if (end - offset < CUSTOM_LINE_CAP_HEADER_SIZE) {
    return {
      kind: 'customLineCap',
      type: 'unknown'
    }
  }

  const customLineCapType = view.getUint32(offset + 4, true)
  const dataOffset = offset + CUSTOM_LINE_CAP_HEADER_SIZE
  const availableSize = end - dataOffset

  if (customLineCapType === CUSTOM_LINE_CAP_TYPE_ADJUSTABLE_ARROW) {
    if (availableSize < CUSTOM_LINE_CAP_ARROW_DATA_SIZE) {
      return {
        kind: 'customLineCap',
        type: 'adjustableArrow',
        unsupported: 'custom-line-cap-truncated'
      }
    }

    return decodeAdjustableArrowCustomLineCap(view, dataOffset)
  }

  if (customLineCapType === CUSTOM_LINE_CAP_TYPE_DEFAULT) {
    if (availableSize < CUSTOM_LINE_CAP_DEFAULT_DATA_SIZE) {
      return {
        kind: 'customLineCap',
        type: 'default',
        unsupported: 'custom-line-cap-truncated'
      }
    }

    return decodeDefaultCustomLineCap(view, dataOffset, availableSize)
  }

  return {
    kind: 'customLineCap',
    type: 'unknown',
    customLineCapType
  }
}
