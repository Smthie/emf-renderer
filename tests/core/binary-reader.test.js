import { describe, expect, test } from 'vitest'
import { BinaryReader } from '../../src/core/binary-reader.js'

describe('BinaryReader', () => {
  test('reads little-endian values and advances its offset', () => {
    const bytes = new Uint8Array([0x34, 0x12, 0x78, 0x56, 0xef, 0xcd, 0xab, 0x90])
    const reader = new BinaryReader(new DataView(bytes.buffer))

    expect(reader.u16()).toBe(0x1234)
    expect(reader.u16()).toBe(0x5678)
    expect(reader.u32()).toBe(0x90abcdef)
    expect(reader.offset).toBe(8)
  })

  test('rejects invalid seeks past the end of the view', () => {
    const reader = new BinaryReader(new DataView(new ArrayBuffer(4)))

    expect(() => reader.seek(5)).toThrow(RangeError)
  })
})
