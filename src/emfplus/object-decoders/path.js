import { createEmfPlusPathGeometry } from '../../runtime/path-builder.js'
import { readPackedInteger, signExtend } from '../primitives.js'

const PATH_POINT_COUNT_OFFSET = 4
const PATH_FLAGS_OFFSET = 8
const PATH_POINTS_OFFSET = 12
const PATH_POINT_FLAG_RELATIVE = 0x0800
const PATH_POINT_FLAG_COMPRESSED = 0x4000
const PATH_POINT_SIZE = 8
const PATH_COMPRESSED_POINT_SIZE = 4

function readRelativePoints(view, offset, count) {
  const points = []
  let cursor = offset
  let currentX = 0
  let currentY = 0

  for (let index = 0; index < count; index += 1) {
    const deltaX = readPackedInteger(view, cursor)
    cursor += deltaX.size
    const deltaY = readPackedInteger(view, cursor)
    cursor += deltaY.size
    currentX += deltaX.value
    currentY += deltaY.value
    points.push({
      x: currentX,
      y: currentY
    })
  }

  return {
    cursor,
    points
  }
}

function readCompressedPoints(view, offset, count) {
  const points = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    points.push({
      x: view.getInt16(cursor, true),
      y: view.getInt16(cursor + 2, true)
    })
    cursor += PATH_COMPRESSED_POINT_SIZE
  }

  return {
    cursor,
    points
  }
}

function readFloatPoints(view, offset, count) {
  const points = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    points.push({
      x: view.getFloat32(cursor, true),
      y: view.getFloat32(cursor + 4, true)
    })
    cursor += PATH_POINT_SIZE
  }

  return {
    cursor,
    points
  }
}

function readPathPoints(view, offset, count, flags) {
  if ((flags & PATH_POINT_FLAG_RELATIVE) !== 0) {
    return readRelativePoints(view, offset, count)
  }

  if ((flags & PATH_POINT_FLAG_COMPRESSED) !== 0) {
    return readCompressedPoints(view, offset, count)
  }

  return readFloatPoints(view, offset, count)
}

export function decodePathObject(view, offset, dataSize = Number.POSITIVE_INFINITY) {
  const count = view.getUint32(offset + PATH_POINT_COUNT_OFFSET, true)
  const flags = view.getUint32(offset + PATH_FLAGS_OFFSET, true)
  const { points, cursor } = readPathPoints(view, offset + PATH_POINTS_OFFSET, count, flags)
  const availablePointTypeBytes = Math.max(0, Math.min(count, (offset + dataSize) - cursor))
  const pointTypes = Array.from(new Uint8Array(view.buffer, view.byteOffset + cursor, availablePointTypeBytes))

  return {
    kind: 'path',
    flags,
    figures: createEmfPlusPathGeometry(points, pointTypes).figures
  }
}
