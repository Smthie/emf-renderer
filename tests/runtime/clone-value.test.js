import { describe, expect, test } from 'vitest'
import { cloneValue } from '../../src/runtime/clone-value.js'

describe('cloneValue', () => {
  test('clones undefined, DataView, and Map values', () => {
    const payload = {
      missing: undefined,
      view: new DataView(new Uint8Array([1, 2, 3, 4]).buffer),
      lookup: new Map([
        ['alpha', { count: 1 }]
      ])
    }

    const cloned = cloneValue(payload)

    cloned.view.setUint8(0, 9)
    cloned.lookup.get('alpha').count = 2

    expect(payload.missing).toBeUndefined()
    expect(payload.view.getUint8(0)).toBe(1)
    expect(payload.lookup.get('alpha')).toEqual({ count: 1 })
    expect(cloned.view).toBeInstanceOf(DataView)
    expect(cloned.lookup).toBeInstanceOf(Map)
  })

  test('preserves cyclic references within the clone', () => {
    const payload = { name: 'cycle' }
    payload.self = payload

    const cloned = cloneValue(payload)

    expect(cloned).not.toBe(payload)
    expect(cloned.self).toBe(cloned)
    expect(payload.self).toBe(payload)
  })
})
