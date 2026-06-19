import { describe, expect, test } from 'vitest'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import { EMR_COMMENT, EMR_EOF } from '../../src/emf/constants.js'
import { EMR_COMMENT_EMFPLUS, EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { parseEmfPlusRecords } from '../../src/emfplus/parse-emfplus.js'
import { decodeEmfPlusObject, decodeEmfPlusSerializableObject } from '../../src/emfplus/object-decoders/index.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

function writeEmfPlusRecord(view, offset, { type, flags = 0, size, dataSize }) {
  view.setUint16(offset, type, true)
  view.setUint16(offset + 2, flags, true)
  view.setUint32(offset + 4, size, true)
  view.setUint32(offset + 8, dataSize, true)
}

function writeGuidString(view, offset, guid) {
  const [data1, data2, data3, tail1, tail2] = guid.split('-')

  view.setUint32(offset, Number.parseInt(data1, 16), true)
  view.setUint16(offset + 4, Number.parseInt(data2, 16), true)
  view.setUint16(offset + 6, Number.parseInt(data3, 16), true)

  const tail = `${tail1}${tail2}`

  for (let index = 0; index < 8; index += 1) {
    view.setUint8(offset + 8 + index, Number.parseInt(tail.slice(index * 2, index * 2 + 2), 16))
  }
}

function writeAdjustableArrowCustomLineCap(view, offset, options = {}) {
  view.setUint32(offset, 0xdbc01002, true)
  view.setUint32(offset + 4, 1, true)
  view.setFloat32(offset + 8, options.width ?? 4, true)
  view.setFloat32(offset + 12, options.height ?? 6, true)
  view.setFloat32(offset + 16, options.middleInset ?? 1.5, true)
  view.setInt32(offset + 20, options.fillState ?? 1, true)
  view.setUint32(offset + 24, options.lineStartCap ?? 0, true)
  view.setUint32(offset + 28, options.lineEndCap ?? 2, true)
  view.setUint32(offset + 32, options.lineJoin ?? 1, true)
  view.setFloat32(offset + 36, options.lineMiterLimit ?? 8, true)
  view.setFloat32(offset + 40, options.widthScale ?? 0.5, true)
  view.setFloat32(offset + 44, 0, true)
  view.setFloat32(offset + 48, 0, true)
  view.setFloat32(offset + 52, 0, true)
  view.setFloat32(offset + 56, 0, true)
  return 60
}

function writeSimplePathObject(view, offset, points, pointTypes = null) {
  view.setUint32(offset, 0xdbc01002, true)
  view.setUint32(offset + 4, points.length, true)
  view.setUint32(offset + 8, 0, true)

  let cursor = offset + 12

  for (const point of points) {
    view.setFloat32(cursor, point.x, true)
    view.setFloat32(cursor + 4, point.y, true)
    cursor += 8
  }

  const types = pointTypes ?? points.map((_point, index) => (index === 0 ? 0 : 1))

  for (const type of types) {
    view.setUint8(cursor, type)
    cursor += 1
  }

  return Math.ceil((cursor - offset) / 4) * 4
}

function writeLengthPrefixedPath(view, offset, points, pointTypes = null) {
  const pathSize = writeSimplePathObject(view, offset + 4, points, pointTypes)

  view.setInt32(offset, pathSize, true)
  return 4 + pathSize
}

function writeDefaultCustomLineCap(view, offset, options = {}) {
  const dataFlags = options.customLineCapDataFlags ?? 0

  view.setUint32(offset, 0xdbc01002, true)
  view.setUint32(offset + 4, 0, true)
  view.setUint32(offset + 8, dataFlags, true)
  view.setUint32(offset + 12, options.baseCap ?? 2, true)
  view.setFloat32(offset + 16, options.baseInset ?? 0.25, true)
  view.setUint32(offset + 20, options.strokeStartCap ?? 0, true)
  view.setUint32(offset + 24, options.strokeEndCap ?? 1, true)
  view.setUint32(offset + 28, options.strokeJoin ?? 2, true)
  view.setFloat32(offset + 32, options.strokeMiterLimit ?? 9, true)
  view.setFloat32(offset + 36, options.widthScale ?? 1.25, true)
  view.setFloat32(offset + 40, 1, true)
  view.setFloat32(offset + 44, 2, true)
  view.setFloat32(offset + 48, 3, true)
  view.setFloat32(offset + 52, 4, true)
  return 56
}

function findEmfPlusCommentDataSizeOffset(buffer, occurrence = 0) {
  const view = new DataView(buffer)
  let offset = 0
  let seen = 0

  while (offset + 8 <= buffer.byteLength) {
    const type = view.getUint32(offset, true)
    const size = view.getUint32(offset + 4, true)

    if (type === EMR_COMMENT && view.getUint32(offset + 12, true) === EMR_COMMENT_EMFPLUS) {
      if (seen === occurrence) {
        return offset + 8
      }

      seen += 1
    }

    if (size < 8 || offset + size > buffer.byteLength) {
      break
    }

    offset += size

    if (type === EMR_EOF) {
      break
    }
  }

  throw new Error('EMF+ comment record not found')
}

function findFirstEmfPlusObjectRecord(parsed, objectType) {
  for (const record of parsed.records) {
    if (!record.emfPlusRecords) {
      continue
    }

    for (const subrecord of record.emfPlusRecords) {
      if (subrecord.type === EmfPlusRecordType.Object && ((subrecord.flags >> 8) & 0x7f) === objectType) {
        return subrecord
      }
    }
  }

  throw new Error(`EMF+ object type ${objectType} not found`)
}

describe('parseEmf EMF+ expansion', () => {
  fixtureTest('original/image6.emf')('extracts embedded EMF+ records from comment records', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image6.emf'))
    const commentRecords = parsed.records.filter((record) => record.emfPlusRecords)
    const flatTypes = commentRecords.flatMap((record) => record.emfPlusRecords.map((item) => item.type))

    expect(parsed.hasEmfPlus).toBe(true)
    expect(flatTypes).toContain(EmfPlusRecordType.Header)
    expect(flatTypes).toContain(EmfPlusRecordType.SetClipRect)
    expect(flatTypes).toContain(EmfPlusRecordType.DrawImagePoints)
  })

  fixtureTest('original/image2.emf')('rejects EMF+ comment records with DataSize = 4', () => {
    const fixture = readFixtureArrayBuffer('original/image2.emf')
    const mutated = fixture.slice(0)
    const view = new DataView(mutated)
    const dataSizeOffset = findEmfPlusCommentDataSizeOffset(mutated)

    view.setUint32(dataSizeOffset, 4, true)

    expect(() => parseEmf(mutated)).toThrow(/EMF\+/i)
  })

  fixtureTest('original/image2.emf')('rejects EMF+ comment records whose payload overflows the EMR_COMMENT payload', () => {
    const fixture = readFixtureArrayBuffer('original/image2.emf')
    const mutated = fixture.slice(0)
    const view = new DataView(mutated)
    const dataSizeOffset = findEmfPlusCommentDataSizeOffset(mutated)

    view.setUint32(dataSizeOffset, 1000, true)

    expect(() => parseEmf(mutated)).toThrow(/payload/i)
  })

  fixtureTest('original/image2.emf')('rejects truncated EMR_COMMENT headers before reading an EMF+ signature', () => {
    const fixture = readFixtureArrayBuffer('original/image2.emf')
    const mutated = fixture.slice(0)
    const view = new DataView(mutated)
    const dataSizeOffset = findEmfPlusCommentDataSizeOffset(mutated)

    view.setUint32(dataSizeOffset - 4, 12, true)
    view.setUint32(dataSizeOffset, 4, true)

    expect(() => parseEmf(mutated)).toThrow(/EMR_COMMENT payload size/i)
  })

  fixtureTest('original/image5.emf')('decodes image5.emf embedded image objects as WMF payloads', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image5.emf'))
    const imageRecord = findFirstEmfPlusObjectRecord(parsed, 5)
    const object = decodeEmfPlusObject(imageRecord, parsed)
    const view = new DataView(object.buffer)

    expect(object).toMatchObject({
      kind: 'image',
      format: 'wmf'
    })
    expect(view.getUint32(0, true)).toBe(0x9ac6cdd7)
  })

  fixtureTest('original/image3.emf')('decodes compressed nested EMF+ path objects in image3.emf with integer point coordinates', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image3.emf'))
    const imageRecord = findFirstEmfPlusObjectRecord(parsed, 5)
    const imageObject = decodeEmfPlusObject(imageRecord, parsed)
    const nestedParsed = parseEmf(imageObject.buffer)
    const pathRecord = findFirstEmfPlusObjectRecord(nestedParsed, 3)
    const pathObject = decodeEmfPlusObject(pathRecord, nestedParsed)

    expect(pathObject).toEqual({
      kind: 'path',
      flags: 0x4000,
      figures: [
        {
          closed: true,
          points: [
            { x: 22, y: 167 },
            { x: 22, y: 252 },
            { x: 431, y: 252 },
            { x: 576, y: 107 },
            { x: 576, y: 22 },
            { x: 167, y: 22 }
          ]
        }
      ]
    })
  })

  test('decodes recursive Region objects with child nodes and path boundaries into reusable geometry', () => {
    const buffer = new ArrayBuffer(80)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 2, true)

    view.setUint32(8, 0x00000002, true)

    view.setUint32(12, 0x10000000, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 10, true)
    view.setFloat32(28, 10, true)

    view.setUint32(32, 0x10000001, true)
    view.setInt32(36, 40, true)

    view.setUint32(40, 0xdbc01002, true)
    view.setUint32(44, 3, true)
    view.setUint32(48, 0, true)
    view.setFloat32(52, 20, true)
    view.setFloat32(56, 0, true)
    view.setFloat32(60, 30, true)
    view.setFloat32(64, 0, true)
    view.setFloat32(68, 20, true)
    view.setFloat32(72, 10, true)
    new Uint8Array(buffer, 76, 4).set([0, 1, 0x81, 0])

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (4 << 8) | 1,
        dataOffset: 0,
        dataSize: 80
      },
      {
        view,
        records: []
      }
    )

    expect(object).toEqual({
      kind: 'region',
      type: 'tree',
      nodeCount: 3,
      root: {
        type: 'or',
        left: {
          type: 'rect',
          rect: { x: 0, y: 0, width: 10, height: 10 }
        },
        right: {
          type: 'path',
          path: {
            kind: 'path',
            flags: 0,
            figures: [
              {
                closed: true,
                points: [
                  { x: 20, y: 0 },
                  { x: 30, y: 0 },
                  { x: 20, y: 10 }
                ]
              }
            ]
          }
        }
      },
      geometry: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ]
        ],
        [
          [
            [20, 0],
            [30, 0],
            [20, 10],
            [20, 0]
          ]
        ]
      ]
    })
  })

  test('decodes pen objects with optional stroke data and embedded brush objects', () => {
    const buffer = new ArrayBuffer(72)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x000001be, true)
    view.setUint32(12, 2, true)
    view.setFloat32(16, 6.5, true)
    view.setUint32(20, 2, true)
    view.setUint32(24, 1, true)
    view.setUint32(28, 2, true)
    view.setFloat32(32, 9.5, true)
    view.setUint32(36, 5, true)
    view.setFloat32(40, 1.25, true)
    view.setUint32(44, 3, true)
    view.setFloat32(48, 2, true)
    view.setFloat32(52, 1, true)
    view.setFloat32(56, 0.5, true)
    view.setUint32(60, 0xdbc01002, true)
    view.setUint32(64, 0, true)
    view.setUint32(68, 0xff336699, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (2 << 8) | 1,
        dataOffset: 0,
        dataSize: 72
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'pen',
      unit: 2,
      width: 6.5,
      startCap: 'round',
      endCap: 'square',
      lineJoin: 'round',
      miterLimit: 9.5,
      dashStyle: 'custom',
      dashOffset: 1.25,
      dashPattern: [2, 1, 0.5],
      dashPatternUnit: 'penWidth',
      brush: {
        kind: 'brush',
        type: 'solid',
        color: 'rgba(51, 102, 153, 1)'
      },
      color: 'rgba(51, 102, 153, 1)'
    })
  })

  test('decodes EMF+ triangle dash caps distinctly from square caps', () => {
    const buffer = new ArrayBuffer(32)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x00000060, true)
    view.setUint32(12, 2, true)
    view.setFloat32(16, 2, true)
    view.setUint32(20, 1, true)
    view.setUint32(24, 3, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (2 << 8) | 1,
        dataOffset: 0,
        dataSize: 28
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'pen',
      dashStyle: 'dash',
      dashCap: 'triangle'
    })
  })

  test('decodes standalone adjustable arrow custom line cap objects', () => {
    const buffer = new ArrayBuffer(60)
    const view = new DataView(buffer)

    writeAdjustableArrowCustomLineCap(view, 0, {
      width: 3.5,
      height: 7,
      middleInset: 2,
      fillState: 1,
      lineStartCap: 1,
      lineEndCap: 2,
      lineJoin: 2,
      lineMiterLimit: 11,
      widthScale: 1.5
    })

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (9 << 8) | 3,
        dataOffset: 0,
        dataSize: 60
      },
      {
        view,
        records: []
      }
    )

    expect(object).toEqual({
      kind: 'customLineCap',
      type: 'adjustableArrow',
      width: 3.5,
      height: 7,
      middleInset: 2,
      fillState: true,
      lineStartCap: 1,
      lineEndCap: 2,
      lineJoin: 2,
      lineMiterLimit: 11,
      widthScale: 1.5
    })
  })

  test('decodes default custom line cap objects with optional fill and line paths', () => {
    const buffer = new ArrayBuffer(160)
    const view = new DataView(buffer)

    writeDefaultCustomLineCap(view, 0, {
      customLineCapDataFlags: 0x00000003,
      baseCap: 1,
      baseInset: 0.5,
      widthScale: 2
    })
    let cursor = 56
    cursor += writeLengthPrefixedPath(
      view,
      cursor,
      [
        { x: 0, y: 0 },
        { x: -2, y: -1 },
        { x: -2, y: 1 }
      ],
      [0, 1, 0x81]
    )
    cursor += writeLengthPrefixedPath(
      view,
      cursor,
      [
        { x: 0, y: 0 },
        { x: -3, y: 0 }
      ],
      [0, 1]
    )

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (9 << 8) | 4,
        dataOffset: 0,
        dataSize: cursor
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'customLineCap',
      type: 'default',
      customLineCapDataFlags: 3,
      baseCap: 1,
      baseInset: 0.5,
      strokeStartCap: 0,
      strokeEndCap: 1,
      strokeJoin: 2,
      strokeMiterLimit: 9,
      widthScale: 2,
      fillHotSpot: { x: 1, y: 2 },
      lineHotSpot: { x: 3, y: 4 },
      fillPath: {
        kind: 'path',
        flags: 0,
        figures: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: -2, y: -1 },
              { x: -2, y: 1 }
            ]
          }
        ]
      },
      linePath: {
        kind: 'path',
        flags: 0,
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: -3, y: 0 }
            ]
          }
        ]
      }
    })
    expect(object).not.toHaveProperty('unsupported')
  })

  test('decodes pen custom caps after dash cap and dash offset flags', () => {
    const buffer = new ArrayBuffer(200)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x000018c0, true)
    view.setUint32(12, 2, true)
    view.setFloat32(16, 3, true)
    view.setUint32(20, 2, true)
    view.setFloat32(24, 3.5, true)
    view.setUint32(28, 60, true)
    writeAdjustableArrowCustomLineCap(view, 32, { width: 2, height: 4, middleInset: 1, widthScale: 1 })
    const endCapSize = 92
    view.setUint32(92, endCapSize, true)
    writeDefaultCustomLineCap(view, 96, { customLineCapDataFlags: 0x00000002, baseCap: 2, widthScale: 0.75 })
    writeLengthPrefixedPath(
      view,
      152,
      [
        { x: 0, y: 0 },
        { x: -4, y: 0 }
      ],
      [0, 1]
    )
    const brushOffset = 96 + endCapSize
    view.setUint32(brushOffset, 0xdbc01002, true)
    view.setUint32(brushOffset + 4, 0, true)
    view.setUint32(brushOffset + 8, 0xff112233, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (2 << 8) | 1,
        dataOffset: 0,
        dataSize: 200
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'pen',
      unit: 2,
      width: 3,
      dashCap: 'round',
      dashOffset: 3.5,
      customStartCap: {
        kind: 'customLineCap',
        type: 'adjustableArrow',
        width: 2,
        height: 4,
        middleInset: 1,
        widthScale: 1
      },
      customEndCap: {
        kind: 'customLineCap',
        type: 'default',
        baseCap: 2,
        widthScale: 0.75,
        linePath: {
          kind: 'path',
          figures: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: -4, y: 0 }
              ]
            }
          ]
        }
      },
      brush: {
        kind: 'brush',
        type: 'solid',
        color: 'rgba(17, 34, 51, 1)'
      },
      color: 'rgba(17, 34, 51, 1)'
    })
  })

  test('decodes standalone linear gradient brush objects', () => {
    const buffer = new ArrayBuffer(40)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 4, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, 0, true)
    view.setFloat32(16, 1, true)
    view.setFloat32(20, 2, true)
    view.setFloat32(24, 30, true)
    view.setFloat32(28, 40, true)
    view.setUint32(32, 0xffff0000, true)
    view.setUint32(36, 0xff0000ff, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (1 << 8) | 3,
        dataOffset: 0,
        dataSize: 40
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'brush',
      type: 'linearGradient',
      wrapMode: 'tile',
      rect: { x: 1, y: 2, width: 30, height: 40 },
      startColor: 'rgba(255, 0, 0, 1)',
      endColor: 'rgba(0, 0, 255, 1)'
    })
  })

  test('decodes linear gradient blend color positions before colors and vertical blend factors', () => {
    // EmfPlusLinearGradientBrushData layout (brushData starts at byte 8):
    // Flags(8) WrapMode(12) RectF(16..32) StartColor(32) EndColor(36)
    // Reserved1(40) Reserved2(44) OptionalData(48+). The two Reserved ARGB
    // fields sit between EndColor and OptionalData (GDI+ writes copies of
    // Start/EndColor there), so the preset block begins at byte 48, not 40.
    const presetBuffer = new ArrayBuffer(68)
    const presetView = new DataView(presetBuffer)

    presetView.setUint32(0, 0xdbc01002, true)
    presetView.setUint32(4, 4, true)
    presetView.setUint32(8, 0x00000004, true)
    presetView.setUint32(12, 0, true)
    presetView.setFloat32(16, 0, true)
    presetView.setFloat32(20, 0, true)
    presetView.setFloat32(24, 10, true)
    presetView.setFloat32(28, 0, true)
    presetView.setUint32(32, 0xff000000, true)
    presetView.setUint32(36, 0xffffffff, true)
    presetView.setUint32(40, 0xff000000, true) // Reserved1 (ignored)
    presetView.setUint32(44, 0xffffffff, true) // Reserved2 (ignored)
    presetView.setUint32(48, 2, true)
    presetView.setFloat32(52, 0, true)
    presetView.setFloat32(56, 1, true)
    presetView.setUint32(60, 0xffff0000, true)
    presetView.setUint32(64, 0xff0000ff, true)

    const presetObject = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (1 << 8) | 4,
        dataOffset: 0,
        dataSize: presetBuffer.byteLength
      },
      {
        view: presetView,
        records: []
      }
    )

    expect(presetObject.presetPositions).toEqual([0, 1])
    expect(presetObject.presetColors).toEqual(['rgba(255, 0, 0, 1)', 'rgba(0, 0, 255, 1)'])

    // Same layout: Reserved1/Reserved2 at bytes 40/44, blend block at byte 48.
    const blendBuffer = new ArrayBuffer(76)
    const blendView = new DataView(blendBuffer)

    blendView.setUint32(0, 0xdbc01002, true)
    blendView.setUint32(4, 4, true)
    blendView.setUint32(8, 0x00000010, true)
    blendView.setUint32(12, 0, true)
    blendView.setFloat32(16, 0, true)
    blendView.setFloat32(20, 0, true)
    blendView.setFloat32(24, 10, true)
    blendView.setFloat32(28, 0, true)
    blendView.setUint32(32, 0xff000000, true)
    blendView.setUint32(36, 0xffffffff, true)
    blendView.setUint32(40, 0xff000000, true) // Reserved1 (ignored)
    blendView.setUint32(44, 0xffffffff, true) // Reserved2 (ignored)
    blendView.setUint32(48, 3, true)
    blendView.setFloat32(52, 0, true)
    blendView.setFloat32(56, 0.5, true)
    blendView.setFloat32(60, 1, true)
    blendView.setFloat32(64, 0, true)
    blendView.setFloat32(68, 1, true)
    blendView.setFloat32(72, 0, true)

    const blendObject = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (1 << 8) | 4,
        dataOffset: 0,
        dataSize: blendBuffer.byteLength
      },
      {
        view: blendView,
        records: []
      }
    )

    expect(blendObject.blendPositions).toEqual([0, 0.5, 1])
    expect(blendObject.blendFactors).toEqual([0, 1, 0])
  })

  test('decodes standalone path gradient brush objects with closed spline boundaries', () => {
    const buffer = new ArrayBuffer(72)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 3, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, 4, true)
    view.setUint32(16, 0xffff0000, true)
    view.setFloat32(20, 5, true)
    view.setFloat32(24, 6, true)
    view.setUint32(28, 3, true)
    view.setUint32(32, 0xff0000ff, true)
    view.setUint32(36, 0xff00ff00, true)
    view.setUint32(40, 0xffffff00, true)
    view.setUint32(44, 3, true)
    view.setFloat32(48, 0, true)
    view.setFloat32(52, 0, true)
    view.setFloat32(56, 10, true)
    view.setFloat32(60, 0, true)
    view.setFloat32(64, 10, true)
    view.setFloat32(68, 10, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (1 << 8) | 4,
        dataOffset: 0,
        dataSize: 72
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'brush',
      type: 'pathGradient',
      wrapMode: 'clamp',
      centerColor: 'rgba(255, 0, 0, 1)',
      centerPoint: { x: 5, y: 6 },
      surroundingColors: [
        'rgba(0, 0, 255, 1)',
        'rgba(0, 255, 0, 1)',
        'rgba(255, 255, 0, 1)'
      ],
      boundaryPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ]
    })
    expect(object.boundaryPath.figures).toHaveLength(1)
    expect(object.boundaryPath.figures[0].closed).toBe(true)
    expect(object.boundaryPath.figures[0].segments).toHaveLength(3)
  })

  test('decodes standalone texture brush objects with transform and embedded image data', () => {
    const buffer = new ArrayBuffer(72)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, 0x00000002, true)
    view.setUint32(12, 4, true)
    view.setFloat32(16, 1, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 0, true)
    view.setFloat32(28, 1, true)
    view.setFloat32(32, 2, true)
    view.setFloat32(36, 3, true)

    view.setUint32(40, 0xdbc01002, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 1, true)
    view.setUint32(52, 1, true)
    view.setInt32(56, 4, true)
    view.setUint32(60, 32 << 8, true)
    view.setUint32(64, 0, true)
    new Uint8Array(buffer, 68, 4).set([0, 0, 255, 255])

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (1 << 8) | 6,
        dataOffset: 0,
        dataSize: 72
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'brush',
      type: 'texture',
      wrapMode: 'clamp',
      transform: [1, 0, 0, 1, 2, 3],
      image: {
        kind: 'image',
        format: 'bitmap',
        width: 1,
        height: 1,
        stride: 4,
        bitmapDataType: 0
      }
    })
    expect(Array.from(object.image.bytes)).toEqual([0, 0, 255, 255])
  })

  test('decodes EMF+ raw indexed bitmap palettes separately from pixel data', () => {
    const buffer = new ArrayBuffer(48)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 1, true)
    view.setUint32(8, 2, true)
    view.setUint32(12, 1, true)
    view.setInt32(16, 2, true)
    view.setUint32(20, 0x00030803, true)
    view.setUint32(24, 0, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 2, true)
    view.setUint32(36, 0xff0a141e, true)
    view.setUint32(40, 0x80646e78, true)
    view.setUint8(44, 1)
    view.setUint8(45, 0)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (5 << 8) | 6,
        dataOffset: 0,
        dataSize: 46
      },
      {
        view,
        records: []
      }
    )

    expect(object).toMatchObject({
      kind: 'image',
      format: 'bitmap',
      width: 2,
      height: 1,
      stride: 2,
      pixelFormat: 0x00030803,
      palette: {
        flags: 0,
        entries: [
          { red: 10, green: 20, blue: 30, alpha: 255 },
          { red: 100, green: 110, blue: 120, alpha: 128 }
        ]
      }
    })
    expect(Array.from(object.bytes)).toEqual([1, 0])
    expect(Array.from(object.rawBytes)).toEqual([
      0, 0, 0, 0,
      2, 0, 0, 0,
      30, 20, 10, 255,
      120, 110, 100, 128,
      1, 0
    ])
  })

  test('decodes base image-attributes objects with wrap-mode settings', () => {
    const buffer = new ArrayBuffer(24)
    const view = new DataView(buffer)

    view.setUint32(0, 0xdbc01002, true)
    view.setUint32(4, 1, true)
    view.setUint32(8, 3, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0, true)
    view.setUint32(20, 0, true)

    const object = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (8 << 8) | 2,
        dataOffset: 0,
        dataSize: 24
      },
      {
        view,
        records: []
      }
    )

    expect(object).toEqual({
      kind: 'imageAttributes',
      graphicsVersion: 0xdbc01002,
      attributeType: 1,
      wrapMode: 'tileFlipXY',
      wrapColor: 'rgba(0, 0, 0, 0)',
      clamp: false,
      objectClamp: false
    })
  })

  test('decodes serializable color-matrix effects for DrawImagePoints E-bit playback', () => {
    const buffer = new ArrayBuffer(120)
    const view = new DataView(buffer)
    const guid = [0x15, 0x26, 0x8f, 0x71, 0x33, 0x79, 0xe3, 0x40, 0xa5, 0x11, 0x5f, 0x68, 0xfe, 0x14, 0xdd, 0x74]

    for (let index = 0; index < guid.length; index += 1) {
      view.setUint8(index, guid[index])
    }

    view.setUint32(16, 100, true)

    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        view.setFloat32(20 + (row * 5 + column) * 4, row === column ? 1 : 0, true)
      }
    }

    view.setFloat32(20, 0, true)
    view.setFloat32(24, 0, true)
    view.setFloat32(28, 1, true)

    const effect = decodeEmfPlusSerializableObject(
      {
        type: 0x4038,
        flags: 0,
        dataOffset: 0,
        dataSize: 120
      },
      {
        view,
        records: []
      }
    )

    expect(effect).toEqual({
      kind: 'effect',
      type: 'colorMatrix',
      guid: '718f2615-7933-40e3-a511-5f68fe14dd74',
      matrix: [
        [0, 0, 1, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1]
      ]
    })
  })

  test('decodes standard serializable effect parameter blocks by GUID', () => {
    const cases = [
      {
        guid: '633c80a4-1843-482b-9ef2-be2834c5fdd4',
        payloadSize: 8,
        writePayload(view) {
          view.setFloat32(20, 2.5, true)
          view.setInt32(24, 1, true)
        },
        expected: {
          kind: 'effect',
          type: 'blur',
          guid: '633c80a4-1843-482b-9ef2-be2834c5fdd4',
          radius: 2.5,
          expandEdge: true
        }
      },
      {
        guid: 'd3a1dbe1-8ec4-4c17-9f4c-ea97ad1c343d',
        payloadSize: 8,
        writePayload(view) {
          view.setInt32(20, 64, true)
          view.setInt32(24, -10, true)
        },
        expected: {
          kind: 'effect',
          type: 'brightnessContrast',
          guid: 'd3a1dbe1-8ec4-4c17-9f4c-ea97ad1c343d',
          brightnessLevel: 64,
          contrastLevel: -10
        }
      },
      {
        guid: '537e597d-251e-48da-9664-29ca496b70f8',
        payloadSize: 12,
        writePayload(view) {
          view.setInt32(20, 10, true)
          view.setInt32(24, -20, true)
          view.setInt32(28, 30, true)
        },
        expected: {
          kind: 'effect',
          type: 'colorBalance',
          guid: '537e597d-251e-48da-9664-29ca496b70f8',
          cyanRed: 10,
          magentaGreen: -20,
          yellowBlue: 30
        }
      },
      {
        guid: '8b2dd6c3-eb07-4d87-a5f0-7108e26a9c5f',
        payloadSize: 12,
        writePayload(view) {
          view.setInt32(20, 15, true)
          view.setInt32(24, 25, true)
          view.setInt32(28, -5, true)
        },
        expected: {
          kind: 'effect',
          type: 'hueSaturationLightness',
          guid: '8b2dd6c3-eb07-4d87-a5f0-7108e26a9c5f',
          hueLevel: 15,
          saturationLevel: 25,
          lightnessLevel: -5
        }
      },
      {
        guid: '99c354ec-2a31-4f3a-8c34-17a803b33a25',
        payloadSize: 12,
        writePayload(view) {
          view.setInt32(20, 90, true)
          view.setInt32(24, 12, true)
          view.setInt32(28, 8, true)
        },
        expected: {
          kind: 'effect',
          type: 'levels',
          guid: '99c354ec-2a31-4f3a-8c34-17a803b33a25',
          highlight: 90,
          midtone: 12,
          shadow: 8
        }
      },
      {
        guid: '63cbf3ee-c526-402c-8f71-62c540bf5142',
        payloadSize: 8,
        writePayload(view) {
          view.setFloat32(20, 3, true)
          view.setFloat32(24, 75, true)
        },
        expected: {
          kind: 'effect',
          type: 'sharpen',
          guid: '63cbf3ee-c526-402c-8f71-62c540bf5142',
          radius: 3,
          amount: 75
        }
      },
      {
        guid: '1077af00-2848-4441-9489-44ad4c2d7a2c',
        payloadSize: 8,
        writePayload(view) {
          view.setInt32(20, 120, true)
          view.setInt32(24, 40, true)
        },
        expected: {
          kind: 'effect',
          type: 'tint',
          guid: '1077af00-2848-4441-9489-44ad4c2d7a2c',
          hue: 120,
          amount: 40
        }
      },
      {
        guid: 'dd6a0022-58e4-4a67-9d9b-d48eb881a53d',
        payloadSize: 12,
        writePayload(view) {
          view.setUint32(20, 2, true)
          view.setUint32(24, 3, true)
          view.setInt32(28, 45, true)
        },
        expected: {
          kind: 'effect',
          type: 'colorCurve',
          guid: 'dd6a0022-58e4-4a67-9d9b-d48eb881a53d',
          adjustment: 2,
          channel: 3,
          adjustValue: 45
        }
      }
    ]

    for (const testCase of cases) {
      const buffer = new ArrayBuffer(20 + testCase.payloadSize)
      const view = new DataView(buffer)

      writeGuidString(view, 0, testCase.guid)
      view.setUint32(16, testCase.payloadSize, true)
      testCase.writePayload(view)

      expect(
        decodeEmfPlusSerializableObject(
          {
            type: EmfPlusRecordType.SerializableObject,
            flags: 0,
            dataOffset: 0,
            dataSize: buffer.byteLength
          },
          {
            view,
            records: []
          }
        )
      ).toEqual(testCase.expected)
    }
  })

  test('decodes lookup-table and red-eye serializable effects with variable payloads', () => {
    const lutBuffer = new ArrayBuffer(20 + 1024)
    const lutView = new DataView(lutBuffer)

    writeGuidString(lutView, 0, 'a7ce72a9-0f7f-40d7-b3cc-d0c02d5c3212')
    lutView.setUint32(16, 1024, true)

    for (let index = 0; index < 256; index += 1) {
      lutView.setUint8(20 + index, 255 - index)
      lutView.setUint8(20 + 256 + index, index)
      lutView.setUint8(20 + 512 + index, (index + 1) & 0xff)
      lutView.setUint8(20 + 768 + index, 255)
    }

    const lutEffect = decodeEmfPlusSerializableObject(
      {
        type: EmfPlusRecordType.SerializableObject,
        flags: 0,
        dataOffset: 0,
        dataSize: lutBuffer.byteLength
      },
      {
        view: lutView,
        records: []
      }
    )

    expect(lutEffect).toMatchObject({
      kind: 'effect',
      type: 'colorLookupTable',
      guid: 'a7ce72a9-0f7f-40d7-b3cc-d0c02d5c3212'
    })
    expect(lutEffect.lutB[0]).toBe(255)
    expect(lutEffect.lutG[255]).toBe(255)
    expect(lutEffect.lutR[0]).toBe(1)
    expect(lutEffect.lutA[127]).toBe(255)

    const redEyeBuffer = new ArrayBuffer(20 + 36)
    const redEyeView = new DataView(redEyeBuffer)

    writeGuidString(redEyeView, 0, '74d29d05-69a4-4266-9549-3cc52836b632')
    redEyeView.setUint32(16, 36, true)
    redEyeView.setUint32(20, 2, true)
    redEyeView.setInt32(24, 1, true)
    redEyeView.setInt32(28, 2, true)
    redEyeView.setInt32(32, 3, true)
    redEyeView.setInt32(36, 4, true)
    redEyeView.setInt32(40, 5, true)
    redEyeView.setInt32(44, 6, true)
    redEyeView.setInt32(48, 7, true)
    redEyeView.setInt32(52, 8, true)

    expect(
      decodeEmfPlusSerializableObject(
        {
          type: EmfPlusRecordType.SerializableObject,
          flags: 0,
          dataOffset: 0,
          dataSize: redEyeBuffer.byteLength
        },
        {
          view: redEyeView,
          records: []
        }
      )
    ).toEqual({
      kind: 'effect',
      type: 'redEyeCorrection',
      guid: '74d29d05-69a4-4266-9549-3cc52836b632',
      numberOfAreas: 2,
      areas: [
        { left: 1, top: 2, right: 3, bottom: 4 },
        { left: 5, top: 6, right: 7, bottom: 8 }
      ]
    })
  })

  test('decodes font and string-format objects used by generic DrawString playback', () => {
    const fontBuffer = new ArrayBuffer(34)
    const fontView = new DataView(fontBuffer)
    const family = 'Arial'

    fontView.setUint32(0, 0xdbc01002, true)
    fontView.setFloat32(4, 18, true)
    fontView.setUint32(8, 2, true)
    fontView.setInt32(12, 3, true)
    fontView.setUint32(16, 0, true)
    fontView.setUint32(20, family.length, true)

    for (let index = 0; index < family.length; index += 1) {
      fontView.setUint16(24 + index * 2, family.charCodeAt(index), true)
    }

    const formatBuffer = new ArrayBuffer(56)
    const formatView = new DataView(formatBuffer)
    formatView.setUint32(0, 0xdbc01002, true)
    formatView.setUint32(4, 0, true)
    formatView.setUint32(8, 0x0409, true)
    formatView.setUint32(12, 1, true)
    formatView.setUint32(16, 2, true)
    formatView.setUint32(20, 0, true)
    formatView.setUint32(24, 0x0409, true)
    formatView.setFloat32(28, 0, true)
    formatView.setInt32(32, 0, true)
    formatView.setFloat32(36, 0, true)
    formatView.setFloat32(40, 0, true)
    formatView.setFloat32(44, 1, true)
    formatView.setUint32(48, 0, true)
    formatView.setInt32(52, 0, true)

    const fontObject = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (6 << 8) | 1,
        dataOffset: 0,
        dataSize: 34
      },
      {
        view: fontView,
        records: []
      }
    )
    const formatObject = decodeEmfPlusObject(
      {
        type: EmfPlusRecordType.Object,
        flags: (7 << 8) | 2,
        dataOffset: 0,
        dataSize: 56
      },
      {
        view: formatView,
        records: []
      }
    )

    expect(fontObject).toMatchObject({
      kind: 'font',
      emSize: 18,
      sizeUnit: 2,
      styleFlags: 3,
      familyName: 'Arial'
    })
    expect(fontObject.cssFont).toContain('italic')
    expect(fontObject.cssFont).toContain('bold')
    expect(fontObject.cssFont).toContain('18px')
    expect(formatObject).toMatchObject({
      kind: 'stringFormat',
      stringAlignment: 1,
      lineAlign: 2,
      tracking: 1,
      textAlign: 'center',
      textBaseline: 'bottom'
    })
  })
})

describe('parseEmfPlusRecords', () => {
  test('uses spec-correct EMF+ record ids for drawing, property, and clipping records', () => {
    expect(EmfPlusRecordType.Comment).toBe(0x4003)
    expect(EmfPlusRecordType.MultiFormatStart).toBe(0x4005)
    expect(EmfPlusRecordType.MultiFormatSection).toBe(0x4006)
    expect(EmfPlusRecordType.MultiFormatEnd).toBe(0x4007)
    expect(EmfPlusRecordType.DrawRects).toBe(0x400b)
    expect(EmfPlusRecordType.FillPolygon).toBe(0x400c)
    expect(EmfPlusRecordType.FillEllipse).toBe(0x400e)
    expect(EmfPlusRecordType.DrawEllipse).toBe(0x400f)
    expect(EmfPlusRecordType.FillPie).toBe(0x4010)
    expect(EmfPlusRecordType.DrawPie).toBe(0x4011)
    expect(EmfPlusRecordType.DrawArc).toBe(0x4012)
    expect(EmfPlusRecordType.FillRegion).toBe(0x4013)
    expect(EmfPlusRecordType.DrawBeziers).toBe(0x4019)
    expect(EmfPlusRecordType.DrawImage).toBe(0x401a)
    expect(EmfPlusRecordType.DrawString).toBe(0x401c)
    expect(EmfPlusRecordType.SetTextContrast).toBe(0x4020)
    expect(EmfPlusRecordType.SetCompositingMode).toBe(0x4023)
    expect(EmfPlusRecordType.OffsetClip).toBe(0x4035)
    expect(EmfPlusRecordType.DrawDriverString).toBe(0x4036)
    expect(EmfPlusRecordType.StrokeFillPath).toBe(0x4037)
    expect(EmfPlusRecordType.SerializableObject).toBe(0x4038)
    expect(EmfPlusRecordType.SetTSGraphics).toBe(0x4039)
    expect(EmfPlusRecordType.SetTSClip).toBe(0x403a)
  })

  test('parses offsets and data offsets for a valid record', () => {
    const buffer = new ArrayBuffer(16)
    const view = new DataView(buffer)

    writeEmfPlusRecord(view, 4, {
      type: EmfPlusRecordType.Header,
      size: 12,
      dataSize: 0
    })

    const records = parseEmfPlusRecords(view, 4, 12)

    expect(records).toEqual([
      {
        type: EmfPlusRecordType.Header,
        flags: 0,
        size: 12,
        dataSize: 0,
        offset: 4,
        dataOffset: 16
      }
    ])
  })

  test('throws when the record size is smaller than the EMF+ header', () => {
    const buffer = new ArrayBuffer(12)
    const view = new DataView(buffer)

    writeEmfPlusRecord(view, 0, {
      type: EmfPlusRecordType.Header,
      size: 11,
      dataSize: 0
    })

    expect(() => parseEmfPlusRecords(view, 0, 12)).toThrow(/size/i)
  })

  test('throws when dataSize exceeds the declared record payload', () => {
    const buffer = new ArrayBuffer(12)
    const view = new DataView(buffer)

    writeEmfPlusRecord(view, 0, {
      type: EmfPlusRecordType.Header,
      size: 12,
      dataSize: 1
    })

    expect(() => parseEmfPlusRecords(view, 0, 12)).toThrow(/dataSize/i)
  })

  test('throws when the EMF+ stream contains trailing bytes', () => {
    const buffer = new ArrayBuffer(16)
    const view = new DataView(buffer)

    writeEmfPlusRecord(view, 0, {
      type: EmfPlusRecordType.Header,
      size: 12,
      dataSize: 0
    })

    expect(() => parseEmfPlusRecords(view, 0, 16)).toThrow(/trailing/i)
  })
})
