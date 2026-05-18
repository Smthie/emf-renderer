import { cloneValue } from './clone-value.js'

const EMFPLUS_PATH_POINT_TYPE_START = 0
const EMFPLUS_PATH_POINT_TYPE_LINE = 1
const EMFPLUS_PATH_POINT_TYPE_BEZIER = 3
const EMFPLUS_PATH_POINT_TYPE_MASK = 0x07
const EMFPLUS_PATH_POINT_CLOSE_SUBPATH = 0x80

function closeBitIsSet(pointType) {
  return (pointType & EMFPLUS_PATH_POINT_CLOSE_SUBPATH) !== 0
}

export class PathBuilder {
  constructor() {
    this.figures = []
    this.currentFigure = null
  }

  beginPath() {
    this.figures = []
    this.currentFigure = null
  }

  moveTo(x, y) {
    this.currentFigure = {
      closed: false,
      points: [{ x, y }]
    }

    this.figures.push(this.currentFigure)
  }

  lineTo(x, y) {
    if (!this.currentFigure) {
      this.moveTo(x, y)
      return
    }

    this.currentFigure.points.push({ x, y })

    if (Array.isArray(this.currentFigure.segments)) {
      this.currentFigure.segments.push({
        type: 'line',
        point: { x, y }
      })
    }
  }

  curveTo(control1, control2, point) {
    if (!this.currentFigure) {
      this.moveTo(point.x, point.y)
      return
    }

    if (!Array.isArray(this.currentFigure.segments)) {
      this.currentFigure.segments = this.currentFigure.points.slice(1).map((entry) => ({
        type: 'line',
        point: cloneValue(entry)
      }))
    }

    this.currentFigure.segments.push({
      type: 'bezier',
      control1: cloneValue(control1),
      control2: cloneValue(control2),
      point: cloneValue(point)
    })
    this.currentFigure.points.push(cloneValue(point))
  }

  appendPoints(points, { closed = false } = {}) {
    if (!Array.isArray(points) || points.length === 0) {
      return
    }

    this.moveTo(points[0].x, points[0].y)

    for (const point of points.slice(1)) {
      this.lineTo(point.x, point.y)
    }

    if (closed) {
      this.closeFigure()
    }
  }

  closeFigure() {
    if (this.currentFigure) {
      this.currentFigure.closed = true
      this.currentFigure = null
    }
  }

  toPathGeometry() {
    return {
      figures: cloneValue(this.figures)
    }
  }

  restore(geometry) {
    const figures = geometry?.figures ?? []

    this.figures = cloneValue(figures)
    this.currentFigure =
      this.figures.length > 0 && !this.figures[this.figures.length - 1].closed
        ? this.figures[this.figures.length - 1]
        : null
  }
}

export function createPathGeometry(points, { closed = false } = {}) {
  const builder = new PathBuilder()

  builder.beginPath()
  builder.appendPoints(points, { closed })

  return builder.toPathGeometry()
}

function resolveEllipseMetrics(rect) {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  const center = {
    x: (left + right) / 2,
    y: (top + bottom) / 2
  }

  return {
    left,
    top,
    right,
    bottom,
    center,
    radiusX: (right - left) / 2,
    radiusY: (bottom - top) / 2
  }
}

function resolveEllipseAngle(metrics, point) {
  if (metrics.radiusX === 0 || metrics.radiusY === 0) {
    return 0
  }

  return Math.atan2((point.y - metrics.center.y) / metrics.radiusY, (point.x - metrics.center.x) / metrics.radiusX)
}

function resolveEllipsePoint(metrics, angle) {
  return {
    x: metrics.center.x + metrics.radiusX * Math.cos(angle),
    y: metrics.center.y + metrics.radiusY * Math.sin(angle)
  }
}

export function createArcPathGeometry(rect, start, end, options = {}) {
  const metrics = resolveEllipseMetrics(rect)
  const startAngle = resolveEllipseAngle(metrics, start)
  const endAngle = resolveEllipseAngle(metrics, end)
  return createEllipseArcGeometry(metrics, startAngle, endAngle, options)
}

function createEllipseArcGeometry(metrics, startAngle, endAngle, options = {}) {
  const startPoint = resolveEllipsePoint(metrics, startAngle)
  const endPoint = resolveEllipsePoint(metrics, endAngle)
  const arcSegment = {
    type: 'arc',
    center: metrics.center,
    radiusX: metrics.radiusX,
    radiusY: metrics.radiusY,
    rotation: 0,
    startAngle,
    endAngle,
    counterclockwise: options.counterclockwise ?? false,
    point: endPoint
  }

  if (options.pie) {
    return {
      figures: [
        {
          closed: true,
          points: [metrics.center, startPoint, endPoint],
          segments: [
            {
              type: 'line',
              point: startPoint
            },
            arcSegment
          ]
        }
      ]
    }
  }

  return {
    figures: [
      {
        closed: !!options.chord,
        points: [startPoint, endPoint],
        segments: [arcSegment]
      }
    ]
  }
}

export function createAngleArcPathGeometry(rect, startAngleDegrees, sweepAngleDegrees, options = {}) {
  const metrics = resolveEllipseMetrics({
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height
  })
  const startAngle = (startAngleDegrees * Math.PI) / 180
  const endAngle = startAngle + (sweepAngleDegrees * Math.PI) / 180

  return createEllipseArcGeometry(metrics, startAngle, endAngle, {
    ...options,
    counterclockwise: options.counterclockwise ?? sweepAngleDegrees < 0
  })
}

function cubicPointAt(start, control1, control2, end, t) {
  const inverse = 1 - t
  const inverse2 = inverse * inverse
  const inverse3 = inverse2 * inverse
  const t2 = t * t
  const t3 = t2 * t

  return {
    x: inverse3 * start.x + 3 * inverse2 * t * control1.x + 3 * inverse * t2 * control2.x + t3 * end.x,
    y: inverse3 * start.y + 3 * inverse2 * t * control1.y + 3 * inverse * t2 * control2.y + t3 * end.y
  }
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function resolveCurveStepCount(points, tolerance) {
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)

  return Math.max(4, Math.min(64, Math.ceil(length / Math.max(0.5, tolerance * 8))))
}

function resolveArcSweep(segment) {
  let sweep = segment.endAngle - segment.startAngle

  if (segment.counterclockwise) {
    if (sweep >= 0) {
      sweep -= Math.PI * 2
    }
  } else if (sweep <= 0) {
    sweep += Math.PI * 2
  }

  return sweep
}

function ellipsePointAt(segment, angle) {
  const cosine = Math.cos(segment.rotation ?? 0)
  const sine = Math.sin(segment.rotation ?? 0)
  const x = segment.radiusX * Math.cos(angle)
  const y = segment.radiusY * Math.sin(angle)

  return {
    x: segment.center.x + x * cosine - y * sine,
    y: segment.center.y + x * sine + y * cosine
  }
}

function flattenFigure(figure, options = {}) {
  const firstPoint = figure?.points?.[0]

  if (!firstPoint) {
    return null
  }

  const tolerance = options.tolerance ?? 1
  const points = [cloneValue(firstPoint)]
  let currentPoint = firstPoint

  if (Array.isArray(figure.segments) && figure.segments.length > 0) {
    for (const segment of figure.segments) {
      if (segment.type === 'line') {
        points.push(cloneValue(segment.point))
        currentPoint = segment.point
        continue
      }

      if (segment.type === 'bezier') {
        const steps = resolveCurveStepCount(
          [currentPoint, segment.control1, segment.control2, segment.point],
          tolerance
        )

        for (let step = 1; step <= steps; step += 1) {
          points.push(cubicPointAt(currentPoint, segment.control1, segment.control2, segment.point, step / steps))
        }

        currentPoint = segment.point
        continue
      }

      if (segment.type === 'arc') {
        const sweep = resolveArcSweep(segment)
        const radius = Math.max(Math.abs(segment.radiusX), Math.abs(segment.radiusY))
        const steps = Math.max(4, Math.min(96, Math.ceil((Math.abs(sweep) * radius) / Math.max(0.5, tolerance * 6))))

        for (let step = 1; step <= steps; step += 1) {
          points.push(ellipsePointAt(segment, segment.startAngle + (sweep * step) / steps))
        }

        currentPoint = segment.point
      }
    }
  } else {
    for (const point of figure.points.slice(1)) {
      points.push(cloneValue(point))
    }
  }

  return {
    closed: !!figure.closed,
    points
  }
}

export function flattenPathGeometry(path, options = {}) {
  return {
    figures: (path?.figures ?? [])
      .map((figure) => flattenFigure(figure, options))
      .filter(Boolean)
  }
}

function boundsOfPoints(points) {
  return points.reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y)
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY
    }
  )
}

function widenSingleLine(start, end, halfWidth) {
  const length = distance(start, end)

  if (!(length > 0)) {
    return null
  }

  const normalX = ((end.y - start.y) / length) * halfWidth
  const normalY = ((start.x - end.x) / length) * halfWidth

  return {
    closed: true,
    points: [
      { x: start.x + normalX, y: start.y + normalY },
      { x: end.x + normalX, y: end.y + normalY },
      { x: end.x - normalX, y: end.y - normalY },
      { x: start.x - normalX, y: start.y - normalY }
    ]
  }
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y)

  if (!(length > 0)) {
    return null
  }

  return {
    x: x / length,
    y: y / length
  }
}

function offsetPoint(point, normal, distanceValue) {
  return {
    x: point.x + normal.x * distanceValue,
    y: point.y + normal.y * distanceValue
  }
}

function advancePoint(point, direction, distanceValue) {
  return {
    x: point.x + direction.x * distanceValue,
    y: point.y + direction.y * distanceValue
  }
}

function intersectLines(originA, directionA, originB, directionB) {
  const cross = directionA.x * directionB.y - directionA.y * directionB.x

  if (Math.abs(cross) <= 1e-9) {
    return null
  }

  const dx = originB.x - originA.x
  const dy = originB.y - originA.y
  const distanceValue = (dx * directionB.y - dy * directionB.x) / cross

  return {
    x: originA.x + directionA.x * distanceValue,
    y: originA.y + directionA.y * distanceValue
  }
}

function appendRoundJoinPoints(output, center, previousNormal, currentNormal, side, radius, turnSign) {
  const startAngle = Math.atan2(previousNormal.y * side, previousNormal.x * side)
  const endAngle = Math.atan2(currentNormal.y * side, currentNormal.x * side)
  let sweep = endAngle - startAngle

  if (turnSign > 0 && sweep < 0) {
    sweep += Math.PI * 2
  } else if (turnSign < 0 && sweep > 0) {
    sweep -= Math.PI * 2
  }

  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 8)))

  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps
    output.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    })
  }
}

function appendArcPoints(output, center, direction, normal, radius, startSide, endSide, directionSide) {
  const steps = 8

  for (let step = 1; step < steps; step += 1) {
    const angle = Math.PI * (step / steps)
    const normalScale = startSide * Math.cos(angle)
    const directionScale = directionSide * Math.sin(angle)

    output.push({
      x: center.x + normal.x * radius * normalScale + direction.x * radius * directionScale,
      y: center.y + normal.y * radius * normalScale + direction.y * radius * directionScale
    })
  }

  output.push(offsetPoint(center, normal, radius * endSide))
}

function createCapOutline(points, leftSide, rightSide, segments, halfWidth, lineCap) {
  if (lineCap === 'square') {
    const firstDirection = segments[0].direction
    const lastDirection = segments.at(-1).direction

    return {
      leftSide: [
        advancePoint(leftSide[0], firstDirection, -halfWidth),
        ...leftSide.slice(1, -1),
        advancePoint(leftSide.at(-1), lastDirection, halfWidth)
      ],
      rightSide: [
        advancePoint(rightSide[0], firstDirection, -halfWidth),
        ...rightSide.slice(1, -1),
        advancePoint(rightSide.at(-1), lastDirection, halfWidth)
      ]
    }
  }

  if (lineCap !== 'round') {
    return { leftSide, rightSide }
  }

  const outline = [...leftSide]
  const lastSegment = segments.at(-1)

  appendArcPoints(outline, points.at(-1), lastSegment.direction, lastSegment.normal, halfWidth, 1, -1, 1)
  outline.push(...rightSide.slice(0, -1).reverse())
  appendArcPoints(outline, points[0], segments[0].direction, segments[0].normal, halfWidth, -1, 1, -1)

  return { outline }
}

function widenOpenPolyline(points, halfWidth, { lineCap = 'butt', lineJoin = 'miter', miterLimit = 10 } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return {
      figure: null,
      reason: 'degenerate-open-polyline'
    }
  }

  const segments = []

  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const length = distance(start, end)
    const direction = normalizeVector(end.x - start.x, end.y - start.y)

    if (!direction) {
      return {
        figure: null,
        reason: 'degenerate-open-polyline'
      }
    }

    segments.push({
      start,
      end,
      direction,
      normal: {
        x: (end.y - start.y) / length,
        y: (start.x - end.x) / length
      }
    })
  }

  const buildSide = (side) => {
    const widenedPoints = [offsetPoint(segments[0].start, segments[0].normal, halfWidth * side)]

    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index]
      const previous = segments[index - 1]
      const current = segments[index]
      const previousOffset = offsetPoint(point, previous.normal, halfWidth * side)
      const currentOffset = offsetPoint(point, current.normal, halfWidth * side)
      const join = intersectLines(previousOffset, previous.direction, currentOffset, current.direction)
      const dot = previous.direction.x * current.direction.x + previous.direction.y * current.direction.y
      const cross = previous.direction.x * current.direction.y - previous.direction.y * current.direction.x

      if (dot <= -0.999999) {
        return {
          points: null,
          reason: 'reversing-open-polyline'
        }
      }

      const isOuterJoin = Math.abs(cross) > 1e-9 && Math.sign(cross) === side

      if (!isOuterJoin || !join) {
        widenedPoints.push(join ?? currentOffset)
        continue
      }

      if (lineJoin === 'bevel') {
        widenedPoints.push(previousOffset, currentOffset)
        continue
      }

      if (lineJoin === 'round') {
        appendRoundJoinPoints(widenedPoints, point, previous.normal, current.normal, side, halfWidth, Math.sign(cross))
        continue
      }

      const miterRatio = distance(point, join) / halfWidth

      if (Number.isFinite(miterLimit) && miterRatio > Math.max(1, miterLimit)) {
        widenedPoints.push(previousOffset, currentOffset)
        continue
      }

      widenedPoints.push(join)
    }

    widenedPoints.push(offsetPoint(segments.at(-1).end, segments.at(-1).normal, halfWidth * side))
    return {
      points: widenedPoints
    }
  }

  const leftSide = buildSide(1)
  const rightSide = buildSide(-1)

  if (!leftSide?.points || !rightSide?.points) {
    return {
      figure: null,
      reason: leftSide?.reason ?? rightSide?.reason ?? 'unsupported-open-polyline'
    }
  }

  const capped = createCapOutline(points, leftSide.points, rightSide.points, segments, halfWidth, lineCap)

  if (capped.outline) {
    return {
      figure: {
        closed: true,
        points: capped.outline
      }
    }
  }

  return {
    figure: {
      closed: true,
      points: [
        ...capped.leftSide,
        ...capped.rightSide.reverse()
      ]
    }
  }
}

function widenBounds(points, halfWidth) {
  const bounds = boundsOfPoints(points)

  if (!Number.isFinite(bounds.left)) {
    return null
  }

  return {
    closed: true,
    points: [
      { x: bounds.left - halfWidth, y: bounds.top - halfWidth },
      { x: bounds.right + halfWidth, y: bounds.top - halfWidth },
      { x: bounds.right + halfWidth, y: bounds.bottom + halfWidth },
      { x: bounds.left - halfWidth, y: bounds.bottom + halfWidth }
    ]
  }
}

export function widenPathGeometry(path, width, options = {}) {
  const halfWidth = Math.max(0.5, Math.abs(width || 1) / 2)
  const lineCap = options.lineCap ?? 'butt'
  const lineJoin = options.lineJoin ?? 'miter'
  const miterLimit = options.miterLimit ?? 10
  const flattened = flattenPathGeometry(path, options)
  const warnings = []
  const warningDetails = []
  const figures = []

  for (const figure of flattened.figures) {
    let fallbackReason = null

    if (!figure.closed && figure.points.length >= 2) {
      const widened = widenOpenPolyline(figure.points, halfWidth, { lineCap, lineJoin, miterLimit })

      if (widened.figure) {
        figures.push(widened.figure)
        continue
      }

      fallbackReason = widened.reason
    } else if (figure.closed) {
      fallbackReason = 'closed-path'
    } else {
      fallbackReason = 'degenerate-path'
    }

    const widened = widenBounds(figure.points, halfWidth)

    if (widened) {
      figures.push(widened)
      warnings.push('EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths')
      warningDetails.push({
        reason: fallbackReason ?? 'unsupported-path'
      })
    }
  }

  return {
    path: { figures },
    warnings,
    warningDetails
  }
}

// Null-safe, x/y-only copy. The null-safe form is required: WMF state save
// (wmf/playback.js) clones a possibly-null currentPoint, and a `{...point}`
// clone would turn a restored null into a truthy `{}`, producing a phantom
// line. x/y-only is correct everywhere because no caller's point carries
// extra fields.
export function clonePoint(point) {
  return point ? { x: point.x, y: point.y } : null
}

function createClosedPolylineGeometry(points) {
  const builder = new PathBuilder()

  builder.beginPath()
  builder.appendPoints(points, { closed: true })

  return builder.toPathGeometry()
}

function resolveCardinalTangent(previous, next, scale) {
  return {
    x: (next.x - previous.x) * scale,
    y: (next.y - previous.y) * scale
  }
}

function createOpenPolylineGeometry(points) {
  const builder = new PathBuilder()

  builder.beginPath()
  builder.appendPoints(points)

  return builder.toPathGeometry()
}

export function createClosedCardinalSplineGeometry(points, tension = 0.5) {
  if (!Array.isArray(points) || points.length === 0) {
    return { figures: [] }
  }

  if (points.length < 3 || tension === 0) {
    return createClosedPolylineGeometry(points)
  }

  const builder = new PathBuilder()
  const scale = (1 - tension) / 2

  builder.beginPath()
  builder.moveTo(points[0].x, points[0].y)

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const afterNext = points[(index + 2) % points.length]
    const startTangent = resolveCardinalTangent(previous, next, scale)
    const endTangent = resolveCardinalTangent(current, afterNext, scale)

    builder.curveTo(
      {
        x: current.x + startTangent.x / 3,
        y: current.y + startTangent.y / 3
      },
      {
        x: next.x - endTangent.x / 3,
        y: next.y - endTangent.y / 3
      },
      clonePoint(next)
    )
  }

  builder.closeFigure()
  return builder.toPathGeometry()
}

export function createOpenCardinalSplineGeometry(points, tension = 0.5, offset = 0, numberOfSegments = null) {
  if (!Array.isArray(points) || points.length === 0) {
    return { figures: [] }
  }

  const totalSegments = Math.max(points.length - 1, 0)
  const startSegment = Math.max(0, Math.min(offset, totalSegments))
  const maxSegments = Math.max(totalSegments - startSegment, 0)
  const segmentCount = Math.max(
    0,
    Math.min(numberOfSegments ?? maxSegments, maxSegments)
  )
  const visiblePoints = points.slice(startSegment, startSegment + segmentCount + 1)

  if (visiblePoints.length === 0) {
    return { figures: [] }
  }

  if (visiblePoints.length < 2 || tension === 0 || segmentCount === 0) {
    return createOpenPolylineGeometry(visiblePoints)
  }

  const builder = new PathBuilder()
  const scale = (1 - tension) / 2

  builder.beginPath()
  builder.moveTo(visiblePoints[0].x, visiblePoints[0].y)

  for (let index = startSegment; index < startSegment + segmentCount; index += 1) {
    const previous = points[Math.max(index - 1, 0)]
    const current = points[index]
    const next = points[index + 1]
    const afterNext = points[Math.min(index + 2, points.length - 1)]
    const startTangent = resolveCardinalTangent(previous, next, scale)
    const endTangent = resolveCardinalTangent(current, afterNext, scale)

    builder.curveTo(
      {
        x: current.x + startTangent.x / 3,
        y: current.y + startTangent.y / 3
      },
      {
        x: next.x - endTangent.x / 3,
        y: next.y - endTangent.y / 3
      },
      clonePoint(next)
    )
  }

  return builder.toPathGeometry()
}

export function createEmfPlusPathGeometry(points, pointTypes = []) {
  const builder = new PathBuilder()

  builder.beginPath()

  for (let index = 0; index < points.length; ) {
    const point = points[index]
    const pointType = pointTypes[index] ?? (index === 0 ? 0 : 1)
    const pointKind = pointType & EMFPLUS_PATH_POINT_TYPE_MASK

    if (index === 0 || pointKind === EMFPLUS_PATH_POINT_TYPE_START) {
      builder.moveTo(point.x, point.y)
      if (closeBitIsSet(pointType)) {
        builder.closeFigure()
      }
      index += 1
      continue
    }

    if (pointKind === EMFPLUS_PATH_POINT_TYPE_BEZIER) {
      const control2 = points[index + 1]
      const endPoint = points[index + 2]

      if (!control2 || !endPoint) {
        builder.lineTo(point.x, point.y)
        if (closeBitIsSet(pointType)) {
          builder.closeFigure()
        }
        index += 1
        continue
      }

      builder.curveTo(point, control2, endPoint)

      if (closeBitIsSet(pointTypes[index + 2] ?? 0)) {
        builder.closeFigure()
      }

      index += 3
      continue
    }

    if (pointKind === EMFPLUS_PATH_POINT_TYPE_LINE || pointKind !== EMFPLUS_PATH_POINT_TYPE_START) {
      builder.lineTo(point.x, point.y)
    }

    if (closeBitIsSet(pointType)) {
      builder.closeFigure()
    }

    index += 1
  }

  return builder.toPathGeometry()
}
