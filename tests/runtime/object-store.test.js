import { describe, expect, test } from 'vitest'
import { ObjectStore } from '../../src/runtime/object-store.js'

describe('ObjectStore', () => {
  test('registers, resolves, and deletes objects by handle', () => {
    const store = new ObjectStore()
    store.set(7, { kind: 'brush', color: '#ff0000' })

    expect(store.get(7)).toEqual({ kind: 'brush', color: '#ff0000' })

    store.delete(7)
    expect(store.get(7)).toBeUndefined()
  })

  test('clears all registered objects', () => {
    const store = new ObjectStore()
    store.set(7, { kind: 'brush', color: '#ff0000' })
    store.set(8, { kind: 'pen', color: '#0000ff' })

    store.clear()

    expect(store.get(7)).toBeUndefined()
    expect(store.get(8)).toBeUndefined()
  })
})
