import { resolveRegionNodeGeometry } from '../../emfplus/object-decoders/region.js'
import { readColorRef, readMatrix } from '../../emfplus/primitives.js'
import { PathBuilder, createAngleArcPathGeometry, createArcPathGeometry, createPathGeometry } from '../path-builder.js'
import { combineRegions, pathToRegionGeometry, rectToRegionGeometry, translateRegionGeometry } from '../region-ops.js'
import {
  CLIP_REGION_MODE_AND,
  CLIP_REGION_MODE_COPY,
  CLIP_REGION_MODE_DIFF,
  CLIP_REGION_MODE_OR,
  CLIP_REGION_MODE_XOR,
  CREATE_PEN_COLOR_FALLBACK_OFFSET,
  CREATE_PEN_COLOR_OFFSET,
  EXT_CREATE_PEN_COLOR_OFFSET,
  PEN_ENDCAP_FLAT,
  PEN_ENDCAP_MASK,
  PEN_ENDCAP_SQUARE,
  PEN_JOIN_BEVEL,
  PEN_JOIN_MASK,
  PEN_JOIN_MITER,
  PEN_STYLE_DASH,
  PEN_STYLE_DASHDOT,
  PEN_STYLE_DASHDOTDOT,
  PEN_STYLE_DOT,
  PEN_STYLE_MASK,
  PEN_STYLE_USERSTYLE,
  POINT_EPSILON,
  SMALL_POLY_COUNTS_OFFSET,
  SMALL_POLY_POINT_COUNT_OFFSET,
  SMALL_POLY_POINT_SIZE,
  warnedUnknownObjects
} from './constants.js'

// Re-exported from the shared primitives so existing dispatch imports
// (classic.js) keep resolving readColorRef through shared.js.
export { readColorRef }

/**
 * Read a classic brush's color, skipping the brush style word; falls back to the
 * raw style value when it is not a plain solid color or the data is truncated.
 * @param {DataView} view
 * @param {{ dataOffset: number, dataSize: number }} record
 * @returns {number} A 0x00BBGGRR color reference (or the raw style value).
 */
export function readBrushColor(view, record) {
  const styleOrColor = view.getUint32(record.dataOffset + 4, true)

  if (styleOrColor > 0x00000009 || record.dataSize < 12) {
    return styleOrColor
  }

  return view.getUint32(record.dataOffset + 8, true)
}

/**
 * Read a classic CreatePen record's color, choosing the field offset by whether
 * the record carries the full LOGPEN layout or the shorter fallback form.
 * @param {DataView} view
 * @param {{ dataOffset: number, dataSize: number }} record
 * @returns {number} A 0x00BBGGRR color reference.
 */
export function readPenColor(view, record) {
  if (record.dataSize >= 20) {
    return view.getUint32(record.dataOffset + CREATE_PEN_COLOR_OFFSET, true)
  }

  return view.getUint32(record.dataOffset + CREATE_PEN_COLOR_FALLBACK_OFFSET, true)
}

/**
 * Read an ExtCreatePen record's color at the fixed ELP color offset.
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {number} A 0x00BBGGRR color reference.
 */
export function readExtPenColor(view, record) {
  return view.getUint32(record.dataOffset + EXT_CREATE_PEN_COLOR_OFFSET, true)
}

/**
 * Read a single POINTL (two little-endian Int32s) at the record's data start.
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {import('../types.js').PointL}
 */
export function readPointL(view, record) {
  return {
    x: view.getInt32(record.dataOffset, true),
    y: view.getInt32(record.dataOffset + 4, true)
  }
}

/**
 * Read a single RECTL (four little-endian Int32 edges) at the record's data start.
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {import('../types.js').RectL}
 */
export function readRectL(view, record) {
  return {
    left: view.getInt32(record.dataOffset, true),
    top: view.getInt32(record.dataOffset + 4, true),
    right: view.getInt32(record.dataOffset + 8, true),
    bottom: view.getInt32(record.dataOffset + 12, true)
  }
}

/**
 * Read an EMF arc-style record: its bounding box plus the start and end radial
 * points that define the swept angle.
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {{ box: import('../types.js').RectL, start: import('../types.js').PointL, end: import('../types.js').PointL }}
 */
export function readArcRecord(view, record) {
  return {
    box: readRectL(view, record),
    start: {
      x: view.getInt32(record.dataOffset + 16, true),
      y: view.getInt32(record.dataOffset + 20, true)
    },
    end: {
      x: view.getInt32(record.dataOffset + 24, true),
      y: view.getInt32(record.dataOffset + 28, true)
    }
  }
}

/**
 * Read an EMF AngleArc record: center point, radius, and start/sweep angles (degrees).
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {{ center: import('../types.js').PointL, radius: number, startAngle: number, sweepAngle: number }}
 */
export function readAngleArcRecord(view, record) {
  return {
    center: readPointL(view, record),
    radius: view.getUint32(record.dataOffset + 8, true),
    startAngle: view.getFloat32(record.dataOffset + 12, true),
    sweepAngle: view.getFloat32(record.dataOffset + 16, true)
  }
}

// Re-exported from the shared EMF+ primitives so existing dispatch imports
// (emfplus.js, classic.js) keep resolving readMatrix through shared.js.
export { readMatrix }

/**
 * Read `count` consecutive POINTL entries (8 bytes each) starting at `offset`.
 * @param {DataView} view
 * @param {number} offset Absolute byte offset of the first point.
 * @param {number} count Number of points to read.
 * @returns {import('../types.js').PointL[]}
 */
export function readPointLArrayAt(view, offset, count) {
  const points = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    points.push({
      x: view.getInt32(cursor, true),
      y: view.getInt32(cursor + 4, true)
    })
    cursor += 8
  }

  return points
}

/**
 * Read `count` consecutive POINTS entries (two Int16s each) starting at `offset`.
 * @param {DataView} view
 * @param {number} offset Absolute byte offset of the first point.
 * @param {number} count Number of points to read.
 * @returns {import('../types.js').PointL[]}
 */
export function readPointSArrayAt(view, offset, count) {
  const points = []
  let cursor = offset

  for (let index = 0; index < count; index += 1) {
    points.push({
      x: view.getInt16(cursor, true),
      y: view.getInt16(cursor + 2, true)
    })
    cursor += SMALL_POLY_POINT_SIZE
  }

  return points
}

/**
 * Read `polyCount` per-polygon vertex counts (Uint32 each) starting at `offset`.
 * @param {DataView} view
 * @param {number} offset Absolute byte offset of the first count.
 * @param {number} polyCount Number of counts to read.
 * @returns {number[]}
 */
export function readPolyCountsAt(view, offset, polyCount) {
  const counts = []
  let cursor = offset

  for (let index = 0; index < polyCount; index += 1) {
    counts.push(view.getUint32(cursor, true))
    cursor += 4
  }

  return counts
}

/**
 * Read a PolyPolyline/PolyPolygon record's per-polygon vertex counts, taking the
 * polygon count and counts array offsets from the record's data layout.
 * @param {DataView} view
 * @param {{ dataOffset: number }} record
 * @returns {number[]}
 */
export function readPolyCounts(view, record) {
  const polyCount = view.getUint32(record.dataOffset + SMALL_POLY_POINT_COUNT_OFFSET, true)
  const counts = []
  let cursor = record.dataOffset + SMALL_POLY_COUNTS_OFFSET

  for (let index = 0; index < polyCount; index += 1) {
    counts.push(view.getUint32(cursor, true))
    cursor += 4
  }

  return counts
}

/**
 * Read a single RECTL (four little-endian Int32 edges) at an absolute byte offset.
 * @param {DataView} view
 * @param {number} offset Absolute byte offset of the rect.
 * @returns {import('../types.js').RectL}
 */
export function readRectLAt(view, offset) {
  return {
    left: view.getInt32(offset, true),
    top: view.getInt32(offset + 4, true),
    right: view.getInt32(offset + 8, true),
    bottom: view.getInt32(offset + 12, true)
  }
}

/**
 * Build an affine matrix that rotates by `angleDegrees` about a fixed point.
 * @param {number} angleDegrees Rotation angle, in degrees.
 * @param {import('../types.js').PointL} point Pivot point held invariant by the rotation.
 * @returns {import('../types.js').Matrix}
 */
export function createRotationAroundPointMatrix(angleDegrees, point) {
  const angle = (angleDegrees * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const x = point.x
  const y = point.y

  return [
    cosine,
    sine,
    -sine,
    cosine,
    x - cosine * x + sine * y,
    y - sine * x - cosine * y
  ]
}

/**
 * Map a classic polygon fill-mode code to its canvas fill rule.
 * @param {number} value EMF fill-mode value (2 = WINDING).
 * @returns {'winding' | 'alternate'}
 */
export function readClassicFillMode(value) {
  return value === 2 ? 'winding' : 'alternate'
}

/**
 * Map a classic region-combine mode code to its clip operation name.
 * @param {number} value RGN_* combine-mode value; unknown values default to 'replace'.
 * @returns {'intersect' | 'union' | 'xor' | 'exclude' | 'replace'}
 */
export function readClassicClipMode(value) {
  return (
    {
      [CLIP_REGION_MODE_AND]: 'intersect',
      [CLIP_REGION_MODE_OR]: 'union',
      [CLIP_REGION_MODE_XOR]: 'xor',
      [CLIP_REGION_MODE_DIFF]: 'exclude',
      [CLIP_REGION_MODE_COPY]: 'replace'
    }[value] || 'replace'
  )
}

/**
 * Map the style bits of a classic pen style word to a dash-pattern name.
 * @param {number} style Pen style word; masked to its style bits.
 * @returns {'dash' | 'dot' | 'dashDot' | 'dashDotDot' | 'custom' | 'solid'}
 */
export function readClassicDashStyle(style) {
  return (
    {
      [PEN_STYLE_DASH]: 'dash',
      [PEN_STYLE_DOT]: 'dot',
      [PEN_STYLE_DASHDOT]: 'dashDot',
      [PEN_STYLE_DASHDOTDOT]: 'dashDotDot',
      [PEN_STYLE_USERSTYLE]: 'custom'
    }[style & PEN_STYLE_MASK] || 'solid'
  )
}

/**
 * Map the end-cap bits of a classic pen style word to a line-cap name.
 * @param {number} style Pen style word; masked to its end-cap bits.
 * @returns {'square' | 'butt' | 'round'}
 */
export function readClassicLineCap(style) {
  return (
    {
      [PEN_ENDCAP_SQUARE]: 'square',
      [PEN_ENDCAP_FLAT]: 'butt'
    }[style & PEN_ENDCAP_MASK] || 'round'
  )
}

/**
 * Map the join bits of a classic pen style word to a line-join name.
 * @param {number} style Pen style word; masked to its join bits.
 * @returns {'bevel' | 'miter' | 'round'}
 */
export function readClassicLineJoin(style) {
  return (
    {
      [PEN_JOIN_BEVEL]: 'bevel',
      [PEN_JOIN_MITER]: 'miter'
    }[style & PEN_JOIN_MASK] || 'round'
  )
}

/**
 * Record a playback warning, preferring the runtime's structured `addWarning`
 * hook and falling back to pushing the message onto `runtime.warnings`.
 * @param {object} runtime Playback runtime; reads `addWarning`/`warnings`.
 * @param {string} message Warning text.
 * @param {object} [details] Optional structured details for the warning hook.
 * @returns {void}
 */
export function addWarning(runtime, message, details = {}) {
  if (typeof runtime.addWarning === 'function') {
    runtime.addWarning(message, details)
    return
  }

  runtime.warnings?.push(message)
}

// ── Recognized-record return contract ────────────────────────────────────────
// A recognized record type must NEVER return false from the dispatch handlers.
// `return false` is reserved for genuinely unknown record types, which the
// dispatcher (playback.js) tallies as unsupported. When a recognized record
// cannot produce output, its arm degrades to a warning-level diagnostic and
// returns true, so the record is not mis-counted as unsupported. There are four
// degradation reasons, each carrying a stable diagnostic `code`:
//   • DOWNGRADE_OBJECT_UNRESOLVED — a referenced object (brush/pen/path/font/
//     region/image) resolved to null.
//   • DOWNGRADE_RECORD_DECODE_FAILED — the record's own payload could not be
//     decoded (too short, malformed, or out-of-range field values).
//   • DOWNGRADE_DEGENERATE_GEOMETRY — the decoded geometry has too few points
//     to draw anything.
//   • DOWNGRADE_CAPABILITY_UNAVAILABLE — the backend lacks the draw method the
//     record needs.
// Backend draw methods are always invoked through {@link drawOrReportCapability}
// or optional chaining, never bare, so a missing method degrades rather than
// throwing. This mirrors the classic drawing arms, handleClassicRasterOperation,
// and the EMF+ DrawImage surface-unavailable path.
export const DOWNGRADE_OBJECT_UNRESOLVED = 'emfplus-object-unresolved'
export const DOWNGRADE_RECORD_DECODE_FAILED = 'record-decode-failed'
export const DOWNGRADE_DEGENERATE_GEOMETRY = 'degenerate-geometry'
export const DOWNGRADE_CAPABILITY_UNAVAILABLE = 'capability-unavailable'

/**
 * Emit a warning-level downgrade diagnostic for a recognized record that could
 * not draw, and signal the dispatch arm to report the record as handled. Use
 * this instead of `return false`, which the dispatcher counts as unsupported.
 * @param {object} runtime Playback runtime.
 * @param {string} code One of the DOWNGRADE_* codes.
 * @param {string} message Human-readable reason.
 * @param {object} [details] Structured detail, e.g. { objectId, capability }.
 * @returns {true} Always true, so callers can `return reportRecordDowngrade(...)`.
 */
export function reportRecordDowngrade(runtime, code, message, details = {}) {
  addWarning(runtime, message, { code, ...details })
  return true
}

/**
 * Invoke a backend draw method when it is callable, otherwise emit a
 * capability-unavailable downgrade. Never throws on a missing method and never
 * returns false. The draw thunk is only run when `backend[method]` exists.
 * @param {object} runtime Playback runtime.
 * @param {object} backend Canvas backend.
 * @param {string} method Backend method name probed before drawing.
 * @param {() => void} draw Performs the actual backend call(s).
 * @param {string} label Record label used in the capability diagnostic.
 * @returns {true} Always true (the record is recognized and handled).
 */
export function drawOrReportCapability(runtime, backend, method, draw, label) {
  if (typeof backend?.[method] === 'function') {
    draw()
    return true
  }

  return reportRecordDowngrade(
    runtime,
    DOWNGRADE_CAPABILITY_UNAVAILABLE,
    `${label} skipped because backend.${method} is unavailable`,
    { capability: method }
  )
}

/**
 * Resolve a drawable image source for the backend, trying its `resolveImageSource`
 * hook then the image's `canvas`/`element` fields.
 * @param {object} backend Canvas backend; may expose `resolveImageSource`.
 * @param {object} image Parsed image object.
 * @returns {*} The resolved drawable source, or null if none is available.
 */
export function resolveBackendImageSource(backend, image) {
  return backend.resolveImageSource?.(image) ?? image?.canvas ?? image?.element ?? null
}

/**
 * Convert an origin-plus-size rect to an edge-defined RECTL.
 * @param {import('../types.js').Rect} rect
 * @returns {import('../types.js').RectL}
 */
export function toRectL(rect) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height
  }
}

/**
 * Test whether two points coincide within POINT_EPSILON on both axes.
 * @param {import('../types.js').PointL} left
 * @param {import('../types.js').PointL} right
 * @returns {boolean}
 */
export function pointsAreClose(left, right) {
  return Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.y - right.y) <= POINT_EPSILON
}

/**
 * Build path geometry for a PolyBezier: a moveTo at `startPoint` followed by
 * cubic curves consuming `points` in groups of three.
 * @param {import('../types.js').PointL} startPoint
 * @param {import('../types.js').PointL[]} points Control/end points, three per curve.
 * @returns {import('../types.js').PathGeometry}
 */
export function createBezierPathGeometry(startPoint, points) {
  const builder = new PathBuilder()

  builder.beginPath()
  builder.moveTo(startPoint.x, startPoint.y)

  for (let index = 0; index + 2 < points.length; index += 3) {
    builder.curveTo(points[index], points[index + 1], points[index + 2])
  }

  return builder.toPathGeometry()
}

/**
 * Build path geometry for a PolylineTo: a moveTo at `startPoint` then a lineTo
 * through each successive point.
 * @param {import('../types.js').PointL} startPoint
 * @param {import('../types.js').PointL[]} points
 * @returns {import('../types.js').PathGeometry}
 */
export function createPolylineToGeometry(startPoint, points) {
  const builder = new PathBuilder()

  builder.beginPath()
  builder.moveTo(startPoint.x, startPoint.y)

  for (const point of points) {
    builder.lineTo(point.x, point.y)
  }

  return builder.toPathGeometry()
}

/**
 * Build path geometry for a PolyPolyline: one open subpath per entry in `counts`,
 * each consuming that many points from the flat `points` array.
 * @param {number[]} counts Per-polyline vertex counts.
 * @param {import('../types.js').PointL[]} points Flat list of all vertices.
 * @returns {import('../types.js').PathGeometry}
 */
export function createPolyPolylineGeometry(counts, points) {
  const builder = new PathBuilder()
  let cursor = 0

  builder.beginPath()

  for (const count of counts) {
    const figurePoints = points.slice(cursor, cursor + count)
    cursor += count

    if (figurePoints.length === 0) {
      continue
    }

    builder.moveTo(figurePoints[0].x, figurePoints[0].y)

    for (const point of figurePoints.slice(1)) {
      builder.lineTo(point.x, point.y)
    }
  }

  return builder.toPathGeometry()
}

/**
 * Build closed path geometry for a rounded rectangle; falls back to a plain
 * rectangle when either corner radius collapses to zero.
 * @param {import('../types.js').RectL} rect
 * @param {number} cornerWidth Full corner ellipse width (radius is half).
 * @param {number} cornerHeight Full corner ellipse height (radius is half).
 * @returns {import('../types.js').PathGeometry}
 */
export function createRoundRectGeometry(rect, cornerWidth, cornerHeight) {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  const width = right - left
  const height = bottom - top
  const radiusX = Math.min(Math.abs(cornerWidth) / 2, width / 2)
  const radiusY = Math.min(Math.abs(cornerHeight) / 2, height / 2)

  if (!(radiusX > 0) || !(radiusY > 0)) {
    return createPathGeometry(
      [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom }
      ],
      { closed: true }
    )
  }

  return {
    figures: [
      {
        closed: true,
        points: [
          { x: left + radiusX, y: top },
          { x: right - radiusX, y: top },
          { x: right, y: top + radiusY },
          { x: right, y: bottom - radiusY },
          { x: right - radiusX, y: bottom },
          { x: left + radiusX, y: bottom },
          { x: left, y: bottom - radiusY },
          { x: left, y: top + radiusY }
        ],
        segments: [
          { type: 'line', point: { x: right - radiusX, y: top } },
          {
            type: 'arc',
            center: { x: right - radiusX, y: top + radiusY },
            radiusX,
            radiusY,
            rotation: 0,
            startAngle: -Math.PI / 2,
            endAngle: 0,
            counterclockwise: false,
            point: { x: right, y: top + radiusY }
          },
          { type: 'line', point: { x: right, y: bottom - radiusY } },
          {
            type: 'arc',
            center: { x: right - radiusX, y: bottom - radiusY },
            radiusX,
            radiusY,
            rotation: 0,
            startAngle: 0,
            endAngle: Math.PI / 2,
            counterclockwise: false,
            point: { x: right - radiusX, y: bottom }
          },
          { type: 'line', point: { x: left + radiusX, y: bottom } },
          {
            type: 'arc',
            center: { x: left + radiusX, y: bottom - radiusY },
            radiusX,
            radiusY,
            rotation: 0,
            startAngle: Math.PI / 2,
            endAngle: Math.PI,
            counterclockwise: false,
            point: { x: left, y: bottom - radiusY }
          },
          { type: 'line', point: { x: left, y: top + radiusY } },
          {
            type: 'arc',
            center: { x: left + radiusX, y: top + radiusY },
            radiusX,
            radiusY,
            rotation: 0,
            startAngle: Math.PI,
            endAngle: Math.PI * 1.5,
            counterclockwise: false,
            point: { x: left + radiusX, y: top }
          }
        ]
      }
    ]
  }
}

/**
 * Build ArcTo path geometry, prefixing a line from the current point to the arc's
 * start so the arc connects to the existing subpath.
 * @param {import('../types.js').Rect} rect Bounding box of the arc's ellipse.
 * @param {import('../types.js').PointL} currentPoint Current path position to line from.
 * @param {import('../types.js').PointL} start Arc start radial point.
 * @param {import('../types.js').PointL} end Arc end radial point.
 * @param {boolean} counterclockwise Sweep direction.
 * @returns {import('../types.js').PathGeometry}
 */
export function createArcToGeometry(rect, currentPoint, start, end, counterclockwise) {
  const arc = createArcPathGeometry(rect, start, end, { counterclockwise })
  const figure = arc.figures[0]
  const startPoint = figure?.points?.[0]

  if (!figure || !startPoint) {
    return arc
  }

  return {
    figures: [
      {
        closed: false,
        points: [currentPoint, startPoint, ...(figure.points.slice(1) ?? [])],
        segments: [{ type: 'line', point: startPoint }, ...(figure.segments ?? [])]
      }
    ]
  }
}

/**
 * Build AngleArc path geometry from a center/radius/angle description, prefixing a
 * line from the current point to the arc start unless they already coincide.
 * @param {{ center: import('../types.js').PointL, radius: number, startAngle: number, sweepAngle: number }} angleArc
 * @param {import('../types.js').PointL} currentPoint Current path position to line from.
 * @param {boolean} counterclockwise Sweep direction.
 * @returns {import('../types.js').PathGeometry}
 */
export function createAngleArcToGeometry(angleArc, currentPoint, counterclockwise) {
  const arc = createAngleArcPathGeometry(
    {
      x: angleArc.center.x - angleArc.radius,
      y: angleArc.center.y - angleArc.radius,
      width: angleArc.radius * 2,
      height: angleArc.radius * 2
    },
    angleArc.startAngle,
    angleArc.sweepAngle,
    { counterclockwise }
  )
  const figure = arc.figures[0]
  const startPoint = figure?.points?.[0]

  if (!figure || !startPoint || pointsAreClose(currentPoint, startPoint)) {
    return arc
  }

  return {
    figures: [
      {
        closed: false,
        points: [currentPoint, startPoint, ...(figure.points.slice(1) ?? [])],
        segments: [{ type: 'line', point: startPoint }, ...(figure.segments ?? [])]
      }
    ]
  }
}

/**
 * Append path geometry to the runtime's in-progress classic path, but only while
 * `classicPathMode` is 'building'; replays each figure's segments (or its raw
 * points) onto `runtime.classicPath`.
 * @param {object} runtime Playback runtime; reads `classicPathMode`, mutates `classicPath`.
 * @param {import('../types.js').PathGeometry} geometry
 * @returns {void}
 */
export function appendClassicPathGeometry(runtime, geometry) {
  if (!geometry || runtime.classicPathMode !== 'building') {
    return
  }

  for (const figure of geometry.figures ?? []) {
    const firstPoint = figure.points?.[0]

    if (!firstPoint) {
      continue
    }

    runtime.classicPath.moveTo(firstPoint.x, firstPoint.y)

    if (Array.isArray(figure.segments) && figure.segments.length > 0) {
      for (const segment of figure.segments) {
        if (segment.type === 'line') {
          runtime.classicPath.lineTo(segment.point.x, segment.point.y)
          continue
        }

        if (segment.type === 'bezier') {
          runtime.classicPath.curveTo(segment.control1, segment.control2, segment.point)
          continue
        }

        const currentFigure = runtime.classicPath.currentFigure

        if (!currentFigure) {
          continue
        }

        if (!Array.isArray(currentFigure.segments)) {
          currentFigure.segments = currentFigure.points.slice(1).map((point) => ({
            type: 'line',
            point: { x: point.x, y: point.y }
          }))
        }

        currentFigure.segments.push({
          ...segment,
          center: segment.center ? { x: segment.center.x, y: segment.center.y } : segment.center,
          point: segment.point ? { x: segment.point.x, y: segment.point.y } : segment.point
        })
        currentFigure.points.push({ x: segment.point.x, y: segment.point.y })
      }
    } else {
      for (const point of figure.points.slice(1)) {
        runtime.classicPath.lineTo(point.x, point.y)
      }
    }

    if (figure.closed) {
      runtime.classicPath.closeFigure()
    }
  }
}

/**
 * Produce a human-readable warning for an unsupported EMF+ object (brush, image,
 * region, effect, or custom line cap), or null if the object is supported.
 * @param {object} object Parsed EMF+ object.
 * @returns {string | null}
 */
export function getUnknownObjectWarning(object) {
  if (object?.kind === 'brush' && object.type === 'unknown') {
    return `Unsupported EMF+ brush: type=${object.brushType}`
  }

  if (object?.kind === 'image' && object.format === 'unknown') {
    return `Unsupported EMF+ image: type=${object.imageType}`
  }

  if (object?.kind === 'region' && object.type === 'unknown') {
    return `Unsupported EMF+ region: ${object.reason ?? 'parse failed'}`
  }

  if (object?.kind === 'effect' && object.type === 'unknown') {
    return `Unsupported EMF+ effect: guid=${object.guid}`
  }

  if (object?.kind === 'customLineCap' && object.unsupported === 'custom-line-cap-default-path-truncated') {
    return 'Unsupported EMF+ CustomLineCap default path data: truncated'
  }

  if (object?.kind === 'customLineCap' && object.type === 'unknown') {
    return Object.prototype.hasOwnProperty.call(object, 'customLineCapType')
      ? `Unsupported EMF+ custom line cap: type=${object.customLineCapType}`
      : 'Unsupported EMF+ custom line cap: header too short'
  }

  return null
}

/**
 * Emit deduplicated warnings for an object and its nested unsupported children
 * (pen brush/caps, texture brush image), recursing with cycle protection.
 * @param {object} runtime Playback runtime; warnings are pushed via addWarning.
 * @param {object} object Parsed EMF+ object to inspect.
 * @param {WeakSet<object>} [seen] Visited set guarding against cycles.
 * @returns {void}
 */
export function addUnknownObjectWarnings(runtime, object, seen = new WeakSet()) {
  if (!object || typeof object !== 'object' || seen.has(object)) {
    return
  }

  seen.add(object)

  const warning = getUnknownObjectWarning(object)

  if (warning && !warnedUnknownObjects.has(object)) {
    addWarning(runtime, warning)
    warnedUnknownObjects.add(object)
  }

  if (object.kind === 'pen') {
    addUnknownObjectWarnings(runtime, object.brush, seen)
    addUnknownObjectWarnings(runtime, object.customStartCap, seen)
    addUnknownObjectWarnings(runtime, object.customEndCap, seen)
    return
  }

  if (object.kind === 'brush' && object.type === 'texture') {
    addUnknownObjectWarnings(runtime, object.image, seen)
  }
}

/**
 * Read a little-endian UTF-16 string, clamping `length` so it never exceeds the
 * available `maxBytes` budget.
 * @param {DataView} view
 * @param {number} offset Absolute byte offset of the first code unit.
 * @param {number} length Requested character count.
 * @param {number} maxBytes Byte budget bounding how many characters are read.
 * @returns {string}
 */
export function readUtf16String(view, offset, length, maxBytes) {
  const safeLength = Math.max(0, Math.min(length, Math.floor(maxBytes / 2)))
  const chars = []

  for (let index = 0; index < safeLength; index += 1) {
    chars.push(view.getUint16(offset + index * 2, true))
  }

  return String.fromCharCode(...chars)
}

/**
 * Build the region geometry for the clip "universe" (the bounding rect that
 * stands in for an infinite region), defaulting to a unit rect when unset.
 * @param {object} runtime Playback runtime; reads `clipUniverseRect`.
 * @returns {*} Region geometry for the universe rect.
 */
export function getClipUniverseGeometry(runtime) {
  return rectToRegionGeometry(runtime.clipUniverseRect ?? { x: 0, y: 0, width: 1, height: 1 })
}

/**
 * Resolve a region object to clip geometry, dispatching on its representation
 * (cached geometry, node tree, rect, infinite, or empty).
 * @param {object} runtime Playback runtime; supplies the universe rect for node trees.
 * @param {object} region Parsed region object.
 * @returns {*} Region geometry, null for an infinite region, [] for empty, or
 *   undefined when the region cannot be resolved.
 */
export function resolveRegionGeometry(runtime, region) {
  if (!region) {
    return undefined
  }

  if (region.geometry !== undefined) {
    return region.geometry
  }

  if (region.root) {
    return resolveRegionNodeGeometry(region.root, getClipUniverseGeometry(runtime))
  }

  if (region.type === 'rect') {
    return rectToRegionGeometry(region.rect)
  }

  if (region.type === 'infinite') {
    return null
  }

  if (region.type === 'empty') {
    return []
  }

  return undefined
}

/**
 * Convert a path (a `kind: 'path'` object or a `{figures}` geometry) to region
 * geometry, returning undefined for inputs that are neither.
 * @param {import('../types.js').PathGeometry | object} path
 * @param {{ fillMode?: string }} [options] Forwarded to the region conversion.
 * @returns {*} Region geometry, or undefined when `path` is not convertible.
 */
export function resolvePathGeometry(path, options = {}) {
  if (path?.kind === 'path') {
    return pathToRegionGeometry(path, options)
  }

  if (!Array.isArray(path?.figures)) {
    return undefined
  }

  return pathToRegionGeometry(path, options)
}

/**
 * Wrap resolved clip geometry in a clip-state object, or return null when the
 * geometry is null (an infinite/no-op clip).
 * @param {string} mode Clip combine mode, e.g. 'replace' or 'intersect'.
 * @param {object} source Originating clip source descriptor.
 * @param {*} geometry Resolved region geometry, or null for no clip.
 * @returns {{ kind: 'geometry', mode: string, source: object, geometry: * } | null}
 */
export function createClipState(mode, source, geometry) {
  if (geometry === null) {
    return null
  }

  return {
    kind: 'geometry',
    mode,
    source,
    geometry
  }
}

function areClipGeometriesEqual(left, right) {
  if (left === right) {
    return true
  }

  if (typeof left === 'number' || typeof right === 'number') {
    return typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) < 1e-9
  }

  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areClipGeometriesEqual(left[index], right[index])) {
      return false
    }
  }

  return true
}

/**
 * Resolve a clip source descriptor (rect, path, or region) to region geometry.
 * @param {object} runtime Playback runtime; used when the source is a region.
 * @param {{ kind: string, rect?: object, path?: object, fillMode?: string, region?: object }} source
 * @returns {*} Region geometry, or undefined when it cannot be resolved.
 */
export function resolveClipSourceGeometry(runtime, source) {
  return source.kind === 'rect'
    ? rectToRegionGeometry(source.rect)
    : source.kind === 'path'
      ? resolvePathGeometry(source.path, { fillMode: source.fillMode })
      : resolveRegionGeometry(runtime, source.region)
}

/**
 * Push a clip onto the backend, preferring its `setClip` hook and otherwise
 * approximating via `resetClip`/`clipRect`; returns whether the backend could be
 * synced exactly (false means the caller must re-render to honor the clip).
 * @param {object} runtime Playback runtime (unused directly; kept for signature parity).
 * @param {object} backend Canvas backend; may expose setClip/resetClip/clipRect.
 * @param {object|null} clip Clip state, or null to clear the clip.
 * @param {string} mode Clip combine mode.
 * @param {object} source Originating clip source descriptor.
 * @param {*} previousGeometry Geometry of the prior clip, or null if there was none.
 * @returns {boolean} True if the backend clip was applied; false if unsupported.
 */
export function syncBackendClip(runtime, backend, clip, mode, source, previousGeometry) {
  if (typeof backend.setClip === 'function') {
    backend.setClip(clip)
    return true
  }

  if (clip === null) {
    backend.resetClip?.()
    return true
  }

  if (previousGeometry !== null && areClipGeometriesEqual(previousGeometry, clip.geometry)) {
    return true
  }

  if (previousGeometry !== null) {
    return false
  }

  const rect =
    source.kind === 'rect'
      ? source.rect
      : source.kind === 'region' && source.region?.type === 'rect'
        ? source.region.rect
        : null

  if (rect && (mode === 'replace' || mode === 'intersect')) {
    backend.clipRect?.(rect, mode)
    return true
  }

  return false
}

/**
 * Store the next clip geometry on the runtime state and sync it to the backend.
 * @param {object} runtime Playback runtime; reads/mutates `state.current.clip`.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {object} source Originating clip source descriptor.
 * @param {string} mode Clip combine mode.
 * @param {*} nextGeometry Resolved region geometry for the new clip.
 * @returns {boolean} The backend sync result from {@link syncBackendClip}.
 */
export function syncClipGeometry(runtime, backend, source, mode, nextGeometry) {
  const previousGeometry = runtime.state.current.clip?.geometry ?? null
  const nextClip = createClipState(mode, source, nextGeometry)

  runtime.state.setClip(nextClip)
  return syncBackendClip(runtime, backend, nextClip, mode, source, previousGeometry)
}

/**
 * Apply an EMF+ clip operation: resolve the source geometry, combine it with the
 * current clip under `mode`, then store and sync the result.
 * @param {object} runtime Playback runtime; reads/mutates the current clip state.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {object} source Clip source descriptor (rect/path/region).
 * @param {string} mode Clip combine mode.
 * @returns {boolean} False if the source could not be resolved; otherwise the sync result.
 */
export function applyClipOperation(runtime, backend, source, mode) {
  const incomingGeometry = resolveClipSourceGeometry(runtime, source)

  if (incomingGeometry === undefined) {
    // Recognized EMF+ clip record whose source object could not be resolved
    // (e.g. SetClipRegion/SetClipPath referencing a missing object id). Degrade
    // to a diagnostic instead of returning false, which the dispatcher would
    // mis-count as unsupported. Preserve the classic-fallback side effect the
    // prior `return false` produced (playback flips allowClassicDrawingRecords
    // when an EMF+ block needs fallback) so dual EMF+/classic files still fall
    // back to their classic representation — keeping the change visually neutral.
    runtime.currentEmfPlusBlockNeedsFallback = true
    return reportRecordDowngrade(
      runtime,
      DOWNGRADE_OBJECT_UNRESOLVED,
      `EMF+ clip skipped because its ${source.kind} source could not be resolved`
    )
  }

  const previousGeometry = runtime.state.current.clip?.geometry ?? null
  const nextGeometry = combineRegions(previousGeometry, incomingGeometry, mode, getClipUniverseGeometry(runtime))

  return syncClipGeometry(runtime, backend, source, mode, nextGeometry)
}

/**
 * Recompute and sync the classic effective clip as the intersection of the meta
 * region and clip region geometries held on `runtime.classicState`.
 * @param {object} runtime Playback runtime; reads `classicState` meta/clip geometries.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {object} [source] Clip source descriptor for diagnostics.
 * @param {string} [mode] Clip combine mode.
 * @returns {boolean} The backend sync result.
 */
export function syncClassicEffectiveClip(runtime, backend, source = { kind: 'classic-clip' }, mode = 'replace') {
  const metaGeometry = runtime.classicState.classicMetaRegionGeometry ?? null
  const clipGeometry = runtime.classicState.classicClipRegionGeometry ?? null
  const effectiveGeometry = combineRegions(metaGeometry, clipGeometry, 'intersect', getClipUniverseGeometry(runtime))

  return syncClipGeometry(runtime, backend, source, mode, effectiveGeometry)
}

/**
 * Apply a classic clip operation: combine the source geometry into
 * `classicState.classicClipRegionGeometry` under `mode`, then resync the
 * effective clip.
 * @param {object} runtime Playback runtime; mutates `classicState.classicClipRegionGeometry`.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {object} source Clip source descriptor (rect/path/region).
 * @param {string} mode Clip combine mode.
 * @returns {boolean} False if the source could not be resolved; otherwise the sync result.
 */
export function applyClassicClipOperation(runtime, backend, source, mode) {
  const incomingGeometry = resolveClipSourceGeometry(runtime, source)

  if (incomingGeometry === undefined) {
    // Recognized classic clip record whose source region could not be resolved.
    // Degrade to a diagnostic rather than returning false (which the dispatcher
    // would mis-count as unsupported). No EMF+ fallback flag here — classic is
    // the base layer, not an EMF+ block.
    return reportRecordDowngrade(
      runtime,
      DOWNGRADE_OBJECT_UNRESOLVED,
      `Classic clip skipped because its ${source.kind} source could not be resolved`
    )
  }

  runtime.classicState.classicClipRegionGeometry = combineRegions(
    runtime.classicState.classicClipRegionGeometry ?? null,
    incomingGeometry,
    mode,
    getClipUniverseGeometry(runtime)
  )

  return syncClassicEffectiveClip(runtime, backend, source, mode)
}

/**
 * Clear the classic clip region geometry and resync the effective clip.
 * @param {object} runtime Playback runtime; clears `classicState.classicClipRegionGeometry`.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @returns {boolean} The backend sync result.
 */
export function resetClassicClipRegion(runtime, backend) {
  runtime.classicState.classicClipRegionGeometry = null
  return syncClassicEffectiveClip(runtime, backend)
}

/**
 * Translate the classic clip region geometry by (dx, dy) and resync the
 * effective clip.
 * @param {object} runtime Playback runtime; mutates `classicState.classicClipRegionGeometry`.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {number} dx Horizontal offset.
 * @param {number} dy Vertical offset.
 * @returns {boolean} The backend sync result.
 */
export function offsetClassicClipRegion(runtime, backend, dx, dy) {
  if (runtime.classicState.classicClipRegionGeometry !== null) {
    runtime.classicState.classicClipRegionGeometry = translateRegionGeometry(
      runtime.classicState.classicClipRegionGeometry,
      dx,
      dy
    )
  }

  return syncClassicEffectiveClip(runtime, backend, { kind: 'offset-clip', dx, dy })
}

/**
 * Fold the current classic clip region into the meta region (intersecting them),
 * clear the clip region, then resync the effective clip — implements SETMETARGN.
 * @param {object} runtime Playback runtime; mutates `classicState` meta/clip geometries.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @returns {boolean} The backend sync result.
 */
export function setClassicMetaRegion(runtime, backend) {
  runtime.classicState.classicMetaRegionGeometry = combineRegions(
    runtime.classicState.classicMetaRegionGeometry ?? null,
    runtime.classicState.classicClipRegionGeometry ?? null,
    'intersect',
    getClipUniverseGeometry(runtime)
  )
  runtime.classicState.classicClipRegionGeometry = null

  return syncClassicEffectiveClip(runtime, backend, { kind: 'metargn' })
}

/**
 * Clear the runtime clip state and the backend clip (via `setClip(null)` or
 * `resetClip`).
 * @param {object} runtime Playback runtime; clears `state.clip`.
 * @param {object} backend Canvas backend; may expose setClip/resetClip.
 * @returns {boolean} Always true.
 */
export function resetClip(runtime, backend) {
  runtime.state.setClip(null)

  if (typeof backend.setClip === 'function') {
    backend.setClip(null)
    return true
  }

  backend.resetClip?.()
  return true
}

/**
 * Translate the current clip by (dx, dy): shift a rect source if present, move the
 * geometry, store it as a 'replace' clip, and sync the backend. No-op when no
 * clip is set.
 * @param {object} runtime Playback runtime; reads/mutates the current clip state.
 * @param {object} backend Canvas backend to sync the clip onto.
 * @param {number} dx Horizontal offset.
 * @param {number} dy Vertical offset.
 * @returns {boolean} True if there was no clip; otherwise the backend sync result.
 */
export function offsetClip(runtime, backend, dx, dy) {
  const currentClip = runtime.state.current.clip

  if (!currentClip) {
    return true
  }

  const nextSource =
    currentClip.source?.kind === 'rect'
      ? {
          kind: 'rect',
          rect: {
            x: currentClip.source.rect.x + dx,
            y: currentClip.source.rect.y + dy,
            width: currentClip.source.rect.width,
            height: currentClip.source.rect.height
          }
        }
      : currentClip.source
  const nextClip = createClipState('replace', nextSource, translateRegionGeometry(currentClip.geometry, dx, dy))

  runtime.state.setClip(nextClip)
  return syncBackendClip(runtime, backend, nextClip, 'replace', nextSource, null)
}
