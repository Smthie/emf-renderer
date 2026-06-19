import { describe, expect, test } from 'vitest'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import {
  EMR_COMMENT,
  EMR_EOF,
  EMR_EXTCREATEPEN,
  EMR_HEADER,
  EMR_SETVIEWPORTEXTEX,
  EMR_SETVIEWPORTORGEX,
  EMR_SETWINDOWEXTEX,
  EMR_SETWINDOWORGEX
} from '../../src/emf/constants.js'

function writeRecord(view, offset, type, size, writeData = () => {}) {
  view.setUint32(offset, type, true)
  view.setUint32(offset + 4, size, true)
  writeData(view, offset + 8)
  return offset + size
}

function createSyntheticEmf(records, bounds = { left: 0, top: 0, right: 200, bottom: 100 }) {
  const totalSize = 88 + records.reduce((sum, record) => sum + record.size, 0) + 8
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  let offset = 0

  offset = writeRecord(view, offset, EMR_HEADER, 88, (headerView, dataOffset) => {
    headerView.setInt32(dataOffset, bounds.left, true)
    headerView.setInt32(dataOffset + 4, bounds.top, true)
    headerView.setInt32(dataOffset + 8, bounds.right, true)
    headerView.setInt32(dataOffset + 12, bounds.bottom, true)
    headerView.setInt32(dataOffset + 16, bounds.left, true)
    headerView.setInt32(dataOffset + 20, bounds.top, true)
    headerView.setInt32(dataOffset + 24, bounds.right, true)
    headerView.setInt32(dataOffset + 28, bounds.bottom, true)
    headerView.setUint32(dataOffset + 32, 0x464d4520, true)
    headerView.setUint32(dataOffset + 36, 0x00010000, true)
    headerView.setUint32(dataOffset + 40, totalSize, true)
    headerView.setUint32(dataOffset + 44, records.length + 2, true)
    headerView.setUint16(dataOffset + 48, 8, true)
    headerView.setUint32(dataOffset + 60, bounds.right - bounds.left, true)
    headerView.setUint32(dataOffset + 64, bounds.bottom - bounds.top, true)
    headerView.setUint32(dataOffset + 68, 210, true)
    headerView.setUint32(dataOffset + 72, 148, true)
  })

  for (const record of records) {
    offset = writeRecord(view, offset, record.type, record.size, record.writeData)
  }

  writeRecord(view, offset, EMR_EOF, 8)

  return buffer
}

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

describe('parseEmf', () => {
  fixtureTest('original/image1.emf')('parses the EMF header and record list from image1.emf', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image1.emf'))

    expect(parsed.header.recordType).toBe(EMR_HEADER)
    expect(parsed.records[0].type).toBe(EMR_HEADER)
    expect(parsed.records.at(-1).type).toBe(EMR_EOF)
    expect(parsed.records.some((record) => record.type === EMR_COMMENT)).toBe(true)
    expect(parsed.header.nRecords).toBe(parsed.records.length)
  })

  fixtureTest('original/image1.emf')('accepts Uint8Array input for the same fixture', () => {
    const parsed = parseEmf(new Uint8Array(readFixtureArrayBuffer('original/image1.emf')))

    expect(parsed.header.recordType).toBe(EMR_HEADER)
    expect(parsed.records.at(-1).type).toBe(EMR_EOF)
  })

  fixtureTest('original/image1.emf')('rejects a truncated record body before EOF', () => {
    const fixture = readFixtureArrayBuffer('original/image1.emf')

    expect(() => parseEmf(fixture.slice(0, fixture.byteLength - 1))).toThrow(/record/i)
  })

  test('maps classic foundation record types to stable names', () => {
    const parsed = parseEmf(
      createSyntheticEmf([
        {
          type: EMR_SETWINDOWORGEX,
          size: 16,
          writeData(view, dataOffset) {
            view.setInt32(dataOffset, 10, true)
            view.setInt32(dataOffset + 4, 20, true)
          }
        },
        {
          type: EMR_SETWINDOWEXTEX,
          size: 16,
          writeData(view, dataOffset) {
            view.setInt32(dataOffset, 50, true)
            view.setInt32(dataOffset + 4, 40, true)
          }
        },
        {
          type: EMR_SETVIEWPORTORGEX,
          size: 16,
          writeData(view, dataOffset) {
            view.setInt32(dataOffset, 100, true)
            view.setInt32(dataOffset + 4, 200, true)
          }
        },
        {
          type: EMR_SETVIEWPORTEXTEX,
          size: 16,
          writeData(view, dataOffset) {
            view.setInt32(dataOffset, 200, true)
            view.setInt32(dataOffset + 4, 80, true)
          }
        },
        {
          type: EMR_EXTCREATEPEN,
          size: 56,
          writeData(view, dataOffset) {
            view.setUint32(dataOffset, 3, true)
            view.setUint32(dataOffset + 4, 56, true)
            view.setUint32(dataOffset + 12, 56, true)
            view.setUint32(dataOffset + 20, 0x00012000, true)
            view.setUint32(dataOffset + 24, 75, true)
            view.setUint32(dataOffset + 32, 0x00aaaaaa, true)
          }
        }
      ])
    )

    expect(parsed.records.map((record) => record.typeName)).toEqual([
      'EMR_HEADER',
      'EMR_SETWINDOWORGEX',
      'EMR_SETWINDOWEXTEX',
      'EMR_SETVIEWPORTORGEX',
      'EMR_SETVIEWPORTEXTEX',
      'EMR_EXTCREATEPEN',
      'EMR_EOF'
    ])
  })
})
