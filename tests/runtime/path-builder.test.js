import { describe, expect, test } from 'vitest'
import {
  PathBuilder,
  clonePoint,
  createClosedCardinalSplineGeometry,
  createEmfPlusPathGeometry,
  createOpenCardinalSplineGeometry,
  flattenPathGeometry,
  widenPathGeometry
} from '../../src/runtime/path-builder.js'

describe('clonePoint', () => {
  test('returns null for a null/undefined point (WMF state save clones a possibly-null currentPoint)', () => {
    // Critical invariant: the canonical impl MUST be null-safe. A `{...point}`
    // clone would turn a restored null currentPoint into a truthy `{}`, which
    // wmf/playback.js would treat as a real position and draw a phantom line.
    expect(clonePoint(null)).toBe(null)
    expect(clonePoint(undefined)).toBe(null)
  })

  test('makes an independent x/y-only copy', () => {
    const point = { x: 3, y: 4 }
    const copy = clonePoint(point)

    expect(copy).toEqual({ x: 3, y: 4 })
    expect(copy).not.toBe(point)
    // x/y-only: extra fields are intentionally dropped (no caller carries them).
    expect(clonePoint({ x: 1, y: 2, z: 9 })).toEqual({ x: 1, y: 2 })
  })
})

describe('PathBuilder', () => {
  test('builds figure-level geometry with points', () => {
    const path = new PathBuilder()

    path.beginPath()
    path.moveTo(1, 2)
    path.lineTo(3, 4)
    path.closeFigure()
    path.moveTo(5, 6)
    path.lineTo(7, 8)

    expect(path.toPathGeometry()).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 }
          ]
        },
        {
          closed: false,
          points: [
            { x: 5, y: 6 },
            { x: 7, y: 8 }
          ]
        }
      ]
    })
  })

  test('beginPath clears the current command list', () => {
    const path = new PathBuilder()

    path.moveTo(1, 2)
    path.beginPath()

    expect(path.toPathGeometry()).toEqual({ figures: [] })
  })

  test('creates shared figure geometry directly from EMF+ point data', () => {
    expect(
      createEmfPlusPathGeometry(
        [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
        { x: 7, y: 8 },
        { x: 9, y: 10 }
        ],
        [0, 1, 0, 0x81, 0]
      )
    ).toEqual({
      figures: [
      {
        closed: false,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 }
        ]
      },
      {
        closed: true,
        points: [
          { x: 5, y: 6 },
          { x: 7, y: 8 }
        ]
      },
      {
        closed: false,
        points: [{ x: 9, y: 10 }]
      }
      ]
    })
  })

  test('creates bezier segments from EMF+ point types', () => {
    expect(
      createEmfPlusPathGeometry(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 10 }
        ],
        [0, 3, 3, 0x83]
      )
    ).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 }
          ],
          segments: [
            {
              type: 'bezier',
              control1: { x: 10, y: 0 },
              control2: { x: 10, y: 10 },
              point: { x: 20, y: 10 }
            }
          ]
        }
      ]
    })
  })

  test('creates straight closed geometry when a cardinal spline has zero tension', () => {
    expect(
      createClosedCardinalSplineGeometry(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 }
        ],
        0
      )
    ).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
          ]
        }
      ]
    })
  })

  test('creates closed bezier segments from cardinal spline control points', () => {
    const geometry = createClosedCardinalSplineGeometry(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ],
      0.5
    )

    expect(geometry.figures).toHaveLength(1)
    expect(geometry.figures[0].closed).toBe(true)
    expect(geometry.figures[0].segments).toHaveLength(4)
    expect(geometry.figures[0].segments.every((segment) => segment.type === 'bezier')).toBe(true)
    expect(geometry.figures[0].segments[0].control1.x).toBeCloseTo(0.8333333333)
    expect(geometry.figures[0].segments[0].control1.y).toBeCloseTo(-0.8333333333)
    expect(geometry.figures[0].segments[0].control2.x).toBeCloseTo(9.1666666667)
    expect(geometry.figures[0].segments[0].control2.y).toBeCloseTo(-0.8333333333)
    expect(geometry.figures[0].segments[3].point).toEqual({ x: 0, y: 0 })
  })

  test('creates straight open geometry when a cardinal spline has zero tension', () => {
    expect(
      createOpenCardinalSplineGeometry(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 }
        ],
        0
      )
    ).toEqual({
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
          ]
        }
      ]
    })
  })

  test('creates sliced open cardinal spline segments with duplicated endpoint tangents', () => {
    const geometry = createOpenCardinalSplineGeometry(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 }
      ],
      0.5,
      1,
      2
    )

    expect(geometry).toEqual({
      figures: [
        {
          closed: false,
          points: [
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 10 }
          ],
          segments: [
            {
              type: 'bezier',
              control1: { x: 10.833333333333334, y: 0.8333333333333334 },
              control2: { x: 9.166666666666666, y: 9.166666666666666 },
              point: { x: 10, y: 10 }
            },
            {
              type: 'bezier',
              control1: { x: 10.833333333333334, y: 10.833333333333334 },
              control2: { x: 19.166666666666668, y: 10 },
              point: { x: 20, y: 10 }
            }
          ]
        }
      ]
    })
  })

  test('flattens bezier segments into line-only point geometry', () => {
    const flattened = flattenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 30, y: 0 }
            ],
            segments: [
              {
                type: 'bezier',
                control1: { x: 10, y: 20 },
                control2: { x: 20, y: 20 },
                point: { x: 30, y: 0 }
              }
            ]
          }
        ]
      },
      { tolerance: 1 }
    )

    expect(flattened.figures).toHaveLength(1)
    expect(flattened.figures[0].segments).toBeUndefined()
    expect(flattened.figures[0].points[0]).toEqual({ x: 0, y: 0 })
    expect(flattened.figures[0].points.at(-1)).toEqual({ x: 30, y: 0 })
    expect(flattened.figures[0].points.length).toBeGreaterThan(4)
  })

  test('widens a single line into a closed outline path', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: -2 },
            { x: 10, y: -2 },
            { x: 10, y: 2 },
            { x: 0, y: 2 }
          ]
        }
      ]
    })
  })

  test('widens a single line with explicit butt caps', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 }
            ]
          }
        ]
      },
      4,
      { lineCap: 'butt' }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: -2 },
            { x: 10, y: -2 },
            { x: 10, y: 2 },
            { x: 0, y: 2 }
          ]
        }
      ]
    })
  })

  test('widens a single line with square caps', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 }
            ]
          }
        ]
      },
      4,
      { lineCap: 'square' }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: -2, y: -2 },
            { x: 12, y: -2 },
            { x: 12, y: 2 },
            { x: -2, y: 2 }
          ]
        }
      ]
    })
  })

  test('widens a single line with round caps', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 }
            ]
          }
        ]
      },
      4,
      { lineCap: 'round' }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path.figures[0]).toMatchObject({ closed: true })
    expect(widened.path.figures[0].points).toHaveLength(19)
    expect(widened.path.figures[0].points[0]).toEqual({ x: 0, y: -2 })
    expect(widened.path.figures[0].points[5]).toEqual({ x: 12, y: expect.closeTo(0, 12) })
    expect(widened.path.figures[0].points[9]).toEqual({ x: 10, y: 2 })
    expect(widened.path.figures[0].points[10]).toEqual({ x: 0, y: 2 })
    expect(widened.path.figures[0].points[14]).toEqual({ x: -2, y: expect.closeTo(0, 12) })
    expect(widened.path.figures[0].points.at(-1)).toEqual({ x: 0, y: -2 })
  })

  test('widens open polyline paths into joined outline paths', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: -2 },
            { x: 12, y: -2 },
            { x: 12, y: 10 },
            { x: 8, y: 10 },
            { x: 8, y: 2 },
            { x: 0, y: 2 }
          ]
        }
      ]
    })
  })

  test('widens open polyline paths with bevel joins', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 }
            ]
          }
        ]
      },
      4,
      { lineJoin: 'bevel' }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path.figures[0].points).toEqual([
      { x: 0, y: -2 },
      { x: 10, y: -2 },
      { x: 12, y: 0 },
      { x: 12, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 2 },
      { x: 0, y: 2 }
    ])
  })

  test('widens open polyline paths with round joins', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 }
            ]
          }
        ]
      },
      4,
      { lineJoin: 'round' }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path.figures[0].points).toHaveLength(10)
    expect(widened.path.figures[0].points[1]).toEqual({ x: 10, y: -2 })
    expect(widened.path.figures[0].points[5]).toEqual({ x: 12, y: expect.closeTo(0, 12) })
    expect(widened.path.figures[0].points[6]).toEqual({ x: 12, y: 10 })
  })

  test('falls back from miter to bevel joins when the miter limit is exceeded', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 }
            ]
          }
        ]
      },
      4,
      { miterLimit: 1 }
    )

    expect(widened.warnings).toEqual([])
    expect(widened.path.figures[0].points).toEqual([
      { x: 0, y: -2 },
      { x: 10, y: -2 },
      { x: 12, y: 0 },
      { x: 12, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 2 },
      { x: 0, y: 2 }
    ])
  })

  test('widens obtuse open polyline paths without falling back to bounds', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 5, y: 5 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([])
    expect(widened.warningDetails).toEqual([])
    expect(widened.path.figures[0].points).toEqual([
      { x: 0, y: -2 },
      { x: expect.closeTo(14.828427124746192, 12), y: -2 },
      { x: expect.closeTo(6.414213562373095, 12), y: expect.closeTo(6.414213562373095, 12) },
      { x: expect.closeTo(3.585786437626905, 12), y: expect.closeTo(3.585786437626905, 12) },
      { x: expect.closeTo(5.171572875253809, 12), y: 2 },
      { x: 0, y: 2 }
    ])
  })

  test('reports closed paths when widening falls back to bounds', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([
      'EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths'
    ])
    expect(widened.warningDetails).toEqual([{ reason: 'closed-path' }])
    expect(widened.path.figures[0].points).toEqual([
      { x: -2, y: -2 },
      { x: 12, y: -2 },
      { x: 12, y: 12 },
      { x: -2, y: 12 }
    ])
  })

  test('falls back to bounding boxes for reversing widened polylines', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 0, y: 0 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([
      'EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths'
    ])
    expect(widened.warningDetails).toEqual([{ reason: 'reversing-open-polyline' }])
    expect(widened.path).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: -2, y: -2 },
            { x: 12, y: -2 },
            { x: 12, y: 2 },
            { x: -2, y: 2 }
          ]
        }
      ]
    })
  })

  test('falls back to bounding boxes for near-reversing widened polylines', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 0, y: 0.001 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([
      'EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths'
    ])
    expect(widened.warningDetails).toEqual([{ reason: 'reversing-open-polyline' }])
    expect(widened.path.figures[0].points).toEqual([
      { x: -2, y: -2 },
      { x: 12, y: -2 },
      { x: 12, y: 2.001 },
      { x: -2, y: 2.001 }
    ])
  })

  test('falls back to bounding boxes for degenerate widened polylines', () => {
    const widened = widenPathGeometry(
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 10, y: 0 }
            ]
          }
        ]
      },
      4
    )

    expect(widened.warnings).toEqual([
      'EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths'
    ])
    expect(widened.warningDetails).toEqual([{ reason: 'degenerate-open-polyline' }])
    expect(widened.path.figures[0].points).toEqual([
      { x: -2, y: -2 },
      { x: 12, y: -2 },
      { x: 12, y: 2 },
      { x: -2, y: 2 }
    ])
  })
})
