import { BinaryReader } from '../core/binary-reader.js'
import { EMR_COMMENT, EMR_EOF, EMR_HEADER, getEmfRecordTypeName, readRectL } from './constants.js'
import { EMR_COMMENT_EMFPLUS } from '../emfplus/constants.js'
import { parseEmfPlusRecords } from '../emfplus/parse-emfplus.js'

function normalizeArrayBuffer(input) {
  if (input instanceof ArrayBuffer) {
    return input
  }

  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
  }

  throw new TypeError('parseEmf expects an ArrayBuffer or Uint8Array')
}

function parseCommentRecord(view, dataOffset, recordDataSize) {
  if (recordDataSize < 4) {
    return null
  }

  const dataSize = view.getUint32(dataOffset, true)

  if (dataSize < 4) {
    return null
  }

  if (recordDataSize < 8) {
    throw new Error(`Invalid EMR_COMMENT payload size ${recordDataSize} at offset ${dataOffset}`)
  }

  const signature = view.getUint32(dataOffset + 4, true)

  if (signature !== EMR_COMMENT_EMFPLUS) {
    return null
  }

  if (dataSize < 8) {
    throw new Error(`Invalid EMF+ comment payload size ${dataSize} at offset ${dataOffset}`)
  }

  if (4 + dataSize > recordDataSize) {
    throw new Error(`Invalid EMF+ comment payload size ${dataSize} at offset ${dataOffset}: payload exceeds EMR_COMMENT payload`)
  }

  return {
    kind: 'emfplus',
    dataSize,
    signature,
    records: parseEmfPlusRecords(view, dataOffset + 8, dataSize - 4)
  }
}

export function parseEmf(input) {
  const buffer = normalizeArrayBuffer(input)
  const view = new DataView(buffer)
  const reader = new BinaryReader(view)

  const recordType = reader.u32()
  const size = reader.u32()

  if (recordType !== EMR_HEADER) {
    throw new Error(`Expected EMR_HEADER, received 0x${recordType.toString(16)}`)
  }

  if (size < 88) {
    throw new Error(`Invalid EMF header size ${size}, expected at least 88 bytes`)
  }

  if (size > buffer.byteLength) {
    throw new Error(`Invalid EMF header size ${size} at offset 0`)
  }

  const bounds = readRectL(reader)
  const frame = readRectL(reader)
  const signature = reader.u32()
  const version = reader.u32()
  const bytes = reader.u32()
  const nRecords = reader.u32()
  const nHandles = reader.u16()
  reader.skip(2)
  const descriptionLength = reader.u32()
  const descriptionOffset = reader.u32()
  const nPalEntries = reader.u32()
  const deviceWidth = reader.i32()
  const deviceHeight = reader.i32()
  const milliWidth = reader.i32()
  const milliHeight = reader.i32()

  const header = {
    recordType,
    recordTypeName: getEmfRecordTypeName(recordType),
    size,
    bounds,
    frame,
    signature,
    version,
    bytes,
    nRecords,
    nHandles,
    descriptionLength,
    descriptionOffset,
    nPalEntries,
    deviceWidth,
    deviceHeight,
    milliWidth,
    milliHeight
  }

  const records = []
  let offset = 0
  let encounteredEOF = false
  let hasEmfPlus = false

  while (offset + 8 <= buffer.byteLength) {
    const type = view.getUint32(offset, true)
    const recordSize = view.getUint32(offset + 4, true)

    if (recordSize < 8) {
      throw new Error(`Invalid EMF record size ${recordSize} at offset ${offset}`)
    }

    if (offset + recordSize > buffer.byteLength) {
      throw new Error(`Invalid EMF record size ${recordSize} at offset ${offset}`)
    }

    const record = {
      type,
      typeName: getEmfRecordTypeName(type),
      size: recordSize,
      offset,
      dataOffset: offset + 8,
      dataSize: recordSize - 8,
      isComment: type === EMR_COMMENT
    }

    records.push(record)

    if (type === EMR_COMMENT) {
      const comment = parseCommentRecord(view, record.dataOffset, record.dataSize)

      if (comment) {
        hasEmfPlus = true
        record.comment = comment
        record.emfPlusRecords = comment.records
      }
    }

    offset += recordSize

    if (type === EMR_EOF) {
      encounteredEOF = true
      break
    }
  }

  if (!encounteredEOF) {
    throw new Error('Missing EMR_EOF at end of EMF record stream')
  }

  return {
    buffer,
    view,
    header,
    records,
    hasEmfPlus
  }
}
