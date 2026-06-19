import { describe, expect, test } from 'vitest'
import { createPlaybackRuntime, playParsedMetafile } from '../../src/runtime/playback.js'
import { GraphicsState } from '../../src/runtime/graphics-state.js'
import { ObjectStore } from '../../src/runtime/object-store.js'
import { EMR_COMMENT, EMR_EOF, EMR_HEADER, EMR_RECTANGLE, EMR_SETMAPMODE } from '../../src/emf/constants.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'

describe('playParsedMetafile', () => {
  test('sizes the backend from the metafile bounds and normalizes the origin', () => {
    const calls = []
    const backend = {
      resize(width, height) {
        calls.push(['resize', width, height])
      },
      clear() {
        calls.push(['clear'])
      },
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      }
    }

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: {
            left: 32,
            top: 179,
            right: 149,
            bottom: 248
          },
          deviceWidth: 992,
          deviceHeight: 1292
        },
        records: []
      },
      backend
    )

    expect(runtime.state).toBeInstanceOf(GraphicsState)
    expect(runtime.objects).toBeInstanceOf(ObjectStore)
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
    expect(calls).toEqual([
      ['resize', 117, 69],
      ['clear'],
      ['setTransform', [1, 0, 0, 1, -32, -179]]
    ])
  })

  test('falls back to device size or 1x1 canvas when bounds are unusable', () => {
    const calls = []
    const backend = {
      resize(width, height) {
        calls.push(['resize', width, height])
      },
      clear() {
        calls.push(['clear'])
      },
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      }
    }

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
          },
          deviceWidth: 0,
          deviceHeight: 0
        },
        records: [
          { type: EMR_HEADER },
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.Header },
              { type: EmfPlusRecordType.GetDC },
              { type: EmfPlusRecordType.EndOfFile }
            ]
          }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      ['resize', 1, 1],
      ['clear'],
      ['setTransform', [1, 0, 0, 1, 0, 0]]
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('honors explicit output size overrides', () => {
    const calls = []
    const backend = {
      resize(width, height) {
        calls.push(['resize', width, height])
      },
      clear() {
        calls.push(['clear'])
      },
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      }
    }

    playParsedMetafile(
      {
        header: {
          bounds: {
            left: 32,
            top: 179,
            right: 149,
            bottom: 248
          },
          deviceWidth: 992,
          deviceHeight: 1292
        },
        records: []
      },
      backend,
      {
        width: 234,
        height: 138
      }
    )

    expect(calls).toEqual([
      ['resize', 234, 138],
      ['clear'],
      ['setTransform', [2, 0, 0, 2, -64, -358]]
    ])
  })

  test('skips classic and EMF+ lifecycle records when tracking unsupported entries', () => {
    const backend = {
      resize() {},
      clear() {},
      setTransform() {}
    }

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        records: [
          { type: EMR_HEADER },
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.Header },
              { type: EmfPlusRecordType.Comment },
              { type: EmfPlusRecordType.GetDC },
              { type: EmfPlusRecordType.MultiFormatStart },
              { type: EmfPlusRecordType.MultiFormatSection },
              { type: EmfPlusRecordType.MultiFormatEnd },
              { type: EmfPlusRecordType.EndOfFile },
              { type: 0x4038 }
            ]
          },
          { type: EMR_EOF }
        ]
      },
      backend
    )

    expect(runtime.unsupported).toEqual([])
  })

  test('records diagnostics for unsupported records while keeping legacy unsupported strings', () => {
    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        records: [{ type: 0x1234, offset: 40, dataOffset: 48, dataSize: 0 }]
      },
      {
        resize() {},
        clear() {},
        setTransform() {}
      }
    )

    expect(runtime.unsupported).toEqual(['emf:0x1234'])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'unsupported',
        code: 'unsupported-record',
        message: 'emf:0x1234',
        source: 'emf',
        recordType: 0x1234,
        recordOffset: 40,
        capability: 'record-dispatch'
      })
    ])
  })

  test('records diagnostics for runtime warnings while keeping legacy warning strings', () => {
    const runtime = createPlaybackRuntime(
      {
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        records: []
      },
      {
        resize() {},
        clear() {},
        setTransform() {}
      }
    )

    runtime.addWarning('diagnostic warning', {
      source: 'runtime',
      capability: 'diagnostics-test'
    })

    expect(runtime.warnings).toEqual(['diagnostic warning'])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'runtime-warning',
        message: 'diagnostic warning',
        source: 'runtime',
        capability: 'diagnostics-test'
      })
    ])
  })

  test('recovers classic playback out-of-bounds errors with record diagnostics and continues', () => {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(0, 7, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        view,
        records: [
          { type: EMR_SETMAPMODE, offset: 40, dataOffset: 32, dataSize: 4 },
          { type: EMR_SETMAPMODE, offset: 48, dataOffset: 0, dataSize: 4 }
        ]
      },
      {
        resize() {},
        clear() {},
        setTransform() {}
      }
    )

    expect(runtime.classicState.mapMode).toBe(7)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.warnings).toHaveLength(1)
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'record-decode-out-of-bounds',
        source: 'emf',
        recordType: EMR_SETMAPMODE,
        recordOffset: 40,
        capability: 'record-playback'
      })
    ])
  })

  test('recovers EMF+ playback errors with object id diagnostics and keeps later records alive', () => {
    const runtime = playParsedMetafile(
      {
        hasEmfPlus: true,
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        view: new DataView(new ArrayBuffer(8)),
        records: [
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.DrawLines, flags: 5, offset: 20, dataOffset: 32, dataSize: 4 },
              { type: EmfPlusRecordType.GetDC, offset: 28, dataOffset: 0, dataSize: 0 }
            ]
          }
        ]
      },
      {
        resize() {},
        clear() {},
        setTransform() {}
      }
    )

    expect(runtime.allowClassicDrawingRecords).toBe(true)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'record-decode-out-of-bounds',
        source: 'emfplus',
        recordType: EmfPlusRecordType.DrawLines,
        recordOffset: 20,
        objectId: 5,
        capability: 'record-playback'
      })
    ])
  })

  test('reports EMF+ object decode failures with a dedicated diagnostic code', () => {
    const runtime = playParsedMetafile(
      {
        hasEmfPlus: true,
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        view: new DataView(new ArrayBuffer(8)),
        records: [
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              {
                type: EmfPlusRecordType.Object,
                flags: (2 << 8) | 7,
                offset: 20,
                dataOffset: 32,
                dataSize: 20
              }
            ]
          }
        ]
      },
      {
        resize() {},
        clear() {},
        setTransform() {}
      }
    )

    expect(runtime.unsupported).toEqual([])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'object-decode-failed',
        source: 'emfplus',
        recordType: EmfPlusRecordType.Object,
        recordOffset: 20,
        objectId: 7,
        capability: 'record-playback'
      })
    ])
  })

  test('skips classic drawing records in EMF+ playback until GetDC is encountered', () => {
    const calls = []
    const buffer = new ArrayBuffer(64)
    const view = new DataView(buffer)
    view.setInt32(0, 1, true)
    view.setInt32(4, 2, true)
    view.setInt32(8, 5, true)
    view.setInt32(12, 6, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 10, bottom: 10 },
          deviceWidth: 10,
          deviceHeight: 10
        },
        view,
        hasEmfPlus: true,
        records: [
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.Header, flags: 1 }
            ]
          },
          {
            type: EMR_RECTANGLE,
            dataOffset: 0,
            dataSize: 16
          },
          {
            type: EMR_EOF
          }
        ]
      },
      {
        resize() {},
        clear() {},
        setTransform() {},
        fillRect(rect) {
          calls.push(['fillRect', rect])
        },
        strokeRect(rect) {
          calls.push(['strokeRect', rect])
        }
      }
    )

    expect(calls).toEqual([])
  })

  test('processes classic drawing records only inside the EMF+ GetDC bridge', () => {
    const calls = []
    const buffer = new ArrayBuffer(64)
    const view = new DataView(buffer)
    view.setInt32(0, 1, true)
    view.setInt32(4, 2, true)
    view.setInt32(8, 5, true)
    view.setInt32(12, 6, true)
    view.setInt32(16, 10, true)
    view.setInt32(20, 11, true)
    view.setInt32(24, 14, true)
    view.setInt32(28, 15, true)
    view.setUint32(32, 0x80000004, true)
    view.setUint32(36, 0x80000007, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 20, bottom: 20 },
          deviceWidth: 20,
          deviceHeight: 20
        },
        view,
        hasEmfPlus: true,
        records: [
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.Header, flags: 1 },
              { type: EmfPlusRecordType.GetDC }
            ]
          },
          {
            type: 0x25,
            dataOffset: 32,
            dataSize: 4
          },
          {
            type: 0x25,
            dataOffset: 36,
            dataSize: 4
          },
          {
            type: EMR_RECTANGLE,
            dataOffset: 0,
            dataSize: 16
          },
          {
            type: EMR_COMMENT,
            emfPlusRecords: [
              { type: EmfPlusRecordType.SetAntiAliasMode, flags: 0 }
            ]
          },
          {
            type: EMR_RECTANGLE,
            dataOffset: 16,
            dataSize: 16
          },
          {
            type: EMR_EOF
          }
        ]
      },
      {
        resize() {},
        clear() {},
        setTransform() {},
        fillRect(rect) {
          calls.push(['fillRect', rect])
        },
        strokeRect(rect) {
          calls.push(['strokeRect', rect])
        }
      }
    )

    expect(calls).toEqual([
      ['fillRect', { left: 1, top: 2, right: 5, bottom: 6 }],
      ['strokeRect', { left: 1, top: 2, right: 5, bottom: 6 }]
    ])
  })
})
