import { describe, expect, test } from 'vitest'
import { GraphicsState } from '../../src/runtime/graphics-state.js'
import { IDENTITY_MATRIX } from '../../src/runtime/matrix.js'

describe('GraphicsState', () => {
  test('saves and restores the transform stack', () => {
    const state = new GraphicsState()
    state.setWorldTransform([2, 0, 0, 2, 10, 10])
    const token = state.save()

    state.setWorldTransform([1, 0, 0, 1, 0, 0])
    state.restore(token)

    expect(state.current.worldTransform).toEqual([2, 0, 0, 2, 10, 10])
  })

  test('restores an older token and discards newer saved states', () => {
    const state = new GraphicsState()
    state.setWorldTransform([2, 0, 0, 2, 10, 10])
    const firstToken = state.save()

    state.setWorldTransform([3, 0, 0, 3, 20, 20])
    const secondToken = state.save()

    state.setWorldTransform([4, 0, 0, 4, 30, 30])
    state.restore(firstToken)

    expect(state.current.worldTransform).toEqual([2, 0, 0, 2, 10, 10])
    expect(state.stack).toHaveLength(0)
    expect(() => state.restore(secondToken)).toThrow(/token/i)
  })

  test('does not corrupt the stack when restore token is missing', () => {
    const state = new GraphicsState()
    state.setWorldTransform([2, 0, 0, 2, 10, 10])
    const token = state.save()

    expect(() => state.restore(token + 1)).toThrow(/token/i)
    expect(state.stack).toHaveLength(1)

    state.restore(token)
    expect(state.current.worldTransform).toEqual([2, 0, 0, 2, 10, 10])
  })

  test('sets and resets the world transform', () => {
    const state = new GraphicsState()
    state.setWorldTransform([2, 0, 0, 2, 10, 10])

    expect(state.current.worldTransform).toEqual([2, 0, 0, 2, 10, 10])

    state.resetWorldTransform()
    expect(state.current.worldTransform).toEqual(IDENTITY_MATRIX)
  })

  test('updates page transform and restores an isolated clip snapshot', () => {
    const state = new GraphicsState()
    state.setPageTransform('document', 2.5)
    state.setClip({ kind: 'rect', rect: { x: 1, y: 2, width: 3, height: 4 } })
    const token = state.save()

    state.current.clip.rect.x = 999
    state.restore(token)

    expect(state.current.pageUnit).toBe('document')
    expect(state.current.pageScale).toBe(2.5)
    expect(state.current.clip).toEqual({
      kind: 'rect',
      rect: { x: 1, y: 2, width: 3, height: 4 }
    })
  })
})
