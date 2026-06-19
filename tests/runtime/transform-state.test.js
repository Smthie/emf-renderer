import { describe, expect, test } from 'vitest'
import { TransformState } from '../../src/runtime/transform-state.js'

describe('TransformState', () => {
  test('tracks layered transforms and resolves an effective matrix', () => {
    const state = new TransformState()

    state.setOutputTransform([2, 0, 0, 2, 0, 0])
    state.setMappingTransform([1, 0, 0, 1, 3, 0])
    state.setPageTransform([1, 0, 0, 1, 5, 0])
    state.setWorldTransform([1, 0, 0, 1, 7, 0])

    expect(state.getEffectiveTransform()).toEqual([2, 0, 0, 2, 30, 0])
  })

  test('saves and restores older snapshots while discarding newer tokens', () => {
    const state = new TransformState()

    state.setOutputTransform([2, 0, 0, 2, 10, 10])
    state.setWorldTransform([1, 0, 0, 1, 4, 4])
    const token = state.save()

    state.setWorldTransform([1, 0, 0, 1, 8, 8])
    const newerToken = state.save()
    state.setWorldTransform([1, 0, 0, 1, 12, 12])

    state.restore(token)

    expect(state.getEffectiveTransform()).toEqual([2, 0, 0, 2, 18, 18])
    expect(state.stack).toHaveLength(0)
    expect(() => state.restore(newerToken)).toThrow(/token/i)
  })

  test('rejects an unknown restore token with a stable error', () => {
    const state = new TransformState()

    expect(() => state.restore(99)).toThrow(/token/i)
    expect(state.stack).toHaveLength(0)
  })
})
