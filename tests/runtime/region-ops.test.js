import { describe, expect, test } from 'vitest'
import { resolveRegionNodeGeometry } from '../../src/emfplus/object-decoders/region.js'
import { pathToRegionGeometry } from '../../src/runtime/region-ops.js'

function nestedRectPath() {
  return {
    figures: [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ]
      },
      {
        closed: true,
        points: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 8 },
          { x: 2, y: 8 }
        ]
      }
    ]
  }
}

function reversedInnerNestedRectPath() {
  const path = nestedRectPath()

  return {
    figures: [
      path.figures[0],
      {
        closed: true,
        points: [
          { x: 2, y: 2 },
          { x: 2, y: 8 },
          { x: 8, y: 8 },
          { x: 8, y: 2 }
        ]
      }
    ]
  }
}

function oppositeOverlappingRectPath() {
  const path = nestedRectPath()

  return {
    figures: [
      path.figures[0],
      {
        closed: true,
        points: [
          { x: 5, y: 0 },
          { x: 5, y: 10 },
          { x: 15, y: 10 },
          { x: 15, y: 0 }
        ]
      }
    ]
  }
}

describe('region geometry operations', () => {
  test('uses alternate fill mode to create holes from nested figures', () => {
    expect(pathToRegionGeometry(nestedRectPath(), { fillMode: 'alternate' })).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ],
        [
          [2, 2],
          [2, 8],
          [8, 8],
          [8, 2],
          [2, 2]
        ]
      ]
    ])
  })

  test('uses winding fill mode to union same-direction nested figures', () => {
    expect(pathToRegionGeometry(nestedRectPath(), { fillMode: 'winding' })).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ]
      ]
    ])
  })

  test('uses path fill mode when resolving EMF+ region path nodes', () => {
    expect(
      resolveRegionNodeGeometry({
        type: 'path',
        path: {
          ...nestedRectPath(),
          fillMode: 'winding'
        }
      })
    ).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ]
      ]
    ])
  })

  test('uses winding fill mode to preserve reversed inner figure holes', () => {
    expect(pathToRegionGeometry(reversedInnerNestedRectPath(), { fillMode: 'winding' })).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ],
        [
          [2, 2],
          [2, 8],
          [8, 8],
          [8, 2],
          [2, 2]
        ]
      ]
    ])
  })

  test('uses winding fill mode to cancel only overlapping opposite-direction regions', () => {
    expect(pathToRegionGeometry(oppositeOverlappingRectPath(), { fillMode: 'winding' })).toEqual([
      [
        [
          [0, 0],
          [5, 0],
          [5, 10],
          [0, 10],
          [0, 0]
        ]
      ],
      [
        [
          [10, 0],
          [15, 0],
          [15, 10],
          [10, 10],
          [10, 0]
        ]
      ]
    ])
  })
})
