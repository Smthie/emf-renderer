export function parseEmfPlusRecords(view, offset, byteLength) {
  const records = []
  const end = offset + byteLength
  let cursor = offset

  while (cursor + 12 <= end) {
    const type = view.getUint16(cursor, true)
    const flags = view.getUint16(cursor + 2, true)
    const size = view.getUint32(cursor + 4, true)
    const dataSize = view.getUint32(cursor + 8, true)

    if (size < 12) {
      throw new Error(`Invalid EMF+ record size ${size} at offset ${cursor}`)
    }

    if (cursor + size > end) {
      throw new Error(`Invalid EMF+ record size ${size} at offset ${cursor}`)
    }

    if (dataSize > size - 12) {
      throw new Error(`Invalid EMF+ record dataSize ${dataSize} at offset ${cursor}`)
    }

    records.push({
      type,
      flags,
      size,
      dataSize,
      offset: cursor,
      dataOffset: cursor + 12
    })

    cursor += size
  }

  if (cursor !== end) {
    throw new Error(`Invalid EMF+ trailing bytes at offset ${cursor}`)
  }

  return records
}
