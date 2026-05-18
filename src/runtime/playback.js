import { GraphicsState } from './graphics-state.js'
import { ensureImageSurface } from './image-surface.js'
import { ObjectStore } from './object-store.js'
import { dispatchRecord, isClassicDrawingRecord, resolveClassicStockObject } from './dispatch-record.js'
import { readRectLAt } from './dispatch/shared.js'
import { TransformState } from './transform-state.js'
import { PathBuilder, clonePoint } from './path-builder.js'
import { cloneValue } from './clone-value.js'
import { parseEmf } from '../emf/parse-emf.js'
import { decodeEmfPlusObject } from '../emfplus/object-decoders/index.js'
import { EmfPlusRecordType } from '../emfplus/constants.js'
import { parseWmf } from '../wmf/parse-wmf.js'
import { playParsedWmf } from '../wmf/playback.js'
import { CanvasBackend } from '../backends/canvas-backend.js'
import {
  EMR_DELETEOBJECT,
  EMR_RECTANGLE,
  EMR_RESTOREDC,
  EMR_SAVEDC
} from '../emf/constants.js'

const MAP_MODE_TEXT = 0x01
const BACKGROUND_MODE_OPAQUE = 0x02
const ROP2_COPY_PEN = 0x0d
const STRETCH_MODE_COLOR_ON_COLOR = 0x03
const STOCK_WHITE_BRUSH = 0x80000000
const STOCK_BLACK_PEN = 0x80000007
const STOCK_SYSTEM_FONT = 0x8000000d
const PREFETCHABLE_BITMAP_COMPRESSIONS = new Set(['jpeg', 'gif', 'bmp'])

function resolveRecordOffset(record) {
  if (Number.isFinite(record?.offset)) {
    return record.offset
  }

  if (Number.isFinite(record?.dataOffset)) {
    return record.source === 'emfplus' ? record.dataOffset - 12 : record.dataOffset - 8
  }

  return undefined
}

function createDiagnostic(runtime, level, message, details = {}) {
  const record = details.record ?? runtime.currentRecord ?? null
  const source = details.source ?? record?.source
  const recordType = details.recordType ?? record?.type
  const diagnostic = {
    level,
    code: details.code ?? (level === 'unsupported' ? 'unsupported-record' : 'runtime-warning'),
    message
  }

  if (source !== undefined) {
    diagnostic.source = source
  }

  if (recordType !== undefined) {
    diagnostic.recordType = recordType
  }

  const recordOffset = details.recordOffset ?? resolveRecordOffset(record)

  if (recordOffset !== undefined) {
    diagnostic.recordOffset = recordOffset
  }

  if (details.objectId !== undefined) {
    diagnostic.objectId = details.objectId
  }

  if (details.capability !== undefined) {
    diagnostic.capability = details.capability
  }

  if (details.reason !== undefined) {
    diagnostic.reason = details.reason
  }

  return diagnostic
}

export function addRuntimeWarning(runtime, message, details = {}) {
  runtime.warnings.push(message)
  runtime.diagnostics?.push(createDiagnostic(runtime, 'warning', message, details))
}

function addWarning(runtime, message, details = {}) {
  addRuntimeWarning(runtime, message, details)
}

function formatUnsupportedRecord(record) {
  return `${record.source}:0x${record.type.toString(16)}`
}

function getErrorReason(error) {
  if (error?.message) {
    return error.message
  }

  return String(error)
}

function isOutOfBoundsPlaybackError(error) {
  const reason = getErrorReason(error)

  return (
    error instanceof RangeError ||
    /out of bounds/i.test(reason) ||
    /outside the bounds/i.test(reason)
  )
}

function isEmfPlusObjectDecodeRecord(record) {
  return (
    record?.source === 'emfplus' &&
    (record.type === EmfPlusRecordType.Object || record.type === EmfPlusRecordType.SerializableObject)
  )
}

const EMFPLUS_OBJECT_ID_RECORDS = new Set([
  EmfPlusRecordType.Object,
  EmfPlusRecordType.SetClipRegion,
  EmfPlusRecordType.SetClipPath,
  EmfPlusRecordType.FillRects,
  EmfPlusRecordType.DrawLines,
  EmfPlusRecordType.DrawRects,
  EmfPlusRecordType.FillPolygon,
  EmfPlusRecordType.DrawBeziers,
  EmfPlusRecordType.FillEllipse,
  EmfPlusRecordType.DrawEllipse,
  EmfPlusRecordType.DrawArc,
  EmfPlusRecordType.FillRegion,
  EmfPlusRecordType.FillClosedCurve,
  EmfPlusRecordType.DrawPie,
  EmfPlusRecordType.FillPie,
  EmfPlusRecordType.DrawClosedCurve,
  EmfPlusRecordType.DrawCurve,
  EmfPlusRecordType.FillPath,
  EmfPlusRecordType.DrawPath,
  EmfPlusRecordType.StrokeFillPath,
  EmfPlusRecordType.DrawImagePoints,
  EmfPlusRecordType.DrawImage,
  EmfPlusRecordType.DrawString,
  EmfPlusRecordType.DrawDriverString
])

function resolveRecordObjectId(record) {
  if (
    record?.source === 'emfplus' &&
    Number.isFinite(record.flags) &&
    EMFPLUS_OBJECT_ID_RECORDS.has(record.type)
  ) {
    return record.flags & 0xff
  }

  return undefined
}

export function addUnsupportedRecord(runtime, record, details = {}) {
  const message = formatUnsupportedRecord(record)

  runtime.unsupported.push(message)
  runtime.diagnostics?.push(
    createDiagnostic(runtime, 'unsupported', message, {
      record,
      capability: 'record-dispatch',
      ...details
    })
  )
}

function addPlaybackError(runtime, record, error) {
  const reason = getErrorReason(error)
  let code = 'record-playback-error'

  if (isEmfPlusObjectDecodeRecord(record)) {
    code = 'object-decode-failed'
  } else if (isOutOfBoundsPlaybackError(error)) {
    code = 'record-decode-out-of-bounds'
  }

  addRuntimeWarning(runtime, `Recovered playback error in ${formatUnsupportedRecord(record)}: ${reason}`, {
    record,
    code,
    capability: 'record-playback',
    objectId: resolveRecordObjectId(record)
  })
}

function dispatchWithPlaybackBoundary(runtime, record, dispatch) {
  runtime.currentRecord = record

  try {
    return {
      handled: dispatch(),
      recovered: false
    }
  } catch (error) {
    addPlaybackError(runtime, record, error)
    return {
      handled: true,
      recovered: true
    }
  } finally {
    runtime.currentRecord = null
  }
}

function addPrefetchWarning(warnings, message) {
  if (Array.isArray(warnings)) {
    warnings.push(message)
    return
  }

  warnings?.addWarning?.(message)
}

function hasBrowserCompressedBitmapDecodeSupport() {
  return (
    typeof globalThis.createImageBitmap === 'function' &&
    typeof globalThis.Blob === 'function' &&
    typeof globalThis.OffscreenCanvas === 'function'
  )
}

function getCompressedBitmapBytes(image) {
  if (image.compressedBytes instanceof Uint8Array) {
    return image.compressedBytes
  }

  return image.bytes instanceof Uint8Array ? image.bytes : null
}

function isPrefetchableCompressedBitmap(image) {
  return (
    image?.kind === 'image' &&
    image.format === 'bitmap' &&
    PREFETCHABLE_BITMAP_COMPRESSIONS.has(image.compression) &&
    !(image.pixels instanceof Uint8ClampedArray) &&
    getCompressedBitmapBytes(image) instanceof Uint8Array
  )
}

function collectCompressedBitmapImages(object, images = []) {
  if (!object || typeof object !== 'object') {
    return images
  }

  if (isPrefetchableCompressedBitmap(object)) {
    images.push(object)
  }

  if (object.kind === 'brush' && object.image) {
    collectCompressedBitmapImages(object.image, images)
  }

  if (object.kind === 'pen' && object.brush) {
    collectCompressedBitmapImages(object.brush, images)
  }

  return images
}

function getCompressedBitmapMimeType(image) {
  if (image.compression === 'jpeg') {
    return 'image/jpeg'
  }

  if (image.compression === 'gif') {
    return 'image/gif'
  }

  if (image.compression === 'bmp') {
    return 'image/bmp'
  }

  return 'application/octet-stream'
}

function resolveImageBitmapDimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback
}

async function prefetchCompressedBitmap(image, warnings) {
  const bytes = getCompressedBitmapBytes(image)

  if (!bytes) {
    return
  }

  let bitmap = null

  try {
    const blob = new globalThis.Blob([bytes], { type: getCompressedBitmapMimeType(image) })
    bitmap = await globalThis.createImageBitmap(blob)

    const width = resolveImageBitmapDimension(bitmap.width, image.width)
    const height = resolveImageBitmapDimension(bitmap.height, image.height)

    if (!(width > 0) || !(height > 0)) {
      throw new Error('decoded bitmap has invalid dimensions')
    }

    const canvas = new globalThis.OffscreenCanvas(width, height)
    const context = canvas.getContext?.('2d')

    if (
      !context ||
      typeof context.drawImage !== 'function' ||
      typeof context.getImageData !== 'function'
    ) {
      throw new Error('2D canvas pixel readback is unavailable')
    }

    context.clearRect?.(0, 0, width, height)
    context.drawImage(bitmap, 0, 0)

    const imageData = context.getImageData(0, 0, width, height)

    image.width = width
    image.height = height
    image.pixels = new Uint8ClampedArray(imageData.data)
    image.surface = null
  } catch (error) {
    const reason = error?.message ? error.message : String(error)
    addPrefetchWarning(
      warnings,
      `Failed to decode compressed EMF+ ${image.compression ?? 'unknown'} bitmap with browser native APIs: ${reason}`
    )
  } finally {
    bitmap?.close?.()
  }
}

export async function prefetchCompressedImages(parsed, warnings = []) {
  const hasNativeDecode = hasBrowserCompressedBitmapDecodeSupport()
  const tasks = []

  for (const record of parsed.records ?? []) {
    if (!record.emfPlusRecords) {
      continue
    }

    for (const subrecord of record.emfPlusRecords) {
      if (subrecord.type !== EmfPlusRecordType.Object) {
        continue
      }

      let object = subrecord.prefetchedObject

      if (!object) {
        try {
          object = decodeEmfPlusObject(subrecord, parsed)
        } catch (error) {
          const reason = error?.message ? error.message : String(error)
          addPrefetchWarning(warnings, `Failed to inspect EMF+ object for compressed bitmap prefetch: ${reason}`)
          continue
        }
      }

      const images = collectCompressedBitmapImages(object)

      if (images.length === 0) {
        continue
      }

      subrecord.prefetchedObject = object

      for (const image of images) {
        if (hasNativeDecode) {
          tasks.push(prefetchCompressedBitmap(image, warnings))
        } else {
          addPrefetchWarning(
            warnings,
            `Browser-native decode is unavailable for compressed EMF+ ${image.compression ?? 'unknown'} bitmap`
          )
        }
      }
    }
  }

  await Promise.all(tasks)
  return tasks.length
}

function resolveViewport(header = {}) {
  const bounds = header.bounds
  const width = bounds ? bounds.right - bounds.left : 0
  const height = bounds ? bounds.bottom - bounds.top : 0

  if (width > 0 && height > 0) {
    return {
      width,
      height,
      originX: bounds.left,
      originY: bounds.top
    }
  }

  return {
    width: header.deviceWidth || 1,
    height: header.deviceHeight || 1,
    originX: 0,
    originY: 0
  }
}

// Intentional twin of wmf/playback.js resolveOutputDimension. Kept duplicated:
// it is a trivial positive-finite clamp with no real drift risk, and the only
// cycle-safe shared home (runtime/playback imports wmf, wmf imports
// runtime/path-builder) would be a semantically mismatched leaf module.
function resolveOutputDimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function createClassicState() {
  return {
    windowOrg: { x: 0, y: 0 },
    windowExt: { x: 1, y: 1 },
    viewportOrg: { x: 0, y: 0 },
    viewportExt: { x: 1, y: 1 },
    brushOrg: { x: 0, y: 0 },
    fillMode: 'alternate',
    miterLimit: 10,
    stretchBltMode: STRETCH_MODE_COLOR_ON_COLOR,
    mapMode: MAP_MODE_TEXT,
    bkMode: BACKGROUND_MODE_OPAQUE,
    arcDirection: 1,
    rop2: ROP2_COPY_PEN,
    textAlign: 0,
    textColor: 'rgb(0, 0, 0)',
    bkColor: 'rgb(255, 255, 255)',
    layoutMode: 0,
    textJustificationExtra: 0,
    textJustificationCount: 0,
    classicMetaRegionGeometry: null,
    classicClipRegionGeometry: null,
    currentPos: { x: 0, y: 0 }
  }
}

function cloneClassicState(state) {
  return {
    windowOrg: clonePoint(state.windowOrg),
    windowExt: clonePoint(state.windowExt),
    viewportOrg: clonePoint(state.viewportOrg),
    viewportExt: clonePoint(state.viewportExt),
    brushOrg: clonePoint(state.brushOrg),
    fillMode: state.fillMode,
    miterLimit: state.miterLimit,
    stretchBltMode: state.stretchBltMode,
    mapMode: state.mapMode,
    bkMode: state.bkMode,
    arcDirection: state.arcDirection,
    rop2: state.rop2,
    textAlign: state.textAlign,
    textColor: state.textColor,
    bkColor: state.bkColor,
    layoutMode: state.layoutMode,
    textJustificationExtra: state.textJustificationExtra,
    textJustificationCount: state.textJustificationCount,
    classicMetaRegionGeometry: cloneValue(state.classicMetaRegionGeometry),
    classicClipRegionGeometry: cloneValue(state.classicClipRegionGeometry),
    currentPos: clonePoint(state.currentPos)
  }
}

function computeClassicMappingTransform(state) {
  // MM_TEXT maps logical units 1:1 to device pixels; GDI ignores any
  // SetWindowExtEx / SetViewportExtEx calls made in that mode. Deriving a scale
  // from the extents there collapses whole drawings to a point (e.g. a window
  // extent of 706 against the default viewport extent of 1 shrinks 704x576 of
  // content to a single pixel). Only the app-defined modes
  // (MM_ANISOTROPIC / MM_ISOTROPIC) take their scale from the extents.
  //
  // NOTE: the fixed metric modes (MM_LO/HIMETRIC, MM_LO/HIENGLISH, MM_TWIPS)
  // should derive scale from the device DPI rather than the extents; we keep the
  // extent-based mapping for them until a Windows GDI reference tier exists to
  // validate the physical scale.
  const usesExtentScaling = state.mapMode !== MAP_MODE_TEXT
  const scaleX = usesExtentScaling && state.windowExt.x !== 0 ? state.viewportExt.x / state.windowExt.x : 1
  const scaleY = usesExtentScaling && state.windowExt.y !== 0 ? state.viewportExt.y / state.windowExt.y : 1
  const translateX = state.viewportOrg.x - state.windowOrg.x * scaleX
  const translateY = state.viewportOrg.y - state.windowOrg.y * scaleY

  return [scaleX, 0, 0, scaleY, translateX, translateY]
}

// EMF+ SetPageTransform carries a PageUnit (MS-EMFPLUS UnitType) that converts
// page-space coordinates into device pixels. Pixel/Display/World map 1:1; the
// physical units scale by the device DPI. Dropping this collapses inch/mm/point
// content to a few pixels — e.g. LibreOffice's linear-gradient draws a 3-inch
// fill that, treated as 3 px, vanishes.
function pageUnitToDeviceScale(unit, dpi) {
  switch (unit) {
    case 3: // Point (1/72 inch)
      return dpi / 72
    case 4: // Inch
      return dpi
    case 5: // Document (1/300 inch)
      return dpi / 300
    case 6: // Millimeter
      return dpi / 25.4
    default: // World(0) / Display(1) / Pixel(2) / default 'pixel'
      return 1
  }
}

function applyCurrentTransform(runtime, backend) {
  const pageScale = runtime.state.current.pageScale || 1
  const unit = runtime.state.current.pageUnit
  const pageTransform = [
    pageScale * pageUnitToDeviceScale(unit, runtime.deviceDpiX ?? 96),
    0,
    0,
    pageScale * pageUnitToDeviceScale(unit, runtime.deviceDpiY ?? 96),
    0,
    0
  ]

  runtime.transform.setPageTransform(pageTransform)
  runtime.transform.setWorldTransform(runtime.state.current.worldTransform)
  backend.setTransform(runtime.transform.getEffectiveTransform())
}

function countClassicStateFrames(runtime) {
  return runtime.stateFrames.reduce((count, frame) => count + (frame.kind === 'classic' ? 1 : 0), 0)
}

function pushStateFrame(runtime, kind, emfToken = null) {
  const stateToken = runtime.state.save()
  const transformToken = runtime.transform.save()
  const classicLevel = kind === 'classic' ? countClassicStateFrames(runtime) + 1 : null

  runtime.stateFrames.push({
    kind,
    emfToken,
    classicLevel,
    stateToken,
    transformToken,
    classicState: cloneClassicState(runtime.classicState),
    classicPath: runtime.classicPath.toPathGeometry(),
    classicPathMode: runtime.classicPathMode,
    selectedBrushHandle: runtime.selectedBrushHandle,
    selectedPenHandle: runtime.selectedPenHandle,
    selectedFontHandle: runtime.selectedFontHandle,
    selectedPaletteHandle: runtime.selectedPaletteHandle
  })
}

function restoreStateFrame(runtime, backend, index) {
  const removedFrames = runtime.stateFrames.splice(index, runtime.stateFrames.length - index)
  const frame = removedFrames[0]
  const restoredBrush =
    frame.selectedBrushHandle === null ? null : (runtime.resolveClassicObject(frame.selectedBrushHandle) ?? null)
  const restoredPen =
    frame.selectedPenHandle === null ? null : (runtime.resolveClassicObject(frame.selectedPenHandle) ?? null)
  const restoredFont =
    frame.selectedFontHandle === null ? null : (runtime.resolveClassicObject(frame.selectedFontHandle) ?? null)
  const restoredPalette =
    frame.selectedPaletteHandle === null ? null : (runtime.resolveClassicObject(frame.selectedPaletteHandle) ?? null)
  const restoredBrushHandle = frame.selectedBrushHandle !== null && restoredBrush === null ? null : frame.selectedBrushHandle
  const restoredPenHandle = frame.selectedPenHandle !== null && restoredPen === null ? null : frame.selectedPenHandle
  const restoredFontHandle = frame.selectedFontHandle !== null && restoredFont === null ? null : frame.selectedFontHandle
  const restoredPaletteHandle =
    frame.selectedPaletteHandle !== null && restoredPalette === null ? null : frame.selectedPaletteHandle

  runtime.state.restore(frame.stateToken)
  runtime.transform.restore(frame.transformToken)
  runtime.classicState = cloneClassicState(frame.classicState)
  runtime.classicPath.restore(frame.classicPath)
  runtime.classicPathMode = frame.classicPathMode
  runtime.selectedBrushHandle = restoredBrushHandle
  runtime.selectedPenHandle = restoredPenHandle
  runtime.selectedFontHandle = restoredFontHandle
  runtime.selectedPaletteHandle = restoredPaletteHandle
  runtime.selectedBrush = restoredBrush?.isNull ? null : restoredBrush
  runtime.selectedPen = restoredPen?.isNull ? null : restoredPen
  runtime.selectedFont = restoredFont?.kind === 'font' ? restoredFont : null
  runtime.selectedPalette = restoredPalette?.kind === 'palette' ? restoredPalette : null
  for (const _removedFrame of removedFrames) {
    backend.restore()
  }

  runtime.applyTransform()
}

function findClassicRestoreFrameIndex(runtime, savedDc) {
  if (!Number.isInteger(savedDc) || savedDc === 0) {
    return -1
  }

  if (savedDc > 0) {
    return runtime.stateFrames.findLastIndex(
      (frame) => frame.kind === 'classic' && frame.classicLevel === savedDc
    )
  }

  let remaining = -savedDc

  for (let index = runtime.stateFrames.length - 1; index >= 0; index -= 1) {
    if (runtime.stateFrames[index].kind !== 'classic') {
      continue
    }

    remaining -= 1

    if (remaining === 0) {
      return index
    }
  }

  return -1
}

function dispatchLegacyClassicRecord(parsed, runtime, backend, record) {
  if (record.type === EMR_RECTANGLE) {
    const rect = readRectLAt(parsed.view, record.dataOffset)
    const brush = runtime.getCurrentClassicBrush()
    const pen = runtime.getCurrentClassicStroke()

    if (brush && typeof backend.fillRect === 'function') {
      backend.fillRect(rect, brush)
    }

    if (pen && typeof backend.strokeRect === 'function') {
      backend.strokeRect(rect, pen)
    }

    return true
  }

  if (record.type === EMR_SAVEDC) {
    pushStateFrame(runtime, 'classic')
    backend.save()
    return true
  }

  if (record.type === EMR_RESTOREDC) {
    // A truncated record has no SavedDC field; reading past dataOffset would
    // pick up the next record's header bytes (same bug class as the guarded
    // EMF+ SetPageTransform decode).
    if (record.dataSize < 4) {
      addWarning(runtime, `RestoreDC record is truncated (dataSize=${record.dataSize}); DC state left unchanged`, {
        code: 'record-decode-failed'
      })
      return true
    }

    const savedDc = parsed.view.getInt32(record.dataOffset, true)
    const index = findClassicRestoreFrameIndex(runtime, savedDc)

    if (index >= 0) {
      restoreStateFrame(runtime, backend, index)
      return true
    }

    // GDI's RestoreDC fails (returns FALSE) and leaves the DC unchanged for an
    // unmatched SavedDC; mirror that no-op but surface it as a diagnostic.
    addWarning(
      runtime,
      `RestoreDC ${savedDc} has no matching SaveDC frame (classic depth ${countClassicStateFrames(runtime)}); DC state left unchanged`,
      { code: 'restore-dc-unmatched' }
    )
    return true
  }

  if (record.type === EMR_DELETEOBJECT) {
    const handle = parsed.view.getUint32(record.dataOffset, true)

    runtime.objects.delete(handle)

    if (runtime.selectedBrushHandle === handle) {
      runtime.selectedBrush = null
      runtime.selectedBrushHandle = null
    }

    if (runtime.selectedPenHandle === handle) {
      runtime.selectedPen = null
      runtime.selectedPenHandle = null
    }

    if (runtime.selectedFontHandle === handle) {
      runtime.selectedFont = null
      runtime.selectedFontHandle = null
    }

    if (runtime.selectedPaletteHandle === handle) {
      runtime.selectedPalette = null
      runtime.selectedPaletteHandle = null
    }

    return true
  }

  return false
}

export function createPlaybackRuntime(parsed, backend, options = {}) {
  const runtime = {
    state: new GraphicsState(),
    transform: new TransformState(),
    objects: new ObjectStore(),
    baseTransform: null,
    clipUniverseRect: null,
    classicState: createClassicState(),
    classicPath: new PathBuilder(),
    classicPathMode: 'idle',
    stateFrames: [],
    selectedBrush: null,
    selectedBrushHandle: STOCK_WHITE_BRUSH,
    selectedPen: resolveClassicStockObject(STOCK_BLACK_PEN),
    selectedPenHandle: STOCK_BLACK_PEN,
    selectedFont: resolveClassicStockObject(STOCK_SYSTEM_FONT),
    selectedFontHandle: STOCK_SYSTEM_FONT,
    selectedPalette: null,
    selectedPaletteHandle: null,
    imageSurfaceContext: null,
    warnings: [],
    unsupported: [],
    diagnostics: [],
    allowClassicDrawingRecords: !parsed.hasEmfPlus,
    currentEmfPlusBlockNeedsFallback: false,
    currentEmfPlusEffect: null
  }
  const viewport = resolveViewport(parsed.header)
  const outputWidth = resolveOutputDimension(options.width, viewport.width)
  const outputHeight = resolveOutputDimension(options.height, viewport.height)
  const scaleX = outputWidth / viewport.width
  const scaleY = outputHeight / viewport.height
  const translateX = viewport.originX === 0 ? 0 : -viewport.originX * scaleX
  const translateY = viewport.originY === 0 ? 0 : -viewport.originY * scaleY
  runtime.baseTransform = [scaleX, 0, 0, scaleY, translateX, translateY]
  // Device DPI (pixels per inch) for converting EMF+ page units to device space.
  // Derived from the metafile frame (physical size in 0.01mm) vs the device
  // bounds; defaults to 96 when the frame is missing/degenerate.
  const frame = parsed.header?.frame
  const frameWidth = frame ? frame.right - frame.left : 0
  const frameHeight = frame ? frame.bottom - frame.top : 0
  runtime.deviceDpiX = frameWidth > 0 ? (viewport.width * 2540) / frameWidth : 96
  runtime.deviceDpiY = frameHeight > 0 ? (viewport.height * 2540) / frameHeight : 96
  runtime.clipUniverseRect = {
    x: viewport.originX,
    y: viewport.originY,
    width: viewport.width,
    height: viewport.height
  }
  runtime.transform.setOutputTransform(runtime.baseTransform)
  runtime.resolveClassicObject = (handle) => runtime.objects.get(handle) ?? resolveClassicStockObject(handle)
  runtime.selectedBrush = resolveClassicStockObject(STOCK_WHITE_BRUSH)
  runtime.imageSurfaceContext = {
    createSurface(width, height) {
      return typeof backend.createSurface === 'function' ? backend.createSurface(width, height) : null
    },
    createBackend(target) {
      return new CanvasBackend(target)
    },
    parseEmf,
    playEmf(nestedParsed, nestedBackend, nestedOptions = {}) {
      return playParsedMetafile(nestedParsed, nestedBackend, nestedOptions)
    },
    parseWmf,
    playWmf(nestedParsed, nestedBackend, nestedOptions = {}) {
      return playParsedWmf(nestedParsed, nestedBackend, nestedOptions)
    },
    addWarning(message, details = {}) {
      addWarning(runtime, message, details)
    }
  }
  runtime.addWarning = (message, details = {}) => addWarning(runtime, message, details)
  runtime.addUnsupportedRecord = (record, details = {}) => addUnsupportedRecord(runtime, record, details)
  runtime.ensureImageSurface = (image, hint = null) => ensureImageSurface(image, runtime.imageSurfaceContext, hint)
  runtime.getCurrentClassicBrush = () => {
    if (!runtime.selectedBrush) {
      return null
    }

    if (runtime.selectedBrush.type === 'texture' && runtime.selectedBrush.image) {
      const image = runtime.ensureImageSurface(runtime.selectedBrush.image)

      if (image !== runtime.selectedBrush.image) {
        return {
          ...runtime.selectedBrush,
          image
        }
      }
    }

    return runtime.selectedBrush
  }
  runtime.getCurrentClassicFillOptions = () => ({ fillMode: runtime.classicState.fillMode })
  runtime.getCurrentClassicStroke = () =>
    runtime.selectedPen
      ? {
          ...runtime.selectedPen,
          miterLimit: runtime.classicState.miterLimit,
          ...(runtime.classicState.rop2 === ROP2_COPY_PEN ? {} : { rop2: runtime.classicState.rop2 })
        }
      : null
  runtime.applyTransform = () => applyCurrentTransform(runtime, backend)
  runtime.applyGraphicsState = (record = null) => {
    backend.applyGraphicsState?.(runtime.state.current, {
      source: record?.source,
      recordType: record?.type,
      classicRop2: record?.source === 'emf' ? runtime.classicState.rop2 : null,
      addWarning(message) {
        addWarning(runtime, message)
      }
    })
  }
  runtime.pushStateFrame = (kind, emfToken = null) => {
    pushStateFrame(runtime, kind, emfToken)
    backend.save?.()
    return true
  }
  runtime.restoreStateFrameByToken = (kind, token) => {
    const index = runtime.stateFrames.findLastIndex((entry) => entry.kind === kind && entry.emfToken === token)

    if (index === -1) {
      return false
    }

    restoreStateFrame(runtime, backend, index)
    return true
  }
  runtime.updateClassicMapping = () => {
    runtime.transform.setMappingTransform(computeClassicMappingTransform(runtime.classicState))
    runtime.applyTransform()
  }

  backend.resize(outputWidth, outputHeight)
  backend.clear()
  runtime.applyTransform()

  return runtime
}

function withRecordSource(record, source) {
  if (record.source === source) {
    return record
  }

  return { ...record, source }
}

export function playParsedMetafile(parsed, backend, options = {}) {
  const runtime = createPlaybackRuntime(parsed, backend, options)

  for (const record of parsed.records) {
    if (record.emfPlusRecords) {
      if (parsed.hasEmfPlus) {
        runtime.allowClassicDrawingRecords = false
        runtime.currentEmfPlusBlockNeedsFallback = false
      }

      for (const subrecord of record.emfPlusRecords) {
        const sourcedSubrecord = withRecordSource(subrecord, 'emfplus')

        const result = dispatchWithPlaybackBoundary(runtime, sourcedSubrecord, () =>
          dispatchRecord(parsed, runtime, backend, sourcedSubrecord)
        )

        if (result.recovered) {
          runtime.currentEmfPlusBlockNeedsFallback = true
          continue
        }

        if (result.handled) {
          continue
        }

        runtime.currentEmfPlusBlockNeedsFallback = true
        addUnsupportedRecord(runtime, sourcedSubrecord)
      }

      if (parsed.hasEmfPlus && !runtime.allowClassicDrawingRecords) {
        runtime.allowClassicDrawingRecords = runtime.currentEmfPlusBlockNeedsFallback
      }

      continue
    }

    if (parsed.hasEmfPlus && !runtime.allowClassicDrawingRecords && isClassicDrawingRecord(record)) {
      continue
    }

    const sourcedRecord = withRecordSource(record, 'emf')

    const result = dispatchWithPlaybackBoundary(runtime, sourcedRecord, () => {
      if (dispatchRecord(parsed, runtime, backend, sourcedRecord)) {
        return true
      }

      return dispatchLegacyClassicRecord(parsed, runtime, backend, sourcedRecord)
    })

    if (result.handled) {
      continue
    }

    addUnsupportedRecord(runtime, sourcedRecord)
  }

  return runtime
}
