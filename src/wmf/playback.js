import {
  META_CREATEBRUSHINDIRECT,
  META_CREATEPENINDIRECT,
  META_DELETEOBJECT,
  META_ELLIPSE,
  META_INTERSECTCLIPRECT,
  META_LINETO,
  META_MOVETO,
  META_POLYGON,
  META_RESTOREDC,
  META_SAVEDC,
  META_SELECTOBJECT,
  META_SETBKCOLOR,
  META_SETBKMODE,
  META_SETROP2,
  META_SETTEXTALIGN,
  META_SETTEXTCOLOR,
  META_SETWINDOWEXT,
  META_SETWINDOWORG,
  META_ESCAPE
} from './constants.js'
import { clonePoint, createPathGeometry } from '../runtime/path-builder.js'
import { readColorRef } from '../emfplus/primitives.js'

// Intentional twin of runtime/playback.js resolveOutputDimension (see note
// there). Trivial clamp; no clean cycle-safe shared home.
function resolveOutputDimension(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function resolveViewport(header) {
  const width = header.bounds.right - header.bounds.left
  const height = header.bounds.bottom - header.bounds.top

  return {
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
    originX: header.bounds.left,
    originY: header.bounds.top
  }
}

function applyTransform(runtime, backend) {
  const width = runtime.windowExtent.x || runtime.viewport.width || 1
  const height = runtime.windowExtent.y || runtime.viewport.height || 1
  const scaleX = runtime.outputWidth / width
  const scaleY = runtime.outputHeight / height
  const translateX = -runtime.windowOrigin.x * scaleX
  const translateY = -runtime.windowOrigin.y * scaleY

  backend.setTransform([scaleX, 0, 0, scaleY, translateX, translateY])
}

function allocateObject(runtime, object) {
  const index = runtime.objects.findIndex((entry) => entry === null)

  if (index === -1) {
    runtime.objects.push(object)
    return runtime.objects.length - 1
  }

  runtime.objects[index] = object
  return index
}

function readRect(params) {
  return {
    left: params[3],
    top: params[2],
    right: params[1],
    bottom: params[0]
  }
}

function readPointPair(params) {
  return {
    x: params[1],
    y: params[0]
  }
}

function readPolygonPoints(params) {
  const count = params[0]
  const points = []

  for (let index = 0; index < count; index += 1) {
    const base = 1 + index * 2

    if (base + 1 >= params.length) {
      break
    }

    points.push({
      x: params[base],
      y: params[base + 1]
    })
  }

  return points
}

function pushStateFrame(runtime) {
  runtime.frames.push({
    selectedBrushHandle: runtime.selectedBrushHandle,
    selectedPenHandle: runtime.selectedPenHandle,
    currentPoint: clonePoint(runtime.currentPoint),
    windowOrigin: { ...runtime.windowOrigin },
    windowExtent: { ...runtime.windowExtent }
  })
}

function restoreStateFrame(runtime, backend, index) {
  const removedFrames = runtime.frames.splice(index)
  const frame = removedFrames[0]

  runtime.selectedBrushHandle = frame.selectedBrushHandle
  runtime.selectedPenHandle = frame.selectedPenHandle
  runtime.currentPoint = frame.currentPoint
  runtime.windowOrigin = frame.windowOrigin
  runtime.windowExtent = frame.windowExtent
  runtime.selectedBrush = frame.selectedBrushHandle === null ? null : runtime.objects[frame.selectedBrushHandle] ?? null
  runtime.selectedPen = frame.selectedPenHandle === null ? null : runtime.objects[frame.selectedPenHandle] ?? null

  for (const _removedFrame of removedFrames) {
    backend.restore()
  }

  applyTransform(runtime, backend)
}

// Twin of runtime/playback.js findClassicRestoreFrameIndex, minus the
// frame-kind filter: the WMF stack never interleaves EMF+ frames, so a
// frame's SaveDC level is always index + 1 and both nSavedDC forms reduce to
// index math (negative walks down from the top, positive names the level
// SaveDC assigned).
function findRestoreFrameIndex(runtime, savedDc) {
  if (!Number.isInteger(savedDc) || savedDc === 0) {
    return -1
  }

  const index = savedDc > 0 ? savedDc - 1 : runtime.frames.length + savedDc
  return index >= 0 && index < runtime.frames.length ? index : -1
}

function addWarning(runtime, record, message, code) {
  runtime.warnings.push(message)

  const diagnostic = {
    level: 'warning',
    code,
    message,
    source: 'wmf',
    recordType: record.type
  }

  if (Number.isFinite(record.offset)) {
    diagnostic.recordOffset = record.offset
  }

  runtime.diagnostics.push(diagnostic)
}

function createBrush(record, parsed) {
  const style = parsed.view.getUint16(record.dataOffset, true)
  const color = parsed.view.getUint32(record.dataOffset + 2, true)

  return {
    kind: 'brush',
    style,
    color: readColorRef(color)
  }
}

function createPen(record, parsed) {
  const style = parsed.view.getUint16(record.dataOffset, true)
  const width = Math.abs(parsed.view.getInt16(record.dataOffset + 2, true)) || 1
  const color = parsed.view.getUint32(record.dataOffset + 6, true)

  return {
    kind: 'pen',
    style,
    width,
    color: readColorRef(color)
  }
}

function isVisibleBrush(brush) {
  return brush && brush.style !== 1
}

function isVisiblePen(pen) {
  return pen && (pen.style & 0x000f) !== 5
}

export function playParsedWmf(parsed, backend, options = {}) {
  const viewport = resolveViewport(parsed.header)
  const outputWidth = resolveOutputDimension(options.width, viewport.width)
  const outputHeight = resolveOutputDimension(options.height, viewport.height)
  const runtime = {
    viewport,
    outputWidth,
    outputHeight,
    windowOrigin: {
      x: viewport.originX,
      y: viewport.originY
    },
    windowExtent: {
      x: viewport.width,
      y: viewport.height
    },
    objects: Array.from({ length: parsed.header.objectCount || 0 }, () => null),
    selectedBrush: null,
    selectedBrushHandle: null,
    selectedPen: null,
    selectedPenHandle: null,
    currentPoint: null,
    frames: [],
    warnings: [],
    unsupported: [],
    diagnostics: []
  }

  backend.resize(outputWidth, outputHeight)
  backend.clear()
  applyTransform(runtime, backend)

  for (const record of parsed.records) {
    if (record.type === META_SETWINDOWORG) {
      runtime.windowOrigin = {
        x: record.params[1],
        y: record.params[0]
      }
      applyTransform(runtime, backend)
      continue
    }

    if (record.type === META_SETWINDOWEXT) {
      runtime.windowExtent = {
        x: record.params[1] || runtime.windowExtent.x,
        y: record.params[0] || runtime.windowExtent.y
      }
      applyTransform(runtime, backend)
      continue
    }

    if (record.type === META_SAVEDC) {
      pushStateFrame(runtime)
      backend.save()
      continue
    }

    if (record.type === META_RESTOREDC) {
      // A truncated record carries no nSavedDC parameter; without this guard
      // it would fall through as an undefined value and misreport as an
      // unmatched restore instead of a decode failure.
      if (record.params.length < 1) {
        addWarning(
          runtime,
          record,
          `RestoreDC record is truncated (dataSize=${record.dataSize}); DC state left unchanged`,
          'record-decode-failed'
        )
        continue
      }

      const savedDc = record.params[0]
      const index = findRestoreFrameIndex(runtime, savedDc)

      if (index >= 0) {
        restoreStateFrame(runtime, backend, index)
        continue
      }

      // GDI's RestoreDC fails (returns FALSE) and leaves the DC unchanged for
      // an unmatched nSavedDC; mirror that no-op but surface it as a
      // diagnostic.
      addWarning(
        runtime,
        record,
        `RestoreDC ${savedDc} has no matching SaveDC frame (stack depth ${runtime.frames.length}); DC state left unchanged`,
        'restore-dc-unmatched'
      )
      continue
    }

    if (record.type === META_CREATEBRUSHINDIRECT) {
      allocateObject(runtime, createBrush(record, parsed))
      continue
    }

    if (record.type === META_CREATEPENINDIRECT) {
      allocateObject(runtime, createPen(record, parsed))
      continue
    }

    if (record.type === META_SELECTOBJECT) {
      const handle = record.params[0] & 0xffff
      const object = runtime.objects[handle] ?? null

      if (object?.kind === 'brush') {
        runtime.selectedBrush = object
        runtime.selectedBrushHandle = handle
      }

      if (object?.kind === 'pen') {
        runtime.selectedPen = object
        runtime.selectedPenHandle = handle
      }

      continue
    }

    if (record.type === META_DELETEOBJECT) {
      const handle = record.params[0] & 0xffff

      runtime.objects[handle] = null

      if (runtime.selectedBrushHandle === handle) {
        runtime.selectedBrushHandle = null
        runtime.selectedBrush = null
      }

      if (runtime.selectedPenHandle === handle) {
        runtime.selectedPenHandle = null
        runtime.selectedPen = null
      }

      continue
    }

    if (record.type === META_ELLIPSE) {
      const rect = readRect(record.params)

      if (isVisibleBrush(runtime.selectedBrush)) {
        backend.fillEllipse(rect, runtime.selectedBrush)
      }

      if (isVisiblePen(runtime.selectedPen)) {
        backend.strokeEllipse(rect, runtime.selectedPen)
      }

      continue
    }

    if (record.type === META_POLYGON) {
      const points = readPolygonPoints(record.params)
      const path = createPathGeometry(points, { closed: true })
      path.kind = 'path'

      if (isVisibleBrush(runtime.selectedBrush)) {
        backend.fillPath(path, runtime.selectedBrush)
      }

      if (isVisiblePen(runtime.selectedPen)) {
        backend.strokePath(path, runtime.selectedPen)
      }

      continue
    }

    if (record.type === META_MOVETO) {
      runtime.currentPoint = readPointPair(record.params)
      continue
    }

    if (record.type === META_LINETO) {
      const nextPoint = readPointPair(record.params)

      if (runtime.currentPoint && isVisiblePen(runtime.selectedPen)) {
        backend.drawLine(runtime.currentPoint, nextPoint, runtime.selectedPen)
      }

      runtime.currentPoint = nextPoint
      continue
    }

    if (record.type === META_INTERSECTCLIPRECT) {
      const rect = readRect(record.params)

      backend.clipRect(
        {
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top
        },
        'intersect'
      )
      continue
    }

    if (
      record.type === META_SETBKMODE ||
      record.type === META_SETROP2 ||
      record.type === META_SETTEXTALIGN ||
      record.type === META_SETBKCOLOR ||
      record.type === META_SETTEXTCOLOR ||
      record.type === META_ESCAPE
    ) {
      continue
    }

    runtime.unsupported.push(`wmf:0x${record.type.toString(16)}`)
  }

  return runtime
}
