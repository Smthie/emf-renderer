export class BinaryReader {
  constructor(view, offset = 0) {
    this.view = view
    this.offset = offset
  }

  ensure(bytes) {
    if (this.offset + bytes > this.view.byteLength) {
      throw new RangeError(`BinaryReader out of bounds at ${this.offset} (+${bytes})`)
    }
  }

  seek(offset) {
    if (offset < 0 || offset > this.view.byteLength) {
      throw new RangeError(`Invalid seek offset ${offset}`)
    }

    this.offset = offset
  }

  skip(bytes) {
    this.seek(this.offset + bytes)
  }

  u16() {
    this.ensure(2)
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  u32() {
    this.ensure(4)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  i32() {
    this.ensure(4)
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  f32() {
    this.ensure(4)
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  bytes(length) {
    this.ensure(length)
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
    this.offset += length
    return value
  }
}
