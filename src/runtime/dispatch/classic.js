import {
  EMR_ANGLEARC,
  EMR_ARC,
  EMR_ARCTO,
  EMR_ABORTPATH,
  EMR_CREATEPALETTE,
  EMR_BEGINPATH,
  EMR_BITBLT,
  EMR_CHORD,
  EMR_CLOSEFIGURE,
  EMR_COMMENT,
  EMR_CREATEBRUSHINDIRECT,
  EMR_CREATEDIBPATTERNBRUSHPT,
  EMR_CREATEPEN,
  EMR_ELLIPSE,
  EMR_ENDPATH,
  EMR_EOF,
  EMR_EXCLUDECLIPRECT,
  EMR_EXTCREATEFONTINDIRECTW,
  EMR_EXTCREATEPEN,
  EMR_EXTTEXTOUTA,
  EMR_EXTTEXTOUTW,
  EMR_EXTSELECTCLIPRGN,
  EMR_FILLRGN,
  EMR_GRADIENTFILL,
  EMR_PAINTRGN,
  EMR_POLYDRAW,
  EMR_FLATTENPATH,
  EMR_FILLPATH,
  EMR_HEADER,
  EMR_INTERSECTCLIPRECT,
  EMR_LINETO,
  EMR_MOVETOEX,
  EMR_MODIFYWORLDTRANSFORM,
  EMR_OFFSETCLIPRGN,
  EMR_POLYBEZIER,
  EMR_POLYBEZIER16,
  EMR_POLYBEZIERTO,
  EMR_POLYBEZIERTO16,
  EMR_POLYGON,
  EMR_POLYGON16,
  EMR_POLYLINE,
  EMR_POLYLINE16,
  EMR_POLYLINETO,
  EMR_POLYLINETO16,
  EMR_POLYPOLYGON,
  EMR_POLYPOLYGON16,
  EMR_POLYPOLYLINE,
  EMR_POLYPOLYLINE16,
  EMR_PIE,
  EMR_ROUNDRECT,
  EMR_REALIZEPALETTE,
  EMR_SCALEVIEWPORTEXTEX,
  EMR_SCALEWINDOWEXTEX,
  EMR_SELECTCLIPPATH,
  EMR_ALPHABLEND,
  EMR_MASKBLT,
  EMR_PLGBLT,
  EMR_SETARCDIRECTION,
  EMR_SETMETARGN,
  EMR_SETBKCOLOR,
  EMR_SETBKMODE,
  EMR_SETCOLORADJUSTMENT,
  EMR_SETICMMODE,
  EMR_SETICMPROFILEA,
  EMR_SETICMPROFILEW,
  EMR_SETLAYOUT,
  EMR_SETLINKEDUFIS,
  EMR_SETMAPMODE,
  EMR_SETMAPPERFLAGS,
  EMR_SETPIXELV,
  EMR_SETROP2,
  EMR_SELECTPALETTE,
  EMR_SETSTRETCHBLTMODE,
  EMR_SETBRUSHORGEX,
  EMR_SETMITERLIMIT,
  EMR_SETPOLYFILLMODE,
  EMR_SELECTOBJECT,
  EMR_SETTEXTJUSTIFICATION,
  EMR_SETWORLDTRANSFORM,
  EMR_STROKEANDFILLPATH,
  EMR_STROKEPATH,
  EMR_SETDIBITSTODEVICE,
  EMR_STRETCHBLT,
  EMR_STRETCHDIBITS,
  EMR_SETTEXTALIGN,
  EMR_SETTEXTCOLOR,
  EMR_TRANSPARENTBLT,
  EMR_SETVIEWPORTEXTEX,
  EMR_SETVIEWPORTORGEX,
  EMR_SETWINDOWEXTEX,
  EMR_SETWINDOWORGEX,
  EMR_WIDENPATH,
  ARC_DIRECTION_COUNTERCLOCKWISE,
  BACKGROUND_MODE_OPAQUE,
  BRUSH_STYLE_HATCHED,
  BRUSH_STYLE_NULL,
  CLIP_REGION_MODE_COPY,
  CREATE_PEN_WIDTH_OFFSET,
  ETO_OPAQUE,
  ETO_PDY,
  EXT_CREATE_PEN_WIDTH_OFFSET,
  MODIFY_WORLD_TRANSFORM_IDENTITY,
  MODIFY_WORLD_TRANSFORM_LEFTMULTIPLY,
  MODIFY_WORLD_TRANSFORM_MODE_OFFSET,
  MODIFY_WORLD_TRANSFORM_RIGHTMULTIPLY,
  MODIFY_WORLD_TRANSFORM_SET,
  PEN_ENDCAP_MASK,
  PEN_JOIN_MASK,
  PEN_STYLE_MASK,
  PEN_STYLE_NULL,
  PEN_STYLE_USERSTYLE,
  SMALL_POLY_COUNTS_OFFSET,
  SMALL_POLY_POINT_COUNT_OFFSET,
  SMALL_POLY_POINTS_OFFSET,
  resolveClassicStockObject
} from './constants.js'
import { readClassicRasterOperation } from '../image-surface.js'
import { multiplyMatrices } from '../matrix.js'
import {
  createArcPathGeometry,
  createPathGeometry,
  flattenPathGeometry,
  PathBuilder,
  widenPathGeometry
} from '../path-builder.js'
import { combineRegions, rectToRegionGeometry } from '../region-ops.js'
import {
  buildCssFontFromLogFontW,
  decodeLogFontW,
  mapGdiTextAlignToCanvas,
  readClassicAnsiString
} from '../text-layout.js'
import {
  readColorRef,
  readBrushColor,
  readPenColor,
  readExtPenColor,
  readPointL,
  readRectL,
  readArcRecord,
  readAngleArcRecord,
  readMatrix,
  readPointLArrayAt,
  readPointSArrayAt,
  readPolyCountsAt,
  readPolyCounts,
  readRectLAt,
  createRotationAroundPointMatrix,
  readClassicFillMode,
  readClassicClipMode,
  readClassicDashStyle,
  readClassicLineCap,
  readClassicLineJoin,
  addWarning,
  resolveBackendImageSource,
  toRectL,
  createBezierPathGeometry,
  createPolylineToGeometry,
  createPolyPolylineGeometry,
  createRoundRectGeometry,
  createArcToGeometry,
  createAngleArcToGeometry,
  appendClassicPathGeometry,
  addUnknownObjectWarnings,
  readUtf16String,
  applyClassicClipOperation,
  offsetClassicClipRegion,
  resetClassicClipRegion,
  setClassicMetaRegion,
  drawOrReportCapability,
  reportRecordDowngrade,
  DOWNGRADE_CAPABILITY_UNAVAILABLE,
} from './shared.js'

const LAYOUT_RTL = 0x00000001

function readPointSArray(view, record) {
  const count = view.getUint32(record.dataOffset + SMALL_POLY_POINT_COUNT_OFFSET, true)
  return readPointSArrayAt(view, record.dataOffset + SMALL_POLY_POINTS_OFFSET, count)
}

function readPointLArray(view, record) {
  const count = view.getUint32(record.dataOffset + 16, true)
  return readPointLArrayAt(view, record.dataOffset + 20, count)
}

function createClassicBrush(style, color, hatch) {
  if (style === BRUSH_STYLE_NULL) {
    return {
      kind: 'brush',
      isNull: true,
      style
    }
  }

  if (style === BRUSH_STYLE_HATCHED) {
    return {
      kind: 'brush',
      type: 'hatch',
      style,
      color: readColorRef(color),
      foreColor: readColorRef(color),
      hatch
    }
  }

  return {
    kind: 'brush',
    color: readColorRef(color)
  }
}

function createClassicPen(style, width, color, dashPattern = null) {
  const penStyle = style & PEN_STYLE_MASK

  if (penStyle === PEN_STYLE_NULL) {
    return {
      kind: 'pen',
      isNull: true,
      style
    }
  }

  const normalizedWidth = Number.isFinite(width) && width > 0 ? width : 1
  const resolvedDashPattern = Array.isArray(dashPattern) && dashPattern.length > 0 ? dashPattern : null
  const pen = {
    kind: 'pen',
    width: normalizedWidth,
    color: readColorRef(color)
  }

  const hasExtendedStrokeStyle =
    (style & PEN_STYLE_MASK) !== 0 ||
    (style & PEN_ENDCAP_MASK) !== 0 ||
    resolvedDashPattern !== null

  if (hasExtendedStrokeStyle) {
    pen.style = style
    pen.dashStyle = readClassicDashStyle(style)

    if (resolvedDashPattern !== null) {
      pen.dashPattern = resolvedDashPattern
    }

    if ((style & PEN_ENDCAP_MASK) !== 0) {
      pen.lineCap = readClassicLineCap(style)
    }

    if (resolvedDashPattern !== null) {
      pen.lineJoin = readClassicLineJoin(style)
    }
  }

  if ((style & PEN_JOIN_MASK) !== 0) {
    pen.lineJoin = readClassicLineJoin(style)
  }

  return pen
}

function syncClassicMapping(runtime) {
  if (typeof runtime.updateClassicMapping === 'function') {
    runtime.updateClassicMapping()
  }
}

function resolveObject(runtime, handle) {
  return runtime.resolveClassicObject?.(handle) ?? runtime.objects.get(handle) ?? resolveClassicStockObject(handle)
}

// Realize an explicitly referenced classic brush handle (e.g. EMR_FILLRGN's
// ihBrush) the same way the selected brush is realized: solid brushes pass
// through, texture brushes have their image surface prepared.
function realizeClassicBrushObject(runtime, object) {
  if (!object || object.isNull) {
    return null
  }

  if (object.type === 'texture' && object.image) {
    const image = runtime.ensureImageSurface?.(object.image) ?? object.image

    if (image !== object.image) {
      return { ...object, image }
    }
  }

  return object
}

function toClipRect(rect) {
  return {
    x: Math.min(rect.left, rect.right),
    y: Math.min(rect.top, rect.bottom),
    width: Math.abs(rect.right - rect.left),
    height: Math.abs(rect.bottom - rect.top)
  }
}

function selectBrush(runtime, handle, object) {
  runtime.selectedBrushHandle = handle
  runtime.selectedBrush = object?.isNull ? null : object
}

function selectPen(runtime, handle, object) {
  runtime.selectedPenHandle = handle
  runtime.selectedPen = object?.isNull ? null : object
}

function selectFont(runtime, handle, object) {
  runtime.selectedFontHandle = handle
  runtime.selectedFont = object?.kind === 'font' ? object : null
}

function selectPalette(runtime, handle, object) {
  runtime.selectedPaletteHandle = handle
  runtime.selectedPalette = object?.kind === 'palette' ? object : null
}

function beginClassicPath(runtime) {
  runtime.classicPath.beginPath()
  runtime.classicPathMode = 'building'
}

function resetClassicPath(runtime) {
  runtime.classicPath.beginPath()
  runtime.classicPathMode = 'idle'
}

function finalizeClassicPath(runtime) {
  if (runtime.classicPathMode === 'building') {
    runtime.classicPathMode = 'ready'
  }
}

function consumeClassicPath(runtime) {
  const geometry = runtime.classicPath.toPathGeometry()
  resetClassicPath(runtime)
  return geometry
}

function updateClassicCurrentPosition(runtime, point) {
  runtime.classicState.currentPos = { x: point.x, y: point.y }
}

function resolveClassicTextAdvances(textRecord, directionRightToLeft = false) {
  if (!Array.isArray(textRecord.dx)) {
    return textRecord.dx
  }

  if (!directionRightToLeft) {
    return textRecord.dx
  }

  return textRecord.dx.map((entry) => ({
    x: Number.isFinite(entry.x) ? -entry.x : entry.x,
    y: entry.y
  }))
}

function advanceClassicTextPosition(runtime, textRecord, referencePoint, directionRightToLeft = false) {
  const advances = resolveClassicTextAdvances(textRecord, directionRightToLeft)

  if (!Array.isArray(advances) || advances.length === 0) {
    updateClassicCurrentPosition(runtime, referencePoint)
    return
  }

  const delta = advances.reduce(
    (sum, entry) => ({
      x: sum.x + entry.x,
      y: sum.y + entry.y
    }),
    { x: 0, y: 0 }
  )

  updateClassicCurrentPosition(runtime, {
    x: referencePoint.x + delta.x,
    y: referencePoint.y + delta.y
  })
}

function ensureClassicCurrentFigure(runtime) {
  if (runtime.classicPath.currentFigure || runtime.classicPathMode !== 'building') {
    return
  }

  const current = runtime.classicState.currentPos ?? { x: 0, y: 0 }
  runtime.classicPath.moveTo(current.x, current.y)
}

function appendClassicLine(runtime, point) {
  ensureClassicCurrentFigure(runtime)
  runtime.classicPath.lineTo(point.x, point.y)
  updateClassicCurrentPosition(runtime, point)
}

function appendClassicBezier(runtime, points) {
  ensureClassicCurrentFigure(runtime)

  for (let index = 0; index + 2 < points.length; index += 3) {
    runtime.classicPath.curveTo(points[index], points[index + 1], points[index + 2])
    updateClassicCurrentPosition(runtime, points[index + 2])
  }
}

function scaleClassicExtent(extent, numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) {
    return extent
  }

  return Math.round((extent * numerator) / denominator)
}

function readClassicDxArray(view, offset, count, availableBytes, options) {
  if (!Number.isFinite(offset) || offset <= 0) {
    return null
  }

  const stride = (options & ETO_PDY) !== 0 ? 8 : 4

  if (availableBytes < count * stride) {
    return null
  }

  const advances = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    advances.push({
      x: view.getInt32(cursor, true),
      y: (options & ETO_PDY) !== 0 ? view.getInt32(cursor + 4, true) : 0
    })
    cursor += stride
  }

  return advances
}

function readClassicExtText(parsed, record, runtime, isUnicode) {
  if ((record.dataSize ?? 0) < 68) {
    return null
  }

  const view = parsed.view
  const recordStart = record.dataOffset - 8
  const stringOffset = view.getUint32(record.dataOffset + 40, true)
  const options = view.getUint32(record.dataOffset + 44, true)
  const dxOffset = view.getUint32(record.dataOffset + 64, true)
  const length = view.getUint32(record.dataOffset + 36, true)
  const availableStringBytes = Math.max(0, recordStart + record.dataSize + 8 - (recordStart + stringOffset))
  const text =
    length > 0
      ? isUnicode
        ? readUtf16String(view, recordStart + stringOffset, length, availableStringBytes)
        : readClassicAnsiString(view, recordStart + stringOffset, length, availableStringBytes, {
            charSet: runtime.selectedFont?.charSet,
            addWarning(message, details) {
              addWarning(runtime, message, details)
            }
          })
      : ''
  const dx = readClassicDxArray(
    view,
    recordStart + dxOffset,
    length,
    Math.max(0, recordStart + record.dataSize + 8 - (recordStart + dxOffset)),
    options
  )

  return {
    text,
    referencePoint: {
      x: view.getInt32(record.dataOffset + 28, true),
      y: view.getInt32(record.dataOffset + 32, true)
    },
    options,
    opaqueRect: readRectLAt(view, record.dataOffset + 48),
    dx
  }
}

function parseClassicRegionData(view, offset, regionDataSize) {
  if (!Number.isFinite(regionDataSize) || regionDataSize < 32) {
    return {
      kind: 'region',
      type: 'empty',
      geometry: []
    }
  }

  const headerSize = view.getUint32(offset, true)
  const rectCount = view.getUint32(offset + 8, true)
  const headerBytes = Math.max(32, headerSize)
  const availableRects = Math.max(0, Math.min(rectCount, Math.floor((regionDataSize - headerBytes) / 16)))
  let geometry = []
  let cursor = offset + headerBytes

  for (let index = 0; index < availableRects; index += 1) {
    const rect = readRectLAt(view, cursor)
    const rectGeometry = rectToRegionGeometry({
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    })
    geometry = geometry.length === 0 ? rectGeometry : combineRegions(geometry, rectGeometry, 'union', null)
    cursor += 16
  }

  return {
    kind: 'region',
    type: 'rects',
    geometry
  }
}

// EMR_POLYDRAW point-type bytes: each point is a MoveTo / LineTo / BezierTo,
// optionally OR'd with PT_CLOSEFIGURE. BezierTo points arrive in groups of three.
const PT_CLOSEFIGURE = 0x01
const PT_LINETO = 0x02
const PT_BEZIERTO = 0x04
const PT_MOVETO = 0x06

function buildPolyDrawGeometry(points, types) {
  const builder = new PathBuilder()
  builder.beginPath()

  for (let index = 0; index < points.length; index += 1) {
    const type = types[index] ?? 0
    const kind = type & 0x06

    if (kind === PT_MOVETO) {
      builder.moveTo(points[index].x, points[index].y)
    } else if (kind === PT_BEZIERTO && points[index + 1] && points[index + 2]) {
      builder.curveTo(points[index], points[index + 1], points[index + 2])

      if ((types[index + 2] ?? 0) & PT_CLOSEFIGURE) {
        builder.closeFigure()
      }

      index += 2
      continue
    } else {
      builder.lineTo(points[index].x, points[index].y)
    }

    if (type & PT_CLOSEFIGURE) {
      builder.closeFigure()
    }
  }

  return builder.toPathGeometry()
}

// EMR_GRADIENTFILL fill modes.
const GRADIENT_FILL_RECT_H = 0
const GRADIENT_FILL_RECT_V = 1
const GRADIENT_FILL_TRIANGLE = 2

function readTriVertex(view, offset) {
  // TRIVERTEX: LONG x, LONG y, then COLOR16 Red/Green/Blue/Alpha (0..0xffff).
  // GDI GradientFill ignores the alpha channel for rectangle modes, so the
  // colour is rendered opaque.
  return {
    x: view.getInt32(offset, true),
    y: view.getInt32(offset + 4, true),
    color: `rgb(${view.getUint16(offset + 8, true) >> 8}, ${view.getUint16(offset + 10, true) >> 8}, ${view.getUint16(offset + 12, true) >> 8})`
  }
}

function handleGradientFill(parsed, runtime, backend, record) {
  const view = parsed.view
  const base = record.dataOffset
  const end = base + record.dataSize
  const vertexCount = view.getUint32(base + 16, true)
  const rectCount = view.getUint32(base + 20, true)
  const mode = view.getUint32(base + 24, true)

  if (mode === GRADIENT_FILL_TRIANGLE) {
    addWarning(
      runtime,
      'EMR_GRADIENTFILL triangle (Gouraud) mode has no Canvas equivalent and is left unfilled',
      { code: 'classic-gradientfill-triangle-unsupported', capability: 'classic-gradient' }
    )
    return true
  }

  if (mode !== GRADIENT_FILL_RECT_H && mode !== GRADIENT_FILL_RECT_V) {
    // Recognized record with an unknown gradient sub-mode (triangle is handled
    // above): intentionally unsupported, not a fall-through bug. Mirrors the
    // MODIFYWORLDTRANSFORM unknown sub-mode. See the return contract in shared.js.
    return false
  }

  if (typeof backend.fillRect !== 'function') {
    return reportRecordDowngrade(
      runtime,
      DOWNGRADE_CAPABILITY_UNAVAILABLE,
      'EMR_GRADIENTFILL skipped because backend.fillRect is unavailable',
      { capability: 'fillRect' }
    )
  }

  const vertices = []
  let cursor = base + 28

  for (let index = 0; index < vertexCount && cursor + 16 <= end; index += 1) {
    vertices.push(readTriVertex(view, cursor))
    cursor += 16
  }

  const horizontal = mode === GRADIENT_FILL_RECT_H

  for (let index = 0; index < rectCount && cursor + 8 <= end; index += 1) {
    const upperLeft = vertices[view.getUint32(cursor, true)]
    const lowerRight = vertices[view.getUint32(cursor + 4, true)]
    cursor += 8

    if (!upperLeft || !lowerRight) {
      continue
    }

    const left = Math.min(upperLeft.x, lowerRight.x)
    const top = Math.min(upperLeft.y, lowerRight.y)
    const right = Math.max(upperLeft.x, lowerRight.x)
    const bottom = Math.max(upperLeft.y, lowerRight.y)

    backend.fillRect(
      { left, top, right, bottom },
      {
        type: 'linearGradient',
        rect: { x: left, y: top, width: right - left, height: bottom - top },
        startColor: upperLeft.color,
        endColor: lowerRight.color,
        startPoint: { x: left, y: top },
        endPoint: horizontal ? { x: right, y: top } : { x: left, y: bottom }
      }
    )
  }

  return true
}

function readViewBytes(view, offset, size) {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > view.byteLength) {
    return null
  }

  return new Uint8Array(view.buffer, view.byteOffset + offset, size).slice()
}

function handleClassicRasterRecord(parsed, runtime, backend, record) {
  const operation = readClassicRasterOperation(parsed, record, {
    addWarning(message, details = {}) {
      addWarning(runtime, message, details)
    }
  })

  if (!operation) {
    return true
  }

  if (operation.kind === 'noop') {
    return true
  }

  if (operation.kind === 'solid') {
    // Recognized raster op; a missing backend method is a capability gap, not an
    // unsupported record. Degrade with a diagnostic instead of returning false.
    return drawOrReportCapability(
      runtime,
      backend,
      'fillRect',
      () => backend.fillRect(toRectL(operation.destinationRect), { color: operation.color }),
      'Classic solid raster operation'
    )
  }

  const image = runtime.ensureImageSurface?.(operation.image)
  const source = resolveBackendImageSource(backend, image)

  if (!image || !source) {
    const reason = image?.surfaceFailure?.message
    addWarning(
      runtime,
      reason
        ? `Unable to render classic raster operation because no drawable image surface is available: ${reason}`
        : 'Unable to render classic raster operation because no drawable image surface is available',
      {
        ...(image?.surfaceFailure?.code ? { code: image.surfaceFailure.code } : {}),
        ...(image?.surfaceFailure?.capability ? { capability: image.surfaceFailure.capability } : {}),
        ...(reason ? { reason } : {})
      }
    )
    // The record type is recognized and decoded; it only degraded because no
    // drawable surface exists (e.g. a headless host with no canvas). Report
    // that as the located image-surface-unavailable diagnostic above rather
    // than also letting the dispatcher mark it as an unsupported record.
    return true
  }

  // Recognized raster op; a missing backend method is a capability gap, not an
  // unsupported record. Degrade with a diagnostic instead of returning false.
  return drawOrReportCapability(
    runtime,
    backend,
    'drawImageRect',
    () =>
      backend.drawImageRect(image, operation.destinationRect, operation.sourceRect, {
        rasterOp: operation.rasterOp,
        stretchMode: runtime.classicState.stretchBltMode,
        sourceConstantAlpha: operation.sourceConstantAlpha,
        sourceAlpha: operation.sourceAlpha,
        transparentColor: operation.transparentColor,
        patternColor: runtime.selectedBrush?.color,
        brush: runtime.selectedBrush,
        addWarning(message) {
          addWarning(runtime, message)
        },
        ...(operation.blendFunction ? { blendFunction: operation.blendFunction } : {}),
        ...(operation.unsupportedBlendFunction ? { unsupportedBlendFunction: true } : {})
      }),
    'Classic raster operation'
  )
}

function handleUnsupportedClassicRasterRecord(runtime, record, capability) {
  runtime.addUnsupportedRecord?.(record, { capability })
  return true
}

export function handleClassicRecord(parsed, runtime, backend, record) {
  if (record.type === EMR_HEADER || record.type === EMR_EOF || record.type === EMR_COMMENT) {
    return true
  }

  if (record.type === EMR_SETMAPMODE) {
    runtime.classicState.mapMode = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETBKMODE) {
    runtime.classicState.bkMode = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETROP2) {
    runtime.classicState.rop2 = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETTEXTALIGN) {
    runtime.classicState.textAlign = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETTEXTCOLOR) {
    runtime.classicState.textColor = readColorRef(parsed.view.getUint32(record.dataOffset, true))
    return true
  }

  if (record.type === EMR_SETBKCOLOR) {
    runtime.classicState.bkColor = readColorRef(parsed.view.getUint32(record.dataOffset, true))
    return true
  }

  if (record.type === EMR_MOVETOEX) {
    const point = readPointL(parsed.view, record)
    updateClassicCurrentPosition(runtime, point)

    if (runtime.classicPathMode === 'building') {
      runtime.classicPath.moveTo(point.x, point.y)
    }

    return true
  }

  if (record.type === EMR_SETMETARGN) {
    return setClassicMetaRegion(runtime, backend)
  }

  if (record.type === EMR_SETWINDOWORGEX) {
    runtime.classicState.windowOrg = readPointL(parsed.view, record)
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SETWINDOWEXTEX) {
    runtime.classicState.windowExt = readPointL(parsed.view, record)
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SETVIEWPORTORGEX) {
    runtime.classicState.viewportOrg = readPointL(parsed.view, record)
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SETVIEWPORTEXTEX) {
    runtime.classicState.viewportExt = readPointL(parsed.view, record)
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SCALEVIEWPORTEXTEX) {
    runtime.classicState.viewportExt = {
      x: scaleClassicExtent(
        runtime.classicState.viewportExt.x,
        parsed.view.getInt32(record.dataOffset, true),
        parsed.view.getInt32(record.dataOffset + 4, true)
      ),
      y: scaleClassicExtent(
        runtime.classicState.viewportExt.y,
        parsed.view.getInt32(record.dataOffset + 8, true),
        parsed.view.getInt32(record.dataOffset + 12, true)
      )
    }
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SCALEWINDOWEXTEX) {
    runtime.classicState.windowExt = {
      x: scaleClassicExtent(
        runtime.classicState.windowExt.x,
        parsed.view.getInt32(record.dataOffset, true),
        parsed.view.getInt32(record.dataOffset + 4, true)
      ),
      y: scaleClassicExtent(
        runtime.classicState.windowExt.y,
        parsed.view.getInt32(record.dataOffset + 8, true),
        parsed.view.getInt32(record.dataOffset + 12, true)
      )
    }
    syncClassicMapping(runtime)
    return true
  }

  if (record.type === EMR_SETBRUSHORGEX) {
    runtime.classicState.brushOrg = readPointL(parsed.view, record)
    return true
  }

  if (record.type === EMR_SETPOLYFILLMODE) {
    runtime.classicState.fillMode = readClassicFillMode(parsed.view.getUint32(record.dataOffset, true))
    return true
  }

  if (record.type === EMR_SETSTRETCHBLTMODE) {
    runtime.classicState.stretchBltMode = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETARCDIRECTION) {
    runtime.classicState.arcDirection = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETLAYOUT) {
    runtime.classicState.layoutMode = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_SETTEXTJUSTIFICATION) {
    runtime.classicState.textJustificationExtra = parsed.view.getInt32(record.dataOffset, true)
    runtime.classicState.textJustificationCount = parsed.view.getInt32(record.dataOffset + 4, true)
    return true
  }

  if (
    record.type === EMR_SETCOLORADJUSTMENT ||
    record.type === EMR_SETICMMODE ||
    record.type === EMR_SETMAPPERFLAGS ||
    record.type === EMR_SETLINKEDUFIS ||
    record.type === EMR_SETICMPROFILEA ||
    record.type === EMR_SETICMPROFILEW ||
    record.type === EMR_REALIZEPALETTE
  ) {
    return true
  }

  if (record.type === EMR_FLATTENPATH) {
    if (runtime.classicPathMode === 'idle') {
      return true
    }

    runtime.classicPath.restore(flattenPathGeometry(runtime.classicPath.toPathGeometry()))
    return true
  }

  if (record.type === EMR_WIDENPATH) {
    if (runtime.classicPathMode === 'idle') {
      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    if (!pen) {
      runtime.classicPath.restore({ figures: [] })
      return true
    }

    const widened = widenPathGeometry(runtime.classicPath.toPathGeometry(), pen?.width ?? 1, {
      lineCap: pen.lineCap ?? readClassicLineCap(pen.style ?? 0),
      lineJoin: pen.lineJoin ?? readClassicLineJoin(pen.style ?? 0),
      miterLimit: pen.miterLimit
    })

    runtime.classicPath.restore(widened.path)

    for (const [index, warning] of widened.warnings.entries()) {
      addWarning(runtime, warning, {
        code: 'classic-widenpath-approximation',
        capability: 'classic-path-widening',
        reason: widened.warningDetails?.[index]?.reason
      })
    }

    return true
  }

  if (record.type === EMR_SETMITERLIMIT) {
    runtime.classicState.miterLimit = parsed.view.getUint32(record.dataOffset, true)
    return true
  }

  if (record.type === EMR_INTERSECTCLIPRECT) {
    const rect = readRectL(parsed.view, record)
    const clipRect = toClipRect(rect)

    return applyClassicClipOperation(runtime, backend, { kind: 'rect', rect: clipRect }, 'intersect')
  }

  if (record.type === EMR_EXCLUDECLIPRECT) {
    const rect = readRectL(parsed.view, record)
    const clipRect = toClipRect(rect)

    return applyClassicClipOperation(runtime, backend, { kind: 'rect', rect: clipRect }, 'exclude')
  }

  if (record.type === EMR_OFFSETCLIPRGN) {
    return offsetClassicClipRegion(
      runtime,
      backend,
      parsed.view.getInt32(record.dataOffset, true),
      parsed.view.getInt32(record.dataOffset + 4, true)
    )
  }

  if (record.type === EMR_SETWORLDTRANSFORM) {
    runtime.state.setWorldTransform(readMatrix(parsed.view, record.dataOffset))
    runtime.applyTransform()
    return true
  }

  if (record.type === EMR_MODIFYWORLDTRANSFORM) {
    const matrix = readMatrix(parsed.view, record.dataOffset)
    const mode = parsed.view.getUint32(record.dataOffset + MODIFY_WORLD_TRANSFORM_MODE_OFFSET, true)

    if (mode === MODIFY_WORLD_TRANSFORM_IDENTITY) {
      runtime.state.resetWorldTransform()
    } else if (mode === MODIFY_WORLD_TRANSFORM_LEFTMULTIPLY) {
      // GDI MWT_LEFTMULTIPLY: World = Xform x Current (Xform applied to points
      // first). With column-vector multiplyMatrices(L, R) = L∘R (R applied
      // first), "Xform first" is multiplyMatrices(Current, Xform).
      runtime.state.setWorldTransform(multiplyMatrices(runtime.state.current.worldTransform, matrix))
    } else if (mode === MODIFY_WORLD_TRANSFORM_RIGHTMULTIPLY) {
      // GDI MWT_RIGHTMULTIPLY: World = Current x Xform (Xform applied last).
      runtime.state.setWorldTransform(multiplyMatrices(matrix, runtime.state.current.worldTransform))
    } else if (mode === MODIFY_WORLD_TRANSFORM_SET) {
      runtime.state.setWorldTransform(matrix)
    } else {
      // Recognized record type with an unknown transform sub-mode: there is no
      // sensible way to interpret the matrix, so this is an intentional
      // unsupported (not a fall-through bug). This is the one deliberate `return
      // false` the return contract allows — an unrecognizable sub-record of a
      // known type. See the return contract note in shared.js.
      return false
    }

    runtime.applyTransform()
    return true
  }

  if (record.type === EMR_CREATEBRUSHINDIRECT) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const style = parsed.view.getUint32(record.dataOffset + 4, true)
    const color = readBrushColor(parsed.view, record)
    const hatch = record.dataSize >= 16 ? parsed.view.getUint32(record.dataOffset + 12, true) : null

    runtime.objects.set(handle, createClassicBrush(style, color, hatch))
    return true
  }

  if (record.type === EMR_CREATEPEN) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const style = parsed.view.getUint32(record.dataOffset + 4, true)
    const width = parsed.view.getUint32(record.dataOffset + CREATE_PEN_WIDTH_OFFSET, true)
    const color = readPenColor(parsed.view, record)

    runtime.objects.set(handle, createClassicPen(style, width, color))
    return true
  }

  if (record.type === EMR_EXTCREATEFONTINDIRECTW) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const logFont = decodeLogFontW(parsed.view, record.dataOffset + 4)
    const css = buildCssFontFromLogFontW(logFont)
    runtime.objects.set(handle, { kind: 'font', ...logFont, css, cssFont: css })
    return true
  }

  if (record.type === EMR_EXTCREATEPEN) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const style = parsed.view.getUint32(record.dataOffset + 20, true)
    const width = parsed.view.getUint32(record.dataOffset + EXT_CREATE_PEN_WIDTH_OFFSET, true)
    const color = readExtPenColor(parsed.view, record)
    const dashEntryCount = record.dataSize >= 44 ? parsed.view.getUint32(record.dataOffset + 40, true) : 0
    const dashPattern =
      (style & PEN_STYLE_MASK) === PEN_STYLE_USERSTYLE && dashEntryCount > 0
        ? readPolyCountsAt(parsed.view, record.dataOffset + 44, dashEntryCount)
        : null

    runtime.objects.set(handle, createClassicPen(style, width, color, dashPattern))
    return true
  }

  if (record.type === EMR_CREATEDIBPATTERNBRUSHPT) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const recordStart = record.dataOffset - 8
    const bmiOffset = parsed.view.getUint32(record.dataOffset + 8, true)
    const bmiSize = parsed.view.getUint32(record.dataOffset + 12, true)
    const bitsOffset = parsed.view.getUint32(record.dataOffset + 16, true)
    const bitsSize = parsed.view.getUint32(record.dataOffset + 20, true)
    const bmiBytes = bmiSize > 0 ? readViewBytes(parsed.view, recordStart + bmiOffset, bmiSize) : null
    const bitsBytes = bitsSize > 0 ? readViewBytes(parsed.view, recordStart + bitsOffset, bitsSize) : null
    runtime.objects.set(handle, {
      kind: 'brush',
      type: bmiBytes && bitsBytes ? 'texture' : 'pattern',
      wrapMode: bmiBytes && bitsBytes ? 'tile' : undefined,
      style: parsed.view.getUint32(record.dataOffset + 4, true),
      dib:
        bmiSize > 0
          ? {
              bmiOffset: recordStart + bmiOffset,
              bmiSize,
              bitsOffset: recordStart + bitsOffset,
              bitsSize
            }
          : null,
      image:
        bmiBytes && bitsBytes
          ? {
              format: 'dib',
              bmiBytes,
              bitsBytes
            }
          : null
    })
    return true
  }

  if (record.type === EMR_SELECTOBJECT) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const object = resolveObject(runtime, handle)

    addUnknownObjectWarnings(runtime, object)

    if (object?.kind === 'brush') {
      selectBrush(runtime, handle, object)
    }

    if (object?.kind === 'pen') {
      selectPen(runtime, handle, object)
    }

    if (object?.kind === 'font') {
      selectFont(runtime, handle, object)
    }

    if (object?.kind === 'palette') {
      selectPalette(runtime, handle, object)
    }

    return true
  }

  if (record.type === EMR_CREATEPALETTE) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const entryCount = parsed.view.getUint16(record.dataOffset + 6, true)
    const entries = []

    for (let index = 0; index < entryCount; index += 1) {
      const offset = record.dataOffset + 8 + index * 4
      entries.push({
        r: parsed.view.getUint8(offset),
        g: parsed.view.getUint8(offset + 1),
        b: parsed.view.getUint8(offset + 2)
      })
    }

    runtime.objects.set(handle, { kind: 'palette', entries })
    return true
  }

  if (record.type === EMR_SELECTPALETTE) {
    const handle = parsed.view.getUint32(record.dataOffset, true)
    const object = resolveObject(runtime, handle)
    selectPalette(runtime, handle, object)
    return true
  }

  if (record.type === EMR_ELLIPSE) {
    const rect = readRectL(parsed.view, record)
    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (brush) {
      backend.fillEllipse?.(rect, brush)
    }

    if (pen) {
      backend.strokeEllipse?.(rect, pen)
    }

    return true
  }

  if (record.type === EMR_ROUNDRECT) {
    const rect = readRectL(parsed.view, record)
    const path = createRoundRectGeometry(
      rect,
      parsed.view.getInt32(record.dataOffset + 16, true),
      parsed.view.getInt32(record.dataOffset + 20, true)
    )

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)
      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    return true
  }

  if (record.type === EMR_ANGLEARC) {
    const angleArc = readAngleArcRecord(parsed.view, record)
    const current = runtime.classicState.currentPos ?? { x: 0, y: 0 }
    const path = createAngleArcToGeometry(
      angleArc,
      current,
      runtime.classicState.arcDirection === ARC_DIRECTION_COUNTERCLOCKWISE
    )
    const endPoint = path.figures[0]?.points?.at(-1) ?? current

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)
      updateClassicCurrentPosition(runtime, endPoint)
      return true
    }

    const pen = runtime.getCurrentClassicStroke()

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    updateClassicCurrentPosition(runtime, endPoint)
    return true
  }

  if (record.type === EMR_ARC || record.type === EMR_CHORD || record.type === EMR_PIE) {
    const arc = readArcRecord(parsed.view, record)
    const path = createArcPathGeometry(arc.box, arc.start, arc.end, {
      pie: record.type === EMR_PIE,
      chord: record.type === EMR_CHORD,
      counterclockwise: runtime.classicState.arcDirection === ARC_DIRECTION_COUNTERCLOCKWISE
    })
    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if ((record.type === EMR_CHORD || record.type === EMR_PIE) && brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    return true
  }

  if (record.type === EMR_ARCTO) {
    const arc = readArcRecord(parsed.view, record)
    const current = runtime.classicState.currentPos ?? { x: 0, y: 0 }
    const path = createArcToGeometry(
      arc.box,
      current,
      arc.start,
      arc.end,
      runtime.classicState.arcDirection === ARC_DIRECTION_COUNTERCLOCKWISE
    )

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)
      updateClassicCurrentPosition(runtime, path.figures[0]?.points?.at(-1) ?? current)
      return true
    }

    const pen = runtime.getCurrentClassicStroke()

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    updateClassicCurrentPosition(runtime, path.figures[0]?.points?.at(-1) ?? current)
    return true
  }

  if (record.type === EMR_LINETO) {
    const point = readPointL(parsed.view, record)

    if (runtime.classicPathMode === 'building') {
      appendClassicLine(runtime, point)
      return true
    }

    const from = runtime.classicState.currentPos ?? { x: 0, y: 0 }
    const pen = runtime.getCurrentClassicStroke()

    if (pen) {
      backend.drawLine?.(from, point, pen)
    }

    updateClassicCurrentPosition(runtime, point)
    return true
  }

  if (record.type === EMR_BEGINPATH) {
    beginClassicPath(runtime)
    return true
  }

  if (record.type === EMR_ENDPATH) {
    finalizeClassicPath(runtime)
    return true
  }

  if (record.type === EMR_CLOSEFIGURE) {
    if (runtime.classicPathMode === 'building') {
      runtime.classicPath.closeFigure()
    }

    return true
  }

  if (record.type === EMR_FILLPATH) {
    if (runtime.classicPathMode !== 'ready') {
      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const path = consumeClassicPath(runtime)

    if (brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    return true
  }

  if (record.type === EMR_STROKEPATH) {
    if (runtime.classicPathMode !== 'ready') {
      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    const path = consumeClassicPath(runtime)

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    return true
  }

  if (record.type === EMR_STROKEANDFILLPATH) {
    if (runtime.classicPathMode !== 'ready') {
      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()
    const path = consumeClassicPath(runtime)

    if (brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    return true
  }

  if (record.type === EMR_ABORTPATH) {
    resetClassicPath(runtime)
    return true
  }

  if (record.type === EMR_EXTSELECTCLIPRGN) {
    const regionDataSize = parsed.view.getUint32(record.dataOffset, true)
    const mode = parsed.view.getUint32(record.dataOffset + 4, true)

    if (regionDataSize === 0) {
      if (mode === CLIP_REGION_MODE_COPY) {
        return resetClassicClipRegion(runtime, backend)
      }

      return true
    }

    const region = parseClassicRegionData(parsed.view, record.dataOffset + 8, regionDataSize)
    return applyClassicClipOperation(runtime, backend, { kind: 'region', region }, readClassicClipMode(mode))
  }

  if (record.type === EMR_FILLRGN || record.type === EMR_PAINTRGN) {
    // EMR_FILLRGN: rclBounds(16) cbRgnData(4) ihBrush(4) RgnData.
    // EMR_PAINTRGN: rclBounds(16) cbRgnData(4) RgnData, using the selected brush.
    const regionDataSize = parsed.view.getUint32(record.dataOffset + 16, true)
    const isFillRgn = record.type === EMR_FILLRGN
    const regionDataOffset = record.dataOffset + (isFillRgn ? 24 : 20)
    const brush = isFillRgn
      ? realizeClassicBrushObject(runtime, resolveObject(runtime, parsed.view.getUint32(record.dataOffset + 20, true)))
      : runtime.getCurrentClassicBrush()
    const region = parseClassicRegionData(parsed.view, regionDataOffset, regionDataSize)

    if (brush && region.geometry.length > 0 && typeof backend.fillGeometry === 'function') {
      backend.fillGeometry(region.geometry, brush, runtime.getCurrentClassicFillOptions())
    }

    return true
  }

  if (record.type === EMR_GRADIENTFILL) {
    return handleGradientFill(parsed, runtime, backend, record)
  }

  if (record.type === EMR_POLYDRAW) {
    // rclBounds(16) cptl(4) aptl[cptl] (POINTL) abTypes[cptl] (bytes).
    const points = readPointLArray(parsed.view, record)
    const typesOffset = record.dataOffset + 20 + points.length * 8
    const types = readViewBytes(parsed.view, typesOffset, points.length) ?? new Uint8Array(points.length)
    const path = buildPolyDrawGeometry(points, types)

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)
    } else {
      const brush = runtime.getCurrentClassicBrush()
      const pen = runtime.getCurrentClassicStroke()

      if (brush) {
        backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
      }

      if (pen) {
        backend.strokePath?.(path, pen)
      }
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_SELECTCLIPPATH) {
    if (runtime.classicPathMode !== 'ready') {
      return true
    }

    const mode = readClassicClipMode(parsed.view.getUint32(record.dataOffset, true))
    const path = consumeClassicPath(runtime)
    return applyClassicClipOperation(runtime, backend, { kind: 'path', path, fillMode: runtime.classicState.fillMode }, mode)
  }

  if (record.type === EMR_POLYGON || record.type === EMR_POLYLINE) {
    const points = readPointLArray(parsed.view, record)
    const path = createPathGeometry(points, {
      closed: record.type === EMR_POLYGON
    })

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)

      if (points.length > 0) {
        updateClassicCurrentPosition(runtime, points[points.length - 1])
      }

      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (record.type === EMR_POLYGON && brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYGON16 || record.type === EMR_POLYLINE16) {
    const points = readPointSArray(parsed.view, record)
    const path = createPathGeometry(points, {
      closed: record.type === EMR_POLYGON16
    })

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, path)

      if (points.length > 0) {
        updateClassicCurrentPosition(runtime, points[points.length - 1])
      }

      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (record.type === EMR_POLYGON16 && brush) {
      backend.fillPath?.(path, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen) {
      backend.strokePath?.(path, pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYLINETO) {
    const points = readPointLArray(parsed.view, record)

    if (runtime.classicPathMode === 'building') {
      for (const point of points) {
        appendClassicLine(runtime, point)
      }

      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    const start = runtime.classicState.currentPos ?? { x: 0, y: 0 }

    if (pen && points.length > 0) {
      backend.strokePath?.(createPolylineToGeometry(start, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYLINETO16) {
    const points = readPointSArray(parsed.view, record)

    if (runtime.classicPathMode === 'building') {
      for (const point of points) {
        appendClassicLine(runtime, point)
      }

      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    const start = runtime.classicState.currentPos ?? { x: 0, y: 0 }

    if (pen && points.length > 0) {
      backend.strokePath?.(createPolylineToGeometry(start, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYBEZIER) {
    const points = readPointLArray(parsed.view, record)
    const pen = runtime.getCurrentClassicStroke()

    if (pen && points.length >= 4) {
      backend.strokePath?.(createBezierPathGeometry(points[0], points.slice(1)), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYBEZIER16) {
    const points = readPointSArray(parsed.view, record)
    const pen = runtime.getCurrentClassicStroke()

    if (pen && points.length >= 4) {
      backend.strokePath?.(createBezierPathGeometry(points[0], points.slice(1)), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYBEZIERTO) {
    const points = readPointLArray(parsed.view, record)

    if (runtime.classicPathMode === 'building') {
      appendClassicBezier(runtime, points)
      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    const start = runtime.classicState.currentPos ?? { x: 0, y: 0 }

    if (pen && points.length >= 3) {
      backend.strokePath?.(createBezierPathGeometry(start, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYBEZIERTO16) {
    const points = readPointSArray(parsed.view, record)

    if (runtime.classicPathMode === 'building') {
      appendClassicBezier(runtime, points)
      return true
    }

    const pen = runtime.getCurrentClassicStroke()
    const start = runtime.classicState.currentPos ?? { x: 0, y: 0 }

    if (pen && points.length >= 3) {
      backend.strokePath?.(createBezierPathGeometry(start, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYPOLYLINE) {
    const polyCount = parsed.view.getUint32(record.dataOffset + 16, true)
    const counts = readPolyCountsAt(parsed.view, record.dataOffset + 24, polyCount)
    const pointsOffset = record.dataOffset + 24 + counts.length * 4
    const totalPoints = counts.reduce((sum, count) => sum + count, 0)
    const points = readPointLArrayAt(parsed.view, pointsOffset, totalPoints)

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, createPolyPolylineGeometry(counts, points))

      if (points.length > 0) {
        updateClassicCurrentPosition(runtime, points[points.length - 1])
      }

      return true
    }

    const pen = runtime.getCurrentClassicStroke()

    if (pen && points.length > 0) {
      backend.strokePath?.(createPolyPolylineGeometry(counts, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYPOLYLINE16) {
    const counts = readPolyCounts(parsed.view, record)
    const pointsOffset = record.dataOffset + SMALL_POLY_COUNTS_OFFSET + counts.length * 4
    const totalPoints = counts.reduce((sum, count) => sum + count, 0)
    const points = readPointSArrayAt(parsed.view, pointsOffset, totalPoints)

    if (runtime.classicPathMode === 'building') {
      let cursor = 0

      for (const count of counts) {
        const figurePoints = points.slice(cursor, cursor + count)
        cursor += count

        if (figurePoints.length === 0) {
          continue
        }

        runtime.classicPath.moveTo(figurePoints[0].x, figurePoints[0].y)

        for (const point of figurePoints.slice(1)) {
          runtime.classicPath.lineTo(point.x, point.y)
        }
      }

      if (points.length > 0) {
        updateClassicCurrentPosition(runtime, points[points.length - 1])
      }

      return true
    }

    const pen = runtime.getCurrentClassicStroke()

    if (pen && points.length > 0) {
      backend.strokePath?.(createPolyPolylineGeometry(counts, points), pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_POLYPOLYGON || record.type === EMR_POLYPOLYGON16) {
    const isSmall = record.type === EMR_POLYPOLYGON16
    const polyCount = parsed.view.getUint32(record.dataOffset + 16, true)
    const counts = readPolyCountsAt(parsed.view, record.dataOffset + 24, polyCount)
    const pointsOffset = record.dataOffset + 24 + counts.length * 4
    const totalPoints = counts.reduce((sum, count) => sum + count, 0)
    const points = isSmall
      ? readPointSArrayAt(parsed.view, pointsOffset, totalPoints)
      : readPointLArrayAt(parsed.view, pointsOffset, totalPoints)
    const geometry = createPolyPolylineGeometry(counts, points)

    for (const figure of geometry.figures) {
      figure.closed = true
    }

    if (runtime.classicPathMode === 'building') {
      appendClassicPathGeometry(runtime, geometry)

      if (points.length > 0) {
        updateClassicCurrentPosition(runtime, points[points.length - 1])
      }

      return true
    }

    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (brush && points.length > 0) {
      backend.fillPath?.(geometry, brush, runtime.getCurrentClassicFillOptions())
    }

    if (pen && points.length > 0) {
      backend.strokePath?.(geometry, pen)
    }

    if (points.length > 0) {
      updateClassicCurrentPosition(runtime, points[points.length - 1])
    }

    return true
  }

  if (record.type === EMR_SETPIXELV) {
    const point = readPointL(parsed.view, record)
    // Recognized record; a missing backend method is a capability gap, not an
    // unsupported record. Degrade with a diagnostic instead of returning false.
    return drawOrReportCapability(
      runtime,
      backend,
      'fillRect',
      () =>
        backend.fillRect(
          {
            left: point.x,
            top: point.y,
            right: point.x + 1,
            bottom: point.y + 1
          },
          {
            kind: 'brush',
            type: 'solid',
            color: readColorRef(parsed.view.getUint32(record.dataOffset + 8, true))
          }
        ),
      'EMR_SETPIXELV'
    )
  }

  if (record.type === EMR_EXTTEXTOUTW || record.type === EMR_EXTTEXTOUTA) {
    const textRecord = readClassicExtText(parsed, record, runtime, record.type === EMR_EXTTEXTOUTW)

    if (!textRecord || !textRecord.text) {
      return true
    }

    if ((textRecord.options & ETO_OPAQUE) !== 0 && runtime.classicState.bkMode === BACKGROUND_MODE_OPAQUE) {
      backend.fillRect?.(textRecord.opaqueRect, {
        kind: 'brush',
        type: 'solid',
        color: runtime.classicState.bkColor
      })
    }

    const alignment = mapGdiTextAlignToCanvas(runtime.classicState.textAlign)
    // With TA_UPDATECP the reference point in the record is ignored and the run
    // is laid out from the current position set by the last MoveToEx / drawing
    // record. Without it, the record's own reference point applies.
    const referencePoint = alignment.updateCurrentPosition
      ? { x: runtime.classicState.currentPos.x, y: runtime.classicState.currentPos.y }
      : textRecord.referencePoint
    const layoutDirectionRightToLeft = (runtime.classicState.layoutMode & LAYOUT_RTL) !== 0
    const textAlign =
      layoutDirectionRightToLeft && alignment.textAlign !== 'center'
        ? alignment.textAlign === 'left'
          ? 'right'
          : 'left'
        : alignment.textAlign
    const font = runtime.selectedFont
    const advanceDx = resolveClassicTextAdvances(textRecord, layoutDirectionRightToLeft)
    const brush = {
      kind: 'brush',
      type: 'solid',
      color: runtime.classicState.textColor
    }

    backend.drawText?.(
      textRecord.text,
      {
        x: referencePoint.x,
        y: referencePoint.y,
        width: 0,
        height: 0
      },
      font,
      brush,
      {
        ...alignment,
        textAlign,
        directionRightToLeft: layoutDirectionRightToLeft,
        layoutMode: runtime.classicState.layoutMode,
        referencePoint,
        advanceDx,
        referencePointMode: layoutDirectionRightToLeft ? 'rtl' : 'ltr',
        textJustificationExtra: runtime.classicState.textJustificationExtra,
        textJustificationCount: runtime.classicState.textJustificationCount,
        addWarning(message) {
          addWarning(runtime, message)
        },
        transform:
          Number.isFinite(font?.escapement) && font.escapement !== 0
            ? createRotationAroundPointMatrix(-font.escapement / 10, referencePoint)
            : undefined
      }
    )

    if (alignment.updateCurrentPosition) {
      advanceClassicTextPosition(runtime, textRecord, referencePoint, layoutDirectionRightToLeft)
    }

    return true
  }

  if (
    record.type === EMR_BITBLT ||
    record.type === EMR_SETDIBITSTODEVICE ||
    record.type === EMR_STRETCHBLT ||
    record.type === EMR_STRETCHDIBITS ||
    record.type === EMR_ALPHABLEND ||
    record.type === EMR_TRANSPARENTBLT
  ) {
    return handleClassicRasterRecord(parsed, runtime, backend, record)
  }

  if (record.type === EMR_MASKBLT) {
    return handleUnsupportedClassicRasterRecord(runtime, record, 'classic-mask-blit')
  }

  if (record.type === EMR_PLGBLT) {
    return handleUnsupportedClassicRasterRecord(runtime, record, 'classic-parallelogram-blit')
  }

  return false
}
