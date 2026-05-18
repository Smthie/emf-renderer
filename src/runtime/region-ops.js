import polygonClipping from 'polygon-clipping'

function closeRing(points) {
  if (points.length === 0) {
    return points
  }

  const first = points[0]
  const last = points[points.length - 1]

  if (first[0] === last[0] && first[1] === last[1]) {
    return points
  }

  return [...points, [...first]]
}

function signedRingArea(ring) {
  let area = 0

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    area += current[0] * next[1] - next[0] * current[1]
  }

  return area / 2
}

function geometryIsEmpty(geometry) {
  return !Array.isArray(geometry) || geometry.length === 0
}

function unionGeometry(left, right) {
  if (geometryIsEmpty(left)) {
    return right
  }

  if (geometryIsEmpty(right)) {
    return left
  }

  return polygonClipping.union(left, right)
}

function addWindingGeometry(counts, winding, geometry) {
  if (winding === 0 || geometryIsEmpty(geometry)) {
    return
  }

  counts.set(winding, unionGeometry(counts.get(winding), geometry))
}

function pathToWindingRegionGeometry(rings) {
  let counts = new Map()

  for (const ring of rings) {
    const area = signedRingArea(ring)

    if (Math.abs(area) <= 1e-9) {
      continue
    }

    const sign = area < 0 ? -1 : 1
    const polygon = [[ring]]
    let remaining = polygon
    const nextCounts = new Map(counts)

    for (const [winding, geometry] of counts.entries()) {
      const overlap = polygonClipping.intersection(geometry, polygon)

      if (geometryIsEmpty(overlap)) {
        continue
      }

      const currentRemainder = polygonClipping.difference(nextCounts.get(winding) ?? [], overlap)

      if (geometryIsEmpty(currentRemainder)) {
        nextCounts.delete(winding)
      } else {
        nextCounts.set(winding, currentRemainder)
      }

      addWindingGeometry(nextCounts, winding + sign, overlap)
      remaining = polygonClipping.difference(remaining, overlap)
    }

    addWindingGeometry(nextCounts, sign, remaining)
    counts = nextCounts
  }

  let geometry = []

  for (const entry of counts.values()) {
    geometry = unionGeometry(geometry, entry)
  }

  return geometry
}

export function rectToRegionGeometry(rect) {
  const left = Math.min(rect.x, rect.x + rect.width)
  const right = Math.max(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const bottom = Math.max(rect.y, rect.y + rect.height)

  if (!(right > left) || !(bottom > top)) {
    return []
  }

  return [
    [
      closeRing([
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom]
      ])
    ]
  ]
}

function cubicPointAt(start, control1, control2, end, t) {
  const inverse = 1 - t
  const inverse2 = inverse * inverse
  const inverse3 = inverse2 * inverse
  const t2 = t * t
  const t3 = t2 * t

  return [
    inverse3 * start.x + 3 * inverse2 * t * control1.x + 3 * inverse * t2 * control2.x + t3 * end.x,
    inverse3 * start.y + 3 * inverse2 * t * control1.y + 3 * inverse * t2 * control2.y + t3 * end.y
  ]
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

  return [
    segment.center.x + x * cosine - y * sine,
    segment.center.y + x * sine + y * cosine
  ]
}

function flattenPathFigure(figure) {
  const firstPoint = figure?.points?.[0]

  if (!firstPoint) {
    return []
  }

  const ring = [[firstPoint.x, firstPoint.y]]
  let currentPoint = firstPoint

  if (Array.isArray(figure.segments) && figure.segments.length > 0) {
    for (const segment of figure.segments) {
      if (segment.type === 'line') {
        ring.push([segment.point.x, segment.point.y])
        currentPoint = segment.point
        continue
      }

      if (segment.type === 'bezier') {
        const steps = 16

        for (let step = 1; step <= steps; step += 1) {
          ring.push(cubicPointAt(currentPoint, segment.control1, segment.control2, segment.point, step / steps))
        }

        currentPoint = segment.point
        continue
      }

      if (segment.type === 'arc') {
        const sweep = resolveArcSweep(segment)
        const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 8)))

        for (let step = 1; step <= steps; step += 1) {
          ring.push(ellipsePointAt(segment, segment.startAngle + (sweep * step) / steps))
        }

        currentPoint = segment.point
      }
    }
  } else {
    for (const point of figure.points.slice(1)) {
      ring.push([point.x, point.y])
    }
  }

  if (ring.length < 3) {
    return []
  }

  return closeRing(ring)
}

export function pathToRegionGeometry(path, { fillMode = 'alternate' } = {}) {
  const figures = path?.figures ?? []
  const rings = []

  for (const figure of figures) {
    const ring = flattenPathFigure(figure)

    if (ring.length < 4) {
      continue
    }

    rings.push(ring)
  }

  if (fillMode === 'winding') {
    return pathToWindingRegionGeometry(rings)
  }

  let geometry = []

  for (const ring of rings) {
    const polygon = [[ring]]
    geometry = geometry.length === 0 ? polygon : polygonClipping.xor(geometry, polygon)
  }

  return geometry
}

export function subtractRegion(left, right, universe) {
  if (left === null && right === null) {
    return []
  }

  if (left === null) {
    return polygonClipping.difference(universe, right ?? universe)
  }

  if (right === null) {
    return []
  }

  return polygonClipping.difference(left, right)
}

export function combineRegions(current, incoming, mode, universe) {
  if (mode === 'replace') {
    return incoming
  }

  if (mode === 'intersect') {
    if (current === null) {
      return incoming
    }

    if (incoming === null) {
      return current
    }

    return polygonClipping.intersection(current, incoming)
  }

  if (mode === 'union') {
    if (current === null || incoming === null) {
      return null
    }

    return polygonClipping.union(current, incoming)
  }

  if (mode === 'exclude') {
    return subtractRegion(current, incoming, universe)
  }

  if (mode === 'complement') {
    return subtractRegion(incoming, current, universe)
  }

  if (mode === 'xor') {
    if (current === null && incoming === null) {
      return []
    }

    if (current === null) {
      return polygonClipping.xor(universe, incoming)
    }

    if (incoming === null) {
      return polygonClipping.xor(current, universe)
    }

    return polygonClipping.xor(current, incoming)
  }

  return incoming
}

export function translateRegionGeometry(geometry, dx, dy) {
  if (geometry === null) {
    return null
  }

  if (!Array.isArray(geometry)) {
    return geometry
  }

  return geometry.map((polygon) =>
    polygon.map((ring) =>
      ring.map((point) => [point[0] + dx, point[1] + dy])
    )
  )
}
