import { decodeEmfPlusObject, decodeEmfPlusSerializableObject } from '../../emfplus/object-decoders/index.js'
import { decodeArgb, normalizeRect, readPackedInteger, readPointFArray, readRectF, signExtend } from '../../emfplus/primitives.js'
import {
  EMFPLUS_COMPRESSED,
  EMFPLUS_DRIVER_STRING_CMAP_LOOKUP,
  EMFPLUS_DRIVER_STRING_REALIZED_ADVANCE,
  EMFPLUS_DRIVER_STRING_VERTICAL,
  EMFPLUS_IMAGE_EFFECT,
  EMFPLUS_INLINE_COLOR,
  EMFPLUS_MATRIX_POSTMULTIPLY,
  EMFPLUS_RELATIVE_POSITION,
  EMFPLUS_WINDING_FILL,
  EmfPlusRecordType
} from './constants.js'
import { multiplyMatrices } from '../matrix.js'
import { createAngleArcPathGeometry, createClosedCardinalSplineGeometry, createOpenCardinalSplineGeometry, createPathGeometry } from '../path-builder.js'
import { combineRegions, rectToRegionGeometry } from '../region-ops.js'
import {
  readMatrix,
  readPointSArrayAt,
  addWarning,
  resolveBackendImageSource,
  toRectL,
  createBezierPathGeometry,
  addUnknownObjectWarnings,
  readUtf16String,
  getClipUniverseGeometry,
  resolveRegionGeometry,
  applyClipOperation,
  resetClip,
  offsetClip,
  reportRecordDowngrade,
  DOWNGRADE_OBJECT_UNRESOLVED,
  DOWNGRADE_RECORD_DECODE_FAILED,
  DOWNGRADE_DEGENERATE_GEOMETRY,
  DOWNGRADE_CAPABILITY_UNAVAILABLE
} from './shared.js'

// EMF+ drawing arms that cannot produce output degrade to a diagnostic and
// return true, never `return false` (which the dispatcher counts as
// unsupported). They also re-arm the block's classic fallback exactly as the
// prior `return false` did — playback flips allowClassicDrawingRecords when an
// EMF+ block needs fallback, so dual EMF+/classic files keep falling back to
// their classic representation. See the return contract note in shared.js.
function downgradeEmfPlusRecord(runtime, code, message, details = {}) {
  runtime.currentEmfPlusBlockNeedsFallback = true
  return reportRecordDowngrade(runtime, code, message, details)
}

// Invoke a backend draw method when callable, otherwise degrade with a
// capability diagnostic (and re-arm classic fallback). The draw thunk only runs
// when the method exists, so a missing method never throws.
function drawEmfPlusOrDowngrade(runtime, backend, method, label, draw) {
  if (typeof backend?.[method] === 'function') {
    draw()
    return true
  }

  return downgradeEmfPlusRecord(
    runtime,
    DOWNGRADE_CAPABILITY_UNAVAILABLE,
    `${label} skipped because backend.${method} is unavailable`,
    { capability: method }
  )
}

function readPointRArray(view, offset, count) {
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

  return points
}

function readRectFArray(view, offset, count) {
  const rects = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    rects.push({
      x: view.getFloat32(cursor, true),
      y: view.getFloat32(cursor + 4, true),
      width: view.getFloat32(cursor + 8, true),
      height: view.getFloat32(cursor + 12, true)
    })
    cursor += 16
  }

  return rects
}

function readRectSArrayAt(view, offset, count) {
  const rects = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    rects.push({
      x: view.getInt16(cursor, true),
      y: view.getInt16(cursor + 2, true),
      width: view.getInt16(cursor + 4, true),
      height: view.getInt16(cursor + 6, true)
    })
    cursor += 8
  }

  return rects
}

function readRectS(view, offset) {
  return {
    x: view.getInt16(offset, true),
    y: view.getInt16(offset + 2, true),
    width: view.getInt16(offset + 4, true),
    height: view.getInt16(offset + 6, true)
  }
}

function readEmfPlusPointArray(view, offset, count, flags) {
  if ((flags & EMFPLUS_RELATIVE_POSITION) !== 0) {
    return readPointRArray(view, offset, count)
  }

  if ((flags & EMFPLUS_COMPRESSED) !== 0) {
    return readPointSArrayAt(view, offset, count)
  }

  return readPointFArray(view, offset, count)
}

function readEmfPlusRect(view, offset, flags) {
  if ((flags & EMFPLUS_COMPRESSED) !== 0) {
    return readRectS(view, offset)
  }

  return readRectF(view, offset)
}

function resolveEmfPlusPointStride(flags) {
  if ((flags & EMFPLUS_RELATIVE_POSITION) !== 0) {
    return null
  }

  return (flags & EMFPLUS_COMPRESSED) !== 0 ? 4 : 8
}

function createTranslationMatrix(dx, dy) {
  return [1, 0, 0, 1, dx, dy]
}

function createScaleMatrix(scaleX, scaleY) {
  return [scaleX, 0, 0, scaleY, 0, 0]
}

function createRotationMatrix(angleDegrees) {
  const angle = (angleDegrees * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)

  return [cosine, sine, -sine, cosine, 0, 0]
}

function readEmfPlusFillMode(flags) {
  return (flags & EMFPLUS_WINDING_FILL) !== 0 ? 'winding' : 'alternate'
}

function readCombineMode(flags) {
  const code = (flags >> 8) & 0x0f

  return (
    {
      1: 'replace',
      2: 'intersect',
      3: 'union',
      4: 'xor',
      5: 'exclude',
      6: 'complement'
    }[code] || 'replace'
  )
}

function isValidEmfPlusCurveRange(count, offset, numberOfSegments) {
  return (
    Number.isInteger(count) &&
    Number.isInteger(offset) &&
    Number.isInteger(numberOfSegments) &&
    count >= 2 &&
    offset >= 0 &&
    numberOfSegments >= 1 &&
    offset + numberOfSegments < count
  )
}

function readEmfPlusDrawCurveData(view, record) {
  if (record.dataSize < 16) {
    return null
  }

  const curve = {
    tension: view.getFloat32(record.dataOffset, true),
    offset: view.getUint32(record.dataOffset + 4, true),
    numberOfSegments: view.getUint32(record.dataOffset + 8, true),
    count: view.getUint32(record.dataOffset + 12, true)
  }
  const pointStride = resolveEmfPlusPointStride(record.flags)
  const pointDataOffset = record.dataOffset + 16
  const fixedPointBytes = pointStride === null ? null : record.dataSize - 16

  if (!isValidEmfPlusCurveRange(curve.count, curve.offset, curve.numberOfSegments)) {
    return null
  }

  if (fixedPointBytes !== null && curve.count * pointStride !== fixedPointBytes) {
    return null
  }

  return {
    ...curve,
    points: readEmfPlusPointArray(view, pointDataOffset, curve.count, record.flags)
  }
}


function attachEmfPlusPenWarnings(runtime, pen, objectId = undefined, record = null) {
  if (!pen || typeof pen !== 'object') {
    return pen
  }

  const addPenWarning = (message, details = {}) => {
    addWarning(runtime, message, {
      ...details,
      ...(record?.source !== undefined ? { source: record.source } : {}),
      ...(record?.type !== undefined ? { recordType: record.type } : {}),
      ...(record?.offset !== undefined
        ? { recordOffset: record.offset }
        : record?.dataOffset !== undefined
          ? { recordOffset: record.dataOffset - 12 }
          : {}),
      ...(objectId !== undefined ? { objectId } : {})
    })
  }

  Object.defineProperty(pen, 'addWarning', {
    configurable: true,
    value: addPenWarning
  })

  return pen
}

function resolveEmfPlusPen(runtime, objectId, record) {
  return attachEmfPlusPenWarnings(runtime, runtime.objects.get(objectId), objectId, record)
}

function resolveImageSourceRect(image, sourceRect, srcUnit, source) {
  const normalizedRect = normalizeRect(sourceRect)
  const sourceWidth = source?.width ?? image?.width ?? 0
  const sourceHeight = source?.height ?? image?.height ?? 0

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return normalizedRect
  }

  if (image?.format === 'bitmap' || image?.format === 'dib') {
    if (srcUnit !== 2) {
      return normalizedRect
    }

    return {
      x: normalizedRect.x + 0.5,
      y: normalizedRect.y + 0.5,
      width: normalizedRect.width,
      height: normalizedRect.height
    }
  }

  const sourceBounds = image?.sourceBounds

  if (!sourceBounds || sourceBounds.width <= 0 || sourceBounds.height <= 0) {
    return normalizedRect
  }

  return {
    x: ((normalizedRect.x - sourceBounds.x) * sourceWidth) / sourceBounds.width,
    y: ((normalizedRect.y - sourceBounds.y) * sourceHeight) / sourceBounds.height,
    width: (normalizedRect.width * sourceWidth) / sourceBounds.width,
    height: (normalizedRect.height * sourceHeight) / sourceBounds.height
  }
}

function transformPoint(matrix, point) {
  const [a, b, c, d, e, f] = matrix

  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f
  }
}

function resolveMetafileSurfaceHint(runtime, image, points, sourceRect) {
  if (!image || (image.format !== 'emf' && image.format !== 'wmf') || !Array.isArray(points) || points.length < 3) {
    return null
  }

  const matrix = runtime.transform?.getEffectiveTransform?.()

  if (!Array.isArray(matrix) || matrix.length !== 6) {
    return null
  }

  const transformedOrigin = transformPoint(matrix, points[0])
  const transformedXAxis = transformPoint(matrix, points[1])
  const transformedYAxis = transformPoint(matrix, points[2])
  const displayedWidth = Math.hypot(
    transformedXAxis.x - transformedOrigin.x,
    transformedXAxis.y - transformedOrigin.y
  )
  const displayedHeight = Math.hypot(
    transformedYAxis.x - transformedOrigin.x,
    transformedYAxis.y - transformedOrigin.y
  )

  if (!(displayedWidth > 0) || !(displayedHeight > 0)) {
    return null
  }

  return {
    displayedWidth,
    displayedHeight,
    sourceRect: normalizeRect(sourceRect)
  }
}

function resolveMetafileRectSurfaceHint(runtime, image, destinationRect, sourceRect) {
  if (!image || (image.format !== 'emf' && image.format !== 'wmf')) {
    return null
  }

  return resolveMetafileSurfaceHint(
    runtime,
    image,
    [
      { x: destinationRect.x, y: destinationRect.y },
      { x: destinationRect.x + destinationRect.width, y: destinationRect.y },
      { x: destinationRect.x, y: destinationRect.y + destinationRect.height }
    ],
    sourceRect
  )
}

function getEmfPlusObjectId(record) {
  return record.flags & 0xff
}

// EMF+ Object records whose serialized object is larger than a single record
// set this flag and are split across several records that share an ObjectId.
// Each continued record's data is [TotalObjectSize: UINT32][chunk]; the chunks
// concatenate into the full object once their combined length reaches the total.
const EMFPLUS_OBJECT_CONTINUATION = 0x8000

function accumulateContinuedEmfPlusObject(runtime, objectId, parsed, record) {
  const totalSize = parsed.view.getUint32(record.dataOffset, true)
  const chunk = new Uint8Array(
    parsed.view.buffer,
    parsed.view.byteOffset + record.dataOffset + 4,
    Math.max(0, record.dataSize - 4)
  ).slice()

  const pending = runtime.pendingEmfPlusObjects ?? (runtime.pendingEmfPlusObjects = new Map())
  let entry = pending.get(objectId)

  if (!entry || entry.totalSize !== totalSize) {
    entry = { totalSize, received: 0, chunks: [] }
    pending.set(objectId, entry)
  }

  entry.chunks.push(chunk)
  entry.received += chunk.byteLength

  if (entry.received < totalSize) {
    return null
  }

  pending.delete(objectId)

  const assembled = new Uint8Array(entry.received)
  let offset = 0
  for (const part of entry.chunks) {
    assembled.set(part, offset)
    offset += part.byteLength
  }

  return {
    record: { ...record, dataOffset: 0, dataSize: totalSize },
    parsed: { view: new DataView(assembled.buffer, 0, assembled.byteLength) }
  }
}

function resolveInlineEmfPlusBrush(parsed, record) {
  return {
    kind: 'brush',
    type: 'solid',
    color: decodeArgb(parsed.view.getUint32(record.dataOffset, true))
  }
}

function realizeEmfPlusBrush(runtime, brush) {
  if (!brush || brush.kind !== 'brush') {
    return brush
  }

  if (brush.type === 'texture' && brush.image && brush.image.format !== 'unknown') {
    const image = runtime.ensureImageSurface?.(brush.image) ?? brush.image

    if (image !== brush.image) {
      return {
        ...brush,
        image
      }
    }
  }

  return brush
}

function realizeEmfPlusObject(runtime, object) {
  if (!object || typeof object !== 'object') {
    return object
  }

  if (object.kind === 'brush') {
    return realizeEmfPlusBrush(runtime, object)
  }

  if (object.kind === 'pen' && object.brush) {
    const brush = realizeEmfPlusBrush(runtime, object.brush)

    if (brush !== object.brush) {
      return {
        ...object,
        brush,
        color: brush.color ?? object.color
      }
    }
  }

  return object
}

function resolveEmfPlusBrushAt(parsed, runtime, record, offset = 0) {
  if ((record.flags & EMFPLUS_INLINE_COLOR) !== 0) {
    return resolveInlineEmfPlusBrush(parsed, record)
  }

  return realizeEmfPlusBrush(runtime, runtime.objects.get(parsed.view.getUint32(record.dataOffset + offset, true)))
}

function resolveEmfPlusImageAttributesAt(parsed, runtime, record, offset = 0) {
  const objectId = parsed.view.getUint32(record.dataOffset + offset, true)

  if (objectId === 0) {
    return null
  }

  return runtime.objects.get(objectId) ?? null
}

function readEmfPlusDriverString(record, parsed) {
  if ((record.dataSize ?? 0) < 16) {
    return null
  }

  const view = parsed.view
  const options = view.getUint32(record.dataOffset + 4, true)
  const matrixPresent = view.getUint32(record.dataOffset + 8, true) !== 0
  const glyphCount = view.getUint32(record.dataOffset + 12, true)
  const glyphByteLength = glyphCount * 2
  const pointCount = (options & EMFPLUS_DRIVER_STRING_REALIZED_ADVANCE) !== 0 ? 1 : glyphCount
  const pointByteLength = pointCount * 8
  const minimumDataSize = 16 + glyphByteLength + pointByteLength + (matrixPresent ? 24 : 0)

  if ((record.dataSize ?? 0) < minimumDataSize) {
    return null
  }

  const glyphOffset = record.dataOffset + 16
  const glyphs = []

  for (let index = 0; index < glyphCount; index += 1) {
    glyphs.push(view.getUint16(glyphOffset + index * 2, true))
  }

  const positionsOffset = glyphOffset + glyphByteLength
  const positions = readPointFArray(view, positionsOffset, pointCount)
  const transform = matrixPresent ? readMatrix(view, positionsOffset + pointByteLength) : null

  return {
    glyphs,
    positions,
    text: String.fromCharCode(...glyphs),
    transform,
    options: {
      cmapLookup: (options & EMFPLUS_DRIVER_STRING_CMAP_LOOKUP) !== 0,
      vertical: (options & EMFPLUS_DRIVER_STRING_VERTICAL) !== 0,
      realizedAdvance: (options & EMFPLUS_DRIVER_STRING_REALIZED_ADVANCE) !== 0,
      glyphSource:
        (options & EMFPLUS_DRIVER_STRING_CMAP_LOOKUP) !== 0 ? 'unicode' : 'glyphIndex'
    }
  }
}

function applyEmfPlusTsGraphics(record, parsed, runtime) {
  if ((record.dataSize ?? 0) < 36) {
    return false
  }

  const view = parsed.view
  const offset = record.dataOffset

  runtime.state.setSmoothingMode(view.getUint8(offset))
  runtime.state.setTextRenderingHint(view.getUint8(offset + 1))
  runtime.state.setCompositingMode(view.getUint8(offset + 2) === 1 ? 'sourceCopy' : 'sourceOver')
  runtime.state.setCompositingQuality(view.getUint8(offset + 3))
  runtime.state.setRenderingOrigin({
    x: view.getInt16(offset + 4, true),
    y: view.getInt16(offset + 6, true)
  })
  runtime.state.setTextContrast(view.getUint16(offset + 8, true))
  runtime.state.setInterpolationMode(view.getUint8(offset + 10))
  runtime.state.setPixelOffsetMode(view.getUint8(offset + 11))
  runtime.state.setWorldTransform(readMatrix(view, offset + 12))
  runtime.applyTransform?.()
  return true
}

function readEmfPlusTsClipValue(view, offset, compressed) {
  if (compressed) {
    const encoded = view.getUint8(offset)

    if ((encoded & 0x80) === 0) {
      return null
    }

    return {
      value: signExtend(encoded & 0x7f, 7),
      size: 1
    }
  }

  const high = view.getUint8(offset)

  if ((high & 0x80) !== 0) {
    return null
  }

  return {
    value: signExtend(((high & 0x7f) << 8) | view.getUint8(offset + 1), 15),
    size: 2
  }
}

function readEmfPlusTsClipRects(record, parsed) {
  const compressed = (record.flags & 0x8000) !== 0
  const rectCount = record.flags & 0x7fff
  const rects = []
  let cursor = record.dataOffset
  let previousLeft = 0
  let previousTop = 0
  let previousRight = 0

  for (let index = 0; index < rectCount; index += 1) {
    const bytesPerRect = compressed ? 4 : 8

    if (cursor + bytesPerRect > record.dataOffset + record.dataSize) {
      break
    }

    const leftDelta = readEmfPlusTsClipValue(parsed.view, cursor, compressed)
    const topDelta = readEmfPlusTsClipValue(parsed.view, cursor + leftDelta?.size, compressed)
    const rightDelta = readEmfPlusTsClipValue(
      parsed.view,
      cursor + (leftDelta?.size ?? 0) + (topDelta?.size ?? 0),
      compressed
    )
    const bottomDelta = readEmfPlusTsClipValue(
      parsed.view,
      cursor + (leftDelta?.size ?? 0) + (topDelta?.size ?? 0) + (rightDelta?.size ?? 0),
      compressed
    )

    if (!leftDelta || !topDelta || !rightDelta || !bottomDelta) {
      break
    }

    const left = previousLeft + leftDelta.value
    const top = previousTop + topDelta.value
    const right = previousRight + rightDelta.value
    const bottom = top + bottomDelta.value

    rects.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    })
    previousLeft = left
    previousTop = top
    previousRight = right
    cursor += bytesPerRect
  }

  return rects
}

function applyEmfPlusTsClip(record, parsed, runtime, backend) {
  const rects = readEmfPlusTsClipRects(record, parsed)

  if (rects.length === 0) {
    return resetClip(runtime, backend)
  }

  let geometry = []

  for (const rect of rects) {
    geometry = combineRegions(geometry, rectToRegionGeometry(rect), 'union', getClipUniverseGeometry(runtime))
  }

  const region = {
    kind: 'region',
    type: 'tsClip',
    geometry
  }

  return applyClipOperation(runtime, backend, { kind: 'region', region }, 'replace')
}

function multiplyEmfPlusWorldTransform(runtime, matrix, flags) {
  const current = runtime.state.current.worldTransform
  // GDI+ matrix order: Append (PostMultiply) applies the new matrix to points
  // LAST -> multiplyMatrices(matrix, current); Prepend (the default) applies it
  // FIRST -> multiplyMatrices(current, matrix). With column-vector
  // multiplyMatrices(L, R) = L∘R (R applied first). Mirrors the classic
  // MODIFYWORLDTRANSFORM contract.
  const combined =
    (flags & EMFPLUS_MATRIX_POSTMULTIPLY) !== 0
      ? multiplyMatrices(matrix, current)
      : multiplyMatrices(current, matrix)

  runtime.state.setWorldTransform(combined)
  runtime.applyTransform?.()
  return true
}

export function handleEmfPlusRecord(parsed, runtime, backend, record) {
  if (
    record.type === EmfPlusRecordType.Header ||
    record.type === EmfPlusRecordType.EndOfFile
  ) {
    return true
  }

  if (record.type === EmfPlusRecordType.GetDC) {
    runtime.allowClassicDrawingRecords = true
    return true
  }

  if (
    record.type === EmfPlusRecordType.Comment ||
    record.type === EmfPlusRecordType.MultiFormatStart ||
    record.type === EmfPlusRecordType.MultiFormatSection ||
    record.type === EmfPlusRecordType.MultiFormatEnd
  ) {
    return true
  }

  if (record.type === EmfPlusRecordType.Save) {
    const token = parsed.view.getUint32(record.dataOffset, true)
    return runtime.pushStateFrame?.('emfplus', token) ?? false
  }

  if (record.type === EmfPlusRecordType.Restore) {
    const token = parsed.view.getUint32(record.dataOffset, true)

    if (runtime.restoreStateFrameByToken?.('emfplus', token)) {
      return true
    }

    // GDI+ fails GdipRestoreGraphics for an unknown state token and leaves the
    // graphics unchanged; mirror that no-op but surface it as a diagnostic.
    // No classic-fallback re-arm: nothing was drawn or lost here.
    return reportRecordDowngrade(
      runtime,
      'restore-dc-unmatched',
      `EmfPlusRestore ${token} has no matching Save frame; graphics state left unchanged`
    )
  }

  if (record.type === EmfPlusRecordType.BeginContainer || record.type === EmfPlusRecordType.BeginContainerNoParams) {
    const token = parsed.view.getUint32(record.dataOffset, true)
    return runtime.pushStateFrame?.('emfplus-container', token) ?? false
  }

  if (record.type === EmfPlusRecordType.EndContainer) {
    const token = parsed.view.getUint32(record.dataOffset, true)

    if (runtime.restoreStateFrameByToken?.('emfplus-container', token)) {
      return true
    }

    return reportRecordDowngrade(
      runtime,
      'restore-dc-unmatched',
      `EmfPlusEndContainer ${token} has no matching BeginContainer frame; graphics state left unchanged`
    )
  }

  if (record.type === EmfPlusRecordType.SetWorldTransform) {
    runtime.state.setWorldTransform(readMatrix(parsed.view, record.dataOffset))
    runtime.applyTransform?.()
    return true
  }

  if (record.type === EmfPlusRecordType.MultiplyWorldTransform) {
    return multiplyEmfPlusWorldTransform(runtime, readMatrix(parsed.view, record.dataOffset), record.flags)
  }

  if (record.type === EmfPlusRecordType.ResetWorldTransform) {
    runtime.state.resetWorldTransform()
    runtime.applyTransform?.()
    return true
  }

  if (record.type === EmfPlusRecordType.TranslateWorldTransform) {
    return multiplyEmfPlusWorldTransform(
      runtime,
      createTranslationMatrix(
        parsed.view.getFloat32(record.dataOffset, true),
        parsed.view.getFloat32(record.dataOffset + 4, true)
      ),
      record.flags
    )
  }

  if (record.type === EmfPlusRecordType.ScaleWorldTransform) {
    return multiplyEmfPlusWorldTransform(
      runtime,
      createScaleMatrix(
        parsed.view.getFloat32(record.dataOffset, true),
        parsed.view.getFloat32(record.dataOffset + 4, true)
      ),
      record.flags
    )
  }

  if (record.type === EmfPlusRecordType.RotateWorldTransform) {
    return multiplyEmfPlusWorldTransform(
      runtime,
      createRotationMatrix(parsed.view.getFloat32(record.dataOffset, true)),
      record.flags
    )
  }

  if (record.type === EmfPlusRecordType.SetPageTransform) {
    // Some producers (e.g. LibreOffice) emit a 12-byte SetPageTransform with no
    // PageScale payload (dataSize 0). Reading a float there grabs the next
    // record's header bytes, yielding a denormal near-zero scale that collapses
    // the device transform and blanks the whole page. Default a missing or
    // non-finite/zero scale to identity (1), matching GDI+'s tolerance.
    const rawScale = record.dataSize >= 4 ? parsed.view.getFloat32(record.dataOffset, true) : 1
    const pageScale = Number.isFinite(rawScale) && rawScale !== 0 ? rawScale : 1
    runtime.state.setPageTransform(record.flags & 0xff, pageScale)
    runtime.applyTransform?.()
    return true
  }

  if (record.type === EmfPlusRecordType.Clear) {
    backend.clear?.({ color: decodeArgb(parsed.view.getUint32(record.dataOffset, true)) })
    return true
  }

  if (record.type === EmfPlusRecordType.SetClipRect) {
    const rect = readRectF(parsed.view, record.dataOffset)
    const mode = readCombineMode(record.flags)

    return applyClipOperation(runtime, backend, { kind: 'rect', rect }, mode)
  }

  if (record.type === EmfPlusRecordType.SetClipRegion) {
    const region = runtime.objects.get(getEmfPlusObjectId(record))
    const mode = readCombineMode(record.flags)

    return applyClipOperation(runtime, backend, { kind: 'region', region }, mode)
  }

  if (record.type === EmfPlusRecordType.SetClipPath) {
    const path = runtime.objects.get(getEmfPlusObjectId(record))
    const mode = readCombineMode(record.flags)

    return applyClipOperation(runtime, backend, { kind: 'path', path }, mode)
  }

  if (record.type === EmfPlusRecordType.ResetClip) {
    return resetClip(runtime, backend)
  }

  if (record.type === EmfPlusRecordType.SetAntiAliasMode) {
    runtime.state.setSmoothingMode(record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetInterpolationMode) {
    runtime.state.setInterpolationMode(record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetPixelOffsetMode) {
    runtime.state.setPixelOffsetMode(record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetTextRenderingHint) {
    runtime.state.setTextRenderingHint(record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetTextContrast) {
    runtime.state.setTextContrast(record.dataSize >= 2 ? parsed.view.getUint16(record.dataOffset, true) : record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetCompositingMode) {
    runtime.state.setCompositingMode((record.flags & 0xff) === 1 ? 'sourceCopy' : 'sourceOver')
    return true
  }

  if (record.type === EmfPlusRecordType.SetCompositingQuality) {
    runtime.state.setCompositingQuality(record.flags)
    return true
  }

  if (record.type === EmfPlusRecordType.SetTSGraphics) {
    if (applyEmfPlusTsGraphics(record, parsed, runtime)) {
      return true
    }

    return downgradeEmfPlusRecord(
      runtime,
      DOWNGRADE_RECORD_DECODE_FAILED,
      'EMF+ SetTSGraphics skipped because its graphics-state payload is too short'
    )
  }

  if (record.type === EmfPlusRecordType.SetTSClip) {
    return applyEmfPlusTsClip(record, parsed, runtime, backend)
  }

  if (record.type === EmfPlusRecordType.SerializableObject) {
    const object = decodeEmfPlusSerializableObject(record, parsed)

    addUnknownObjectWarnings(runtime, object)
    runtime.currentEmfPlusEffect = object
    return true
  }

  if (record.type === EmfPlusRecordType.Object) {
    const objectId = getEmfPlusObjectId(record)

    if ((record.flags & EMFPLUS_OBJECT_CONTINUATION) !== 0) {
      const assembled = accumulateContinuedEmfPlusObject(runtime, objectId, parsed, record)

      if (!assembled) {
        return true
      }

      const continuedObject = realizeEmfPlusObject(runtime, decodeEmfPlusObject(assembled.record, assembled.parsed))

      if (continuedObject) {
        addUnknownObjectWarnings(runtime, continuedObject)
        runtime.objects.set(objectId, continuedObject)
      }

      return true
    }

    const object = realizeEmfPlusObject(runtime, record.prefetchedObject ?? decodeEmfPlusObject(record, parsed))

    if (object) {
      addUnknownObjectWarnings(runtime, object)
      runtime.objects.set(objectId, object)
      return true
    }

    return downgradeEmfPlusRecord(
      runtime,
      DOWNGRADE_RECORD_DECODE_FAILED,
      'EMF+ Object skipped because its serialized object could not be decoded',
      { objectId }
    )
  }

  if (record.type === EmfPlusRecordType.FillRects) {
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const count = parsed.view.getUint32(record.dataOffset + 4, true)
    const rects =
      (record.flags & EMFPLUS_COMPRESSED) !== 0
        ? readRectSArrayAt(parsed.view, record.dataOffset + 8, count)
        : readRectFArray(parsed.view, record.dataOffset + 8, count)

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillRects skipped because its brush could not be resolved'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillRect', 'EMF+ FillRects', () => {
      for (const rect of rects) {
        backend.fillRect(toRectL(rect), brush)
      }
    })
  }

  if (record.type === EmfPlusRecordType.DrawLines) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const count = parsed.view.getUint32(record.dataOffset, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 4, count, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawLines skipped because its pen could not be resolved',
        { objectId }
      )
    }

    if (points.length < 2) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ DrawLines skipped because it has fewer than 2 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawLines', () => {
      backend.strokePath(createPathGeometry(points), pen)
    })
  }

  if (record.type === EmfPlusRecordType.DrawRects) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const count = parsed.view.getUint32(record.dataOffset, true)
    const rects =
      (record.flags & EMFPLUS_COMPRESSED) !== 0
        ? readRectSArrayAt(parsed.view, record.dataOffset + 4, count)
        : readRectFArray(parsed.view, record.dataOffset + 4, count)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawRects skipped because its pen could not be resolved',
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokeRect', 'EMF+ DrawRects', () => {
      for (const rect of rects) {
        backend.strokeRect(toRectL(rect), pen)
      }
    })
  }

  if (record.type === EmfPlusRecordType.FillPolygon) {
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const count = parsed.view.getUint32(record.dataOffset + 4, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 8, count, record.flags)

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillPolygon skipped because its brush could not be resolved'
      )
    }

    if (points.length < 3) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ FillPolygon skipped because it has fewer than 3 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillPath', 'EMF+ FillPolygon', () => {
      backend.fillPath(createPathGeometry(points, { closed: true }), brush, { fillMode: 'alternate' })
    })
  }

  if (record.type === EmfPlusRecordType.DrawBeziers) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const count = parsed.view.getUint32(record.dataOffset, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 4, count, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawBeziers skipped because its pen could not be resolved',
        { objectId }
      )
    }

    if (points.length < 4) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ DrawBeziers skipped because it has fewer than 4 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawBeziers', () => {
      backend.strokePath(createBezierPathGeometry(points[0], points.slice(1)), pen)
    })
  }

  if (record.type === EmfPlusRecordType.FillEllipse) {
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const rect = readEmfPlusRect(parsed.view, record.dataOffset + 4, record.flags)

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillEllipse skipped because its brush could not be resolved'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillEllipse', 'EMF+ FillEllipse', () => {
      backend.fillEllipse(toRectL(rect), brush)
    })
  }

  if (record.type === EmfPlusRecordType.DrawEllipse) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const rect = readEmfPlusRect(parsed.view, record.dataOffset, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawEllipse skipped because its pen could not be resolved',
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokeEllipse', 'EMF+ DrawEllipse', () => {
      backend.strokeEllipse(toRectL(rect), pen)
    })
  }

  if (record.type === EmfPlusRecordType.DrawArc) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const startAngle = parsed.view.getFloat32(record.dataOffset, true)
    const sweepAngle = parsed.view.getFloat32(record.dataOffset + 4, true)
    const rect = readEmfPlusRect(parsed.view, record.dataOffset + 8, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawArc skipped because its pen could not be resolved',
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawArc', () => {
      backend.strokePath(createAngleArcPathGeometry(rect, startAngle, sweepAngle), pen)
    })
  }

  if (record.type === EmfPlusRecordType.FillRegion) {
    const objectId = getEmfPlusObjectId(record)
    const region = runtime.objects.get(objectId)
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const geometry = resolveRegionGeometry(runtime, region)
    const resolvedGeometry = geometry === null ? getClipUniverseGeometry(runtime) : geometry

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillRegion skipped because its brush could not be resolved'
      )
    }

    if (resolvedGeometry === undefined) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillRegion skipped because its region could not be resolved',
        { objectId }
      )
    }

    if (typeof backend.fillGeometry === 'function') {
      backend.fillGeometry(resolvedGeometry, brush, { fillMode: 'alternate' })
      return true
    }

    // Backends without fillGeometry can still honor a plain rectangular region.
    if (region?.type === 'rect') {
      return drawEmfPlusOrDowngrade(runtime, backend, 'fillRect', 'EMF+ FillRegion', () => {
        backend.fillRect(toRectL(region.rect), brush)
      })
    }

    return downgradeEmfPlusRecord(
      runtime,
      DOWNGRADE_CAPABILITY_UNAVAILABLE,
      'EMF+ FillRegion skipped because backend.fillGeometry is unavailable',
      { capability: 'fillGeometry' }
    )
  }

  if (record.type === EmfPlusRecordType.FillClosedCurve) {
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const tension = parsed.view.getFloat32(record.dataOffset + 4, true)
    const count = parsed.view.getUint32(record.dataOffset + 8, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 12, count, record.flags)

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillClosedCurve skipped because its brush could not be resolved'
      )
    }

    if (points.length < 3) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ FillClosedCurve skipped because it has fewer than 3 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillPath', 'EMF+ FillClosedCurve', () => {
      backend.fillPath(createClosedCardinalSplineGeometry(points, tension), brush, {
        fillMode: readEmfPlusFillMode(record.flags)
      })
    })
  }

  if (record.type === EmfPlusRecordType.DrawPie) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const startAngle = parsed.view.getFloat32(record.dataOffset, true)
    const sweepAngle = parsed.view.getFloat32(record.dataOffset + 4, true)
    const rect = readEmfPlusRect(parsed.view, record.dataOffset + 8, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawPie skipped because its pen could not be resolved',
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawPie', () => {
      backend.strokePath(createAngleArcPathGeometry(rect, startAngle, sweepAngle, { pie: true }), pen)
    })
  }

  if (record.type === EmfPlusRecordType.FillPie) {
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const startAngle = parsed.view.getFloat32(record.dataOffset + 4, true)
    const sweepAngle = parsed.view.getFloat32(record.dataOffset + 8, true)
    const rect = readEmfPlusRect(parsed.view, record.dataOffset + 12, record.flags)

    if (!brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ FillPie skipped because its brush could not be resolved'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillPath', 'EMF+ FillPie', () => {
      backend.fillPath(createAngleArcPathGeometry(rect, startAngle, sweepAngle, { pie: true }), brush, {
        fillMode: 'alternate'
      })
    })
  }

  if (record.type === EmfPlusRecordType.DrawClosedCurve) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const tension = parsed.view.getFloat32(record.dataOffset, true)
    const count = parsed.view.getUint32(record.dataOffset + 4, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 8, count, record.flags)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawClosedCurve skipped because its pen could not be resolved',
        { objectId }
      )
    }

    if (points.length < 3) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ DrawClosedCurve skipped because it has fewer than 3 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawClosedCurve', () => {
      backend.strokePath(createClosedCardinalSplineGeometry(points, tension), pen)
    })
  }

  if (record.type === EmfPlusRecordType.DrawCurve) {
    const objectId = getEmfPlusObjectId(record)
    const pen = resolveEmfPlusPen(runtime, objectId, record)
    const curve = readEmfPlusDrawCurveData(parsed.view, record)

    if (!pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ DrawCurve skipped because its pen could not be resolved',
        { objectId }
      )
    }

    if (!curve) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_RECORD_DECODE_FAILED,
        'EMF+ DrawCurve skipped because its curve payload could not be decoded'
      )
    }

    if (curve.points.length < 2) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_DEGENERATE_GEOMETRY,
        'EMF+ DrawCurve skipped because it has fewer than 2 points'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawCurve', () => {
      backend.strokePath(
        createOpenCardinalSplineGeometry(
          curve.points,
          curve.tension,
          curve.offset,
          curve.numberOfSegments
        ),
        pen
      )
    })
  }

  if (record.type === EmfPlusRecordType.FillPath) {
    const objectId = getEmfPlusObjectId(record)
    const path = runtime.objects.get(objectId)
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)

    if (!path || !brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        `EMF+ FillPath skipped because its ${!path ? 'path' : 'brush'} could not be resolved`,
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'fillPath', 'EMF+ FillPath', () => {
      backend.fillPath(path, brush)
    })
  }

  if (record.type === EmfPlusRecordType.DrawPath) {
    const objectId = getEmfPlusObjectId(record)
    const path = runtime.objects.get(objectId)
    const penId = parsed.view.getUint32(record.dataOffset, true)
    const pen = resolveEmfPlusPen(runtime, penId, record)

    if (!path || !pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        `EMF+ DrawPath skipped because its ${!path ? 'path' : 'pen'} could not be resolved`,
        { objectId: !path ? objectId : penId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ DrawPath', () => {
      backend.strokePath(path, pen)
    })
  }

  if (record.type === EmfPlusRecordType.StrokeFillPath) {
    const objectId = getEmfPlusObjectId(record)
    const path = runtime.objects.get(objectId)
    const brush = runtime.getCurrentClassicBrush?.() ?? null
    const pen = runtime.getCurrentClassicStroke?.() ?? null

    if (!path) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ StrokeFillPath skipped because its path could not be resolved',
        { objectId }
      )
    }

    if (!brush && !pen) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        'EMF+ StrokeFillPath skipped because no current brush or pen is selected'
      )
    }

    if (brush) {
      drawEmfPlusOrDowngrade(runtime, backend, 'fillPath', 'EMF+ StrokeFillPath fill', () => {
        backend.fillPath(path, brush, runtime.getCurrentClassicFillOptions?.())
      })
    }

    if (pen) {
      drawEmfPlusOrDowngrade(runtime, backend, 'strokePath', 'EMF+ StrokeFillPath stroke', () => {
        backend.strokePath(path, pen)
      })
    }

    return true
  }

  if (record.type === EmfPlusRecordType.SetRenderingOrigin) {
    runtime.state.setRenderingOrigin({
      x: parsed.view.getInt32(record.dataOffset, true),
      y: parsed.view.getInt32(record.dataOffset + 4, true)
    })
    return true
  }

  if (record.type === EmfPlusRecordType.DrawImagePoints) {
    const imageAttributes = resolveEmfPlusImageAttributesAt(parsed, runtime, record, 0)
    const imageEffect = (record.flags & EMFPLUS_IMAGE_EFFECT) !== 0 ? runtime.currentEmfPlusEffect : null
    const srcUnit = parsed.view.getInt32(record.dataOffset + 4, true)
    const sourceRect = readRectF(parsed.view, record.dataOffset + 8)
    const count = parsed.view.getUint32(record.dataOffset + 24, true)
    const points = readEmfPlusPointArray(parsed.view, record.dataOffset + 28, count, record.flags)
    const imageObject = runtime.objects.get(getEmfPlusObjectId(record))
    const surfaceHint = resolveMetafileSurfaceHint(runtime, imageObject, points, sourceRect)
    const image = runtime.ensureImageSurface?.(imageObject, surfaceHint)
    const source = resolveBackendImageSource(backend, image)
    const resolvedSourceRect = resolveImageSourceRect(image, sourceRect, srcUnit, source)

    if (image?.surfaceIncomplete) {
      runtime.currentEmfPlusBlockNeedsFallback = true
      return true
    }

    if (image && source) {
      backend.drawImageParallelogram?.(image, points, resolvedSourceRect, imageAttributes, imageEffect)
      return true
    }

    addWarning(
      runtime,
      image?.surfaceFailure?.message
        ? `Unable to render EMF+ image because no drawable image surface is available: ${image.surfaceFailure.message}`
        : 'Unable to render EMF+ image because no drawable image surface is available',
      {
        ...(image?.surfaceFailure?.code ? { code: image.surfaceFailure.code } : {}),
        ...(image?.surfaceFailure?.capability ? { capability: image.surfaceFailure.capability } : {}),
        ...(image?.surfaceFailure?.message ? { reason: image.surfaceFailure.message } : {})
      }
    )
    // The record is recognized and decoded; it only degraded because no
    // drawable surface exists (e.g. a headless host with no canvas). Report the
    // image-surface-unavailable diagnostic above rather than also letting the
    // dispatcher mark it unsupported. Mirrors handleClassicRasterOperation.
    return true
  }

  if (record.type === EmfPlusRecordType.DrawImage) {
    const imageAttributes = resolveEmfPlusImageAttributesAt(parsed, runtime, record, 0)
    const imageEffect = (record.flags & EMFPLUS_IMAGE_EFFECT) !== 0 ? runtime.currentEmfPlusEffect : null
    const srcUnit = parsed.view.getInt32(record.dataOffset + 4, true)
    const sourceRect = readRectF(parsed.view, record.dataOffset + 8)
    const destinationRect = readEmfPlusRect(parsed.view, record.dataOffset + 24, record.flags)
    const imageObject = runtime.objects.get(getEmfPlusObjectId(record))
    const surfaceHint = resolveMetafileRectSurfaceHint(runtime, imageObject, destinationRect, sourceRect)
    const image = runtime.ensureImageSurface?.(imageObject, surfaceHint)
    const source = resolveBackendImageSource(backend, image)
    const resolvedSourceRect = resolveImageSourceRect(image, sourceRect, srcUnit, source)

    if (image?.surfaceIncomplete) {
      runtime.currentEmfPlusBlockNeedsFallback = true
      return true
    }

    if (image && source) {
      backend.drawImageRect?.(image, destinationRect, resolvedSourceRect, imageAttributes, imageEffect)
      return true
    }

    addWarning(
      runtime,
      image?.surfaceFailure?.message
        ? `Unable to render EMF+ image because no drawable image surface is available: ${image.surfaceFailure.message}`
        : 'Unable to render EMF+ image because no drawable image surface is available',
      {
        ...(image?.surfaceFailure?.code ? { code: image.surfaceFailure.code } : {}),
        ...(image?.surfaceFailure?.capability ? { capability: image.surfaceFailure.capability } : {}),
        ...(image?.surfaceFailure?.message ? { reason: image.surfaceFailure.message } : {})
      }
    )
    // The record is recognized and decoded; it only degraded because no
    // drawable surface exists (e.g. a headless host with no canvas). Report the
    // image-surface-unavailable diagnostic above rather than also letting the
    // dispatcher mark it unsupported. Mirrors handleClassicRasterOperation.
    return true
  }

  if (record.type === EmfPlusRecordType.DrawString) {
    const objectId = getEmfPlusObjectId(record)
    const font = runtime.objects.get(objectId)
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const format = runtime.objects.get(parsed.view.getUint32(record.dataOffset + 4, true)) ?? {
      kind: 'stringFormat',
      textAlign: 'left',
      textBaseline: 'top'
    }
    const length = parsed.view.getUint32(record.dataOffset + 8, true)
    const layoutRect = readRectF(parsed.view, record.dataOffset + 12)
    const text = readUtf16String(parsed.view, record.dataOffset + 28, length, Math.max(0, record.dataSize - 28))

    if (!font || !brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        `EMF+ DrawString skipped because its ${!font ? 'font' : 'brush'} could not be resolved`,
        { objectId }
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'drawText', 'EMF+ DrawString', () => {
      backend.drawText(text, layoutRect, font, brush, {
        ...format,
        addWarning(message) {
          addWarning(runtime, message)
        }
      })
    })
  }

  if (record.type === EmfPlusRecordType.DrawDriverString) {
    const objectId = getEmfPlusObjectId(record)
    const font = runtime.objects.get(objectId)
    const brush = resolveEmfPlusBrushAt(parsed, runtime, record, 0)
    const driverString = readEmfPlusDriverString(record, parsed)

    if (!font || !brush) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_OBJECT_UNRESOLVED,
        `EMF+ DrawDriverString skipped because its ${!font ? 'font' : 'brush'} could not be resolved`,
        { objectId }
      )
    }

    if (!driverString) {
      return downgradeEmfPlusRecord(
        runtime,
        DOWNGRADE_RECORD_DECODE_FAILED,
        'EMF+ DrawDriverString skipped because its glyph payload could not be decoded'
      )
    }

    return drawEmfPlusOrDowngrade(runtime, backend, 'drawDriverString', 'EMF+ DrawDriverString', () => {
      backend.drawDriverString(
        driverString.text,
        driverString.positions,
        font,
        brush,
        {
          ...driverString.options,
          glyphs: driverString.glyphs
        },
        driverString.transform
      )
    })
  }

  if (record.type === EmfPlusRecordType.OffsetClip) {
    return offsetClip(
      runtime,
      backend,
      parsed.view.getFloat32(record.dataOffset, true),
      parsed.view.getFloat32(record.dataOffset + 4, true)
    )
  }

  return false
}
