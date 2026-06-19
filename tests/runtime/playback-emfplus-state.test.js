import { describe, expect, test } from 'vitest'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { playParsedMetafile } from '../../src/runtime/playback.js'

describe('EMF+ state playback', () => {
  test('applies save/restore, transform, and clip records', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {
        calls.push(['save'])
      },
      restore() {
        calls.push(['restore'])
      },
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      }
    }

    const view = new DataView(new ArrayBuffer(128))
    view.setFloat32(12, 1.5, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 1.5, true)
    view.setFloat32(28, 10, true)
    view.setFloat32(32, 20, true)
    view.setFloat32(44, 5, true)
    view.setFloat32(48, 6, true)
    view.setFloat32(52, 70, true)
    view.setFloat32(56, 80, true)
    view.setUint32(68, 1, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 120, bottom: 80 },
          deviceWidth: 120,
          deviceHeight: 80
        },
        view,
        records: [
          {
            type: 0x46,
            emfPlusRecords: [
              { type: EmfPlusRecordType.Save, dataOffset: 68, flags: 0 },
              { type: EmfPlusRecordType.SetWorldTransform, dataOffset: 12, flags: 0 },
              { type: EmfPlusRecordType.SetClipRect, dataOffset: 44, flags: 0x0100 },
              { type: EmfPlusRecordType.Restore, dataOffset: 68, flags: 0 }
            ]
          }
        ]
      },
      backend
    )

    const stateCalls = calls.slice(1)

    expect(stateCalls[0][0]).toBe('save')
    expect(stateCalls[1][0]).toBe('setTransform')
    expect(stateCalls[2][0]).toBe('clipRect')
    expect(stateCalls[3][0]).toBe('restore')
  })

  test.each([
    ['Restore', EmfPlusRecordType.Restore, 'EmfPlusRestore 9 has no matching Save frame; graphics state left unchanged'],
    [
      'EndContainer',
      EmfPlusRecordType.EndContainer,
      'EmfPlusEndContainer 9 has no matching BeginContainer frame; graphics state left unchanged'
    ]
  ])('degrades an unmatched EMF+ %s to a warning instead of unsupported', (_label, recordType, message) => {
    let backendDepth = 0
    const backend = {
      resize() {},
      clear() {},
      save() {
        backendDepth += 1
      },
      restore() {
        backendDepth -= 1
      },
      setTransform() {}
    }

    const view = new DataView(new ArrayBuffer(48))
    view.setFloat32(12, 1.5, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 1.5, true)
    view.setFloat32(28, 10, true)
    view.setFloat32(32, 20, true)
    view.setUint32(40, 9, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 120, bottom: 80 },
          deviceWidth: 120,
          deviceHeight: 80
        },
        view,
        records: [
          {
            type: 0x46,
            emfPlusRecords: [
              { type: EmfPlusRecordType.SetWorldTransform, dataOffset: 12, flags: 0 },
              { type: recordType, dataOffset: 40, flags: 0 }
            ]
          }
        ]
      },
      backend
    )

    // GDI+ no-ops a restore with an unknown token: state, frames, and backend
    // stack must all be untouched, and the record must not count unsupported.
    expect(runtime.state.current.worldTransform).toEqual([1.5, 0, 0, 1.5, 10, 20])
    expect(runtime.stateFrames).toEqual([])
    expect(backendDepth).toBe(0)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.warnings).toEqual([message])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'restore-dc-unmatched', recordType })
    )
  })

  test('composes EMF+ world transforms with the viewport transform', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      clipRect() {}
    }

    const view = new DataView(new ArrayBuffer(64))
    view.setFloat32(12, 1.5, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 1.5, true)
    view.setFloat32(28, 10, true)
    view.setFloat32(32, 20, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 32, top: 10, right: 132, bottom: 60 },
          deviceWidth: 120,
          deviceHeight: 80
        },
        view,
        records: [
          {
            type: 0x46,
            emfPlusRecords: [{ type: EmfPlusRecordType.SetWorldTransform, dataOffset: 12, flags: 0 }]
          }
        ]
      },
      backend,
      {
        width: 200,
        height: 100
      }
    )

    expect(calls).toEqual([
      ['setTransform', [2, 0, 0, 2, -64, -20]],
      ['setTransform', [3, 0, 0, 3, -44, 20]]
    ])
  })

  test('composes classic mapping with EMF+ world transforms through shared transform state', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      clipRect() {}
    }

    const view = new DataView(new ArrayBuffer(64))
    view.setInt32(0, 10, true)
    view.setInt32(4, 20, true)
    view.setInt32(8, 50, true)
    view.setInt32(12, 40, true)
    view.setInt32(16, 100, true)
    view.setInt32(20, 200, true)
    view.setInt32(24, 200, true)
    view.setInt32(28, 80, true)
    view.setUint32(32, 8, true) // MM_ANISOTROPIC so window/viewport extents drive the mapping
    view.setFloat32(40, 1.5, true)
    view.setFloat32(44, 0, true)
    view.setFloat32(48, 0, true)
    view.setFloat32(52, 1.5, true)
    view.setFloat32(56, 10, true)
    view.setFloat32(60, 20, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 200 },
          deviceWidth: 200,
          deviceHeight: 200
        },
        view,
        records: [
          { type: 0x00000011, dataOffset: 32, dataSize: 4 },
          { type: 0x0000000a, dataOffset: 0, dataSize: 8 },
          { type: 0x00000009, dataOffset: 8, dataSize: 8 },
          { type: 0x0000000c, dataOffset: 16, dataSize: 8 },
          { type: 0x0000000b, dataOffset: 24, dataSize: 8 },
          {
            type: 0x46,
            emfPlusRecords: [{ type: EmfPlusRecordType.SetWorldTransform, dataOffset: 40, flags: 0 }]
          }
        ]
      },
      backend
    )

    expect(runtime.transform.mappingTransform).toEqual([4, 0, 0, 2, 60, 160])
    expect(runtime.transform.getEffectiveTransform()).toEqual([6, 0, 0, 3, 100, 200])
    expect(calls.at(-1)).toEqual(['setTransform', [6, 0, 0, 3, 100, 200]])
  })

  test('applies EMF+ graphics quality state before drawing records', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      applyGraphicsState(state) {
        calls.push(['applyGraphicsState', state.compositingMode, state.interpolationMode, state.pixelOffsetMode])
      },
      fillRect(rect, brush) {
        calls.push(['fillRect', rect, brush.color])
      }
    }

    const view = new DataView(new ArrayBuffer(64))
    view.setUint32(8, 0xff112233, true)
    view.setUint32(12, 1, true)
    view.setFloat32(16, 2, true)
    view.setFloat32(20, 3, true)
    view.setFloat32(24, 20, true)
    view.setFloat32(28, 10, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 40, bottom: 30 },
          deviceWidth: 40,
          deviceHeight: 30
        },
        view,
        records: [
          {
            type: 0x46,
            emfPlusRecords: [
              { type: EmfPlusRecordType.SetCompositingMode, flags: 1, dataOffset: 0, dataSize: 0 },
              { type: EmfPlusRecordType.SetInterpolationMode, flags: 7, dataOffset: 0, dataSize: 0 },
              { type: EmfPlusRecordType.SetPixelOffsetMode, flags: 4, dataOffset: 0, dataSize: 0 },
              { type: EmfPlusRecordType.FillRects, flags: 0x8000, dataOffset: 8, dataSize: 24 }
            ]
          }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      ['applyGraphicsState', 'sourceOver', 'default', 'default'],
      ['applyGraphicsState', 'sourceCopy', 'default', 'default'],
      ['applyGraphicsState', 'sourceCopy', 7, 'default'],
      ['applyGraphicsState', 'sourceCopy', 7, 4],
      ['fillRect', { left: 2, top: 3, right: 22, bottom: 13 }, 'rgba(17, 34, 51, 1)']
    ])
  })
})
