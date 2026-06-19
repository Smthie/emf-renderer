import { describe, expect, test } from 'vitest'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { playParsedMetafile } from '../../src/runtime/playback.js'
import {
  EMR_ARC,
  EMR_BEGINPATH,
  EMR_BITBLT,
  EMR_CHORD,
  EMR_CLOSEFIGURE,
  EMR_CREATEBRUSHINDIRECT,
  EMR_CREATEPEN,
  EMR_DELETEOBJECT,
  EMR_ELLIPSE,
  EMR_ENDPATH,
  EMR_EXTCREATEFONTINDIRECTW,
  EMR_EXTCREATEPEN,
  EMR_EXTTEXTOUTA,
  EMR_EXTSELECTCLIPRGN,
  EMR_FILLPATH,
  EMR_FLATTENPATH,
  EMR_ALPHABLEND,
  EMR_INTERSECTCLIPRECT,
  EMR_LINETO,
  EMR_MASKBLT,
  EMR_MODIFYWORLDTRANSFORM,
  EMR_PLGBLT,
  EMR_POLYBEZIER16,
  EMR_POLYBEZIERTO16,
  EMR_MOVETOEX,
  EMR_POLYGON16,
  EMR_POLYLINE16,
  EMR_POLYLINETO16,
  EMR_POLYPOLYLINE16,
  EMR_PIE,
  EMR_RESTOREDC,
  EMR_RECTANGLE,
  EMR_SAVEDC,
  EMR_SETARCDIRECTION,
  EMR_SELECTOBJECT,
  EMR_SELECTCLIPPATH,
  EMR_SELECTPALETTE,
  EMR_SETBKCOLOR,
  EMR_SETBKMODE,
  EMR_SETICMMODE,
  EMR_SETLAYOUT,
  EMR_SETMAPMODE,
  EMR_SETMETARGN,
  EMR_SETROP2,
  EMR_SETSTRETCHBLTMODE,
  EMR_SETDIBITSTODEVICE,
  EMR_STRETCHBLT,
  EMR_SETMITERLIMIT,
  EMR_STRETCHDIBITS,
  EMR_SETPOLYFILLMODE,
  EMR_SETTEXTALIGN,
  EMR_SETTEXTJUSTIFICATION,
  EMR_SETTEXTCOLOR,
  EMR_TRANSPARENTBLT,
  EMR_SETVIEWPORTEXTEX,
  EMR_SETVIEWPORTORGEX,
  EMR_SETWORLDTRANSFORM,
  EMR_SETWINDOWEXTEX,
  EMR_SETWINDOWORGEX,
  EMR_WIDENPATH
} from '../../src/emf/constants.js'

const STOCK_WHITE_BRUSH = 0x80000000
const STOCK_NULL_BRUSH = 0x80000005
const STOCK_NULL_PEN = 0x80000008

function writeUtf16Le(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(offset + index * 2, text.charCodeAt(index), true)
  }
}

describe('classic EMF playback', () => {
  test('creates objects, selects them, and draws a rectangle', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }

    const view = new DataView(new ArrayBuffer(96))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 2, true)
    view.setUint32(36, 0x000000ff, true)
    view.setInt32(56, 10, true)
    view.setInt32(60, 20, true)
    view.setInt32(64, 110, true)
    view.setInt32(68, 70, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 120, bottom: 80 },
          deviceWidth: 120,
          deviceHeight: 80
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 16 },
          { type: EMR_SELECTOBJECT, dataOffset: 8, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 24, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 56, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('fillRect')
    expect(calls[1][0]).toBe('strokeRect')
  })

  test('passes classic ROP2 state to backend graphics state and selected pen strokes', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      applyGraphicsState(state, options) {
        calls.push(['applyGraphicsState', options.classicRop2])
      },
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }

    const view = new DataView(new ArrayBuffer(80))
    view.setUint32(8, 7, true)
    view.setInt32(16, 4, true)
    view.setInt32(20, 5, true)
    view.setInt32(24, 30, true)
    view.setInt32(28, 25, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 40, bottom: 30 },
          deviceWidth: 40,
          deviceHeight: 30
        },
        view,
        records: [
          { type: EMR_SETROP2, dataOffset: 8, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 16, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls.filter((call) => call[0] === 'applyGraphicsState')).toEqual([
      ['applyGraphicsState', 13],
      ['applyGraphicsState', 7]
    ])
    expect(calls.find((call) => call[0] === 'strokeRect')[2]).toMatchObject({ rop2: 7 })
  })

  test('restores selected brush and pen on restore dc', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }

    const view = new DataView(new ArrayBuffer(128))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 0x00ff0000, true)
    view.setUint32(40, 3, true)
    view.setUint32(44, 0, true)
    view.setUint32(48, 1, true)
    view.setUint32(52, 0, true)
    view.setUint32(56, 0x000000ff, true)
    view.setUint32(64, 4, true)
    view.setUint32(68, 0, true)
    view.setUint32(72, 4, true)
    view.setUint32(76, 0, true)
    view.setUint32(80, 0x00000000, true)
    view.setUint32(84, 1, true)
    view.setUint32(88, 3, true)
    view.setUint32(92, 2, true)
    view.setUint32(96, 4, true)
    view.setInt32(100, -1, true)
    view.setInt32(104, 10, true)
    view.setInt32(108, 20, true)
    view.setInt32(112, 110, true)
    view.setInt32(116, 70, true)

    playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 120, bottom: 80 },
          deviceWidth: 120,
          deviceHeight: 80
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 24, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 40, dataSize: 20 },
          { type: EMR_CREATEPEN, dataOffset: 64, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 84, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 88, dataSize: 4 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SELECTOBJECT, dataOffset: 92, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 96, dataSize: 4 },
          { type: EMR_RESTOREDC, dataOffset: 100, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 104, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual([
      'fillRect',
      { left: 10, top: 20, right: 110, bottom: 70 },
      { kind: 'brush', color: 'rgb(0, 255, 0)' }
    ])
    expect(calls[1]).toEqual([
      'strokeRect',
      { left: 10, top: 20, right: 110, bottom: 70 },
      { kind: 'pen', color: 'rgb(255, 0, 0)', width: 1, miterLimit: 10 }
    ])
  })

  test('applies classic window and viewport mapping through save and restore', () => {
    const transforms = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        transforms.push([...matrix])
      }
    }
    const view = new DataView(new ArrayBuffer(52))
    view.setUint32(4, 8, true) // MM_ANISOTROPIC so window/viewport extents drive the mapping
    view.setInt32(8, 10, true)
    view.setInt32(12, 20, true)
    view.setInt32(16, 50, true)
    view.setInt32(20, 40, true)
    view.setInt32(24, 100, true)
    view.setInt32(28, 200, true)
    view.setInt32(32, 200, true)
    view.setInt32(36, 80, true)
    view.setInt32(40, 50, true)
    view.setInt32(44, 40, true)
    view.setInt32(48, -1, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 200 },
          deviceWidth: 200,
          deviceHeight: 200
        },
        view,
        records: [
          { type: EMR_SETMAPMODE, dataOffset: 4, dataSize: 4 },
          { type: EMR_SETWINDOWORGEX, dataOffset: 8, dataSize: 8 },
          { type: EMR_SETWINDOWEXTEX, dataOffset: 16, dataSize: 8 },
          { type: EMR_SETVIEWPORTORGEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_SETVIEWPORTEXTEX, dataOffset: 32, dataSize: 8 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SETVIEWPORTEXTEX, dataOffset: 40, dataSize: 8 },
          { type: EMR_RESTOREDC, dataOffset: 48, dataSize: 4 }
        ]
      },
      backend
    )

    expect(runtime.transform.mappingTransform).toEqual([4, 0, 0, 2, 60, 160])
    expect(runtime.transform.getEffectiveTransform()).toEqual([4, 0, 0, 2, 60, 160])
    expect(transforms.at(-1)).toEqual([4, 0, 0, 2, 60, 160])
    expect(runtime.unsupported).toEqual([])
  })

  test.each([
    ['relative depth', -2],
    ['absolute level', 1]
  ])('restores a classic DC by %s and unwinds every backend frame', (_label, savedDc) => {
    const transforms = []
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
      setTransform(matrix) {
        transforms.push([...matrix])
      }
    }
    const view = new DataView(new ArrayBuffer(100))
    const matrices = [
      [2, 0, 0, 2, 10, 20],
      [3, 0, 0, 3, 30, 40],
      [4, 0, 0, 4, 50, 60]
    ]

    for (const [matrixIndex, matrix] of matrices.entries()) {
      const offset = 4 + matrixIndex * 28

      for (const [valueIndex, value] of matrix.entries()) {
        view.setFloat32(offset + valueIndex * 4, value, true)
      }
    }

    view.setInt32(88, savedDc, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SETWORLDTRANSFORM, dataOffset: 32, dataSize: 24 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SETWORLDTRANSFORM, dataOffset: 60, dataSize: 24 },
          { type: EMR_RESTOREDC, dataOffset: 88, dataSize: 4 }
        ]
      },
      backend
    )

    expect(runtime.state.current.worldTransform).toEqual(matrices[0])
    expect(runtime.transform.getEffectiveTransform()).toEqual(matrices[0])
    expect(runtime.stateFrames).toEqual([])
    expect(backendDepth).toBe(0)
    expect(transforms.at(-1)).toEqual(matrices[0])
    expect(runtime.unsupported).toEqual([])
  })

  // Shared harness for the RestoreDC stack-depth tests below: four world
  // matrices pre-written at offsets 4/32/60/88, SavedDC slots free from 116,
  // and a backend that tracks its save/restore depth.
  function createSaveRestoreHarness() {
    const state = { backendDepth: 0, transforms: [] }
    const backend = {
      resize() {},
      clear() {},
      save() {
        state.backendDepth += 1
      },
      restore() {
        state.backendDepth -= 1
      },
      setTransform(matrix) {
        state.transforms.push([...matrix])
      }
    }
    const view = new DataView(new ArrayBuffer(160))
    const matrices = [
      [2, 0, 0, 2, 10, 20],
      [3, 0, 0, 3, 30, 40],
      [4, 0, 0, 4, 50, 60],
      [5, 0, 0, 5, 70, 80]
    ]

    for (const [matrixIndex, matrix] of matrices.entries()) {
      const offset = 4 + matrixIndex * 28

      for (const [valueIndex, value] of matrix.entries()) {
        view.setFloat32(offset + valueIndex * 4, value, true)
      }
    }

    const play = (records) =>
      playParsedMetafile(
        {
          header: {
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
            deviceWidth: 100,
            deviceHeight: 100
          },
          view,
          records
        },
        backend
      )

    return { view, matrices, state, play }
  }

  test('restores a mid-stack DC by absolute level and keeps the frames below it', () => {
    const { view, matrices, state, play } = createSaveRestoreHarness()
    view.setInt32(116, 2, true)

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 32, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 60, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 88, dataSize: 24 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 4 }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[1])
    expect(runtime.stateFrames).toHaveLength(1)
    expect(runtime.stateFrames[0].classicLevel).toBe(1)
    expect(state.backendDepth).toBe(1)
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test.each([
    ['relative depth', -2],
    ['absolute level', 1]
  ])('skips interleaved EMF+ frames when resolving a classic restore by %s', (_label, savedDc) => {
    const { view, matrices, state, play } = createSaveRestoreHarness()
    view.setInt32(116, savedDc, true)
    view.setUint32(124, 7, true)

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 32, dataSize: 24 },
      { type: 0x46, emfPlusRecords: [{ type: EmfPlusRecordType.Save, dataOffset: 124, flags: 0 }] },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 4 }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[0])
    expect(runtime.stateFrames).toEqual([])
    expect(state.backendDepth).toBe(0)
    expect(runtime.unsupported).toEqual([])
  })

  test('degrades an EMF+ Restore whose frame was spliced away by a classic RestoreDC', () => {
    const { view, matrices, state, play } = createSaveRestoreHarness()
    view.setInt32(116, -2, true)
    view.setUint32(124, 7, true)

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: 0x46, emfPlusRecords: [{ type: EmfPlusRecordType.Save, dataOffset: 124, flags: 0 }] },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 4 },
      { type: 0x46, emfPlusRecords: [{ type: EmfPlusRecordType.Restore, dataOffset: 124, flags: 0 }] }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[0])
    expect(runtime.stateFrames).toEqual([])
    expect(state.backendDepth).toBe(0)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.warnings).toEqual(['EmfPlusRestore 7 has no matching Save frame; graphics state left unchanged'])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'restore-dc-unmatched', source: 'emfplus' })
    )
  })

  test('reuses freed SaveDC levels so absolute restores target the newest frame', () => {
    const { view, matrices, state, play } = createSaveRestoreHarness()
    view.setInt32(116, -1, true)
    view.setInt32(120, 2, true)

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 32, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 4 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 60, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 88, dataSize: 24 },
      { type: EMR_RESTOREDC, dataOffset: 120, dataSize: 4 }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[2])
    expect(runtime.stateFrames).toHaveLength(1)
    expect(runtime.stateFrames[0].classicLevel).toBe(1)
    expect(state.backendDepth).toBe(1)
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test.each([
    ['zero', 0],
    ['a relative depth beyond the stack', -3],
    ['an unmatched absolute level', 7]
  ])('leaves the DC unchanged and warns when RestoreDC targets %s', (_label, savedDc) => {
    const { view, matrices, state, play } = createSaveRestoreHarness()
    view.setInt32(116, savedDc, true)

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 32, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 60, dataSize: 24 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 4 }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[2])
    expect(runtime.stateFrames).toHaveLength(2)
    expect(state.backendDepth).toBe(2)
    expect(runtime.warnings).toEqual([
      `RestoreDC ${savedDc} has no matching SaveDC frame (classic depth 2); DC state left unchanged`
    ])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'restore-dc-unmatched', recordType: EMR_RESTOREDC })
    )
    expect(runtime.unsupported).toEqual([])
  })

  test('degrades a truncated RestoreDC record to a warning without touching the stack', () => {
    const { view, matrices, state, play } = createSaveRestoreHarness()

    const runtime = play([
      { type: EMR_SETWORLDTRANSFORM, dataOffset: 4, dataSize: 24 },
      { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
      { type: EMR_RESTOREDC, dataOffset: 116, dataSize: 0 }
    ])

    expect(runtime.state.current.worldTransform).toEqual(matrices[0])
    expect(runtime.stateFrames).toHaveLength(1)
    expect(state.backendDepth).toBe(1)
    expect(runtime.warnings).toEqual(['RestoreDC record is truncated (dataSize=0); DC state left unchanged'])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'record-decode-failed', recordType: EMR_RESTOREDC })
    )
    expect(runtime.unsupported).toEqual([])
  })

  test('uses stock null objects and ext pens when replaying classic rectangles', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }
    const view = new DataView(new ArrayBuffer(84))
    view.setUint32(8, 3, true)
    view.setUint32(12, 56, true)
    view.setUint32(20, 56, true)
    view.setUint32(28, 0x00012000, true)
    view.setUint32(32, 75, true)
    view.setUint32(40, 0x00aaaaaa, true)
    view.setUint32(48, STOCK_WHITE_BRUSH, true)
    view.setUint32(52, 3, true)
    view.setInt32(56, 5, true)
    view.setInt32(60, 10, true)
    view.setInt32(64, 25, true)
    view.setInt32(68, 30, true)
    view.setUint32(72, STOCK_NULL_BRUSH, true)
    view.setUint32(76, STOCK_NULL_PEN, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEPEN, dataOffset: 8, dataSize: 48 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 52, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 56, dataSize: 16 },
          { type: EMR_SELECTOBJECT, dataOffset: 72, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 76, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 56, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'fillRect',
        { left: 5, top: 10, right: 25, bottom: 30 },
        { kind: 'brush', color: 'rgb(255, 255, 255)' }
      ],
      [
        'strokeRect',
        { left: 5, top: 10, right: 25, bottom: 30 },
        { kind: 'pen', color: 'rgb(170, 170, 170)', width: 75, lineJoin: 'miter', miterLimit: 10 }
      ]
    ])
    expect(runtime.selectedBrush).toBeNull()
    expect(runtime.selectedPen).toBeNull()
    expect(runtime.selectedBrushHandle).toBe(STOCK_NULL_BRUSH)
    expect(runtime.selectedPenHandle).toBe(STOCK_NULL_PEN)
    expect(runtime.unsupported).toEqual([])
  })

  test('restores stock objects selected before save dc', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }
    const view = new DataView(new ArrayBuffer(104))
    view.setUint32(8, 3, true)
    view.setUint32(12, 56, true)
    view.setUint32(20, 56, true)
    view.setUint32(28, 0x00012000, true)
    view.setUint32(32, 75, true)
    view.setUint32(40, 0x00aaaaaa, true)
    view.setUint32(48, STOCK_WHITE_BRUSH, true)
    view.setUint32(52, 3, true)
    view.setInt32(56, -1, true)
    view.setUint32(60, STOCK_NULL_BRUSH, true)
    view.setUint32(64, STOCK_NULL_PEN, true)
    view.setInt32(68, 5, true)
    view.setInt32(72, 10, true)
    view.setInt32(76, 25, true)
    view.setInt32(80, 30, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEPEN, dataOffset: 8, dataSize: 48 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 52, dataSize: 4 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SELECTOBJECT, dataOffset: 60, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 64, dataSize: 4 },
          { type: EMR_RESTOREDC, dataOffset: 56, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 68, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'fillRect',
        { left: 5, top: 10, right: 25, bottom: 30 },
        { kind: 'brush', color: 'rgb(255, 255, 255)' }
      ],
      [
        'strokeRect',
        { left: 5, top: 10, right: 25, bottom: 30 },
        { kind: 'pen', color: 'rgb(170, 170, 170)', width: 75, lineJoin: 'miter', miterLimit: 10 }
      ]
    ])
    expect(runtime.selectedBrushHandle).toBe(STOCK_WHITE_BRUSH)
    expect(runtime.selectedPenHandle).toBe(3)
    expect(runtime.unsupported).toEqual([])
  })

  test('replays polygon16 and polyline16 through shared path geometry and classic state', () => {
    const calls = []
    const transforms = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        transforms.push([...matrix])
      },
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }

    const view = new DataView(new ArrayBuffer(184))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 3, true)
    view.setUint32(40, 0x000000ff, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 2, true)
    view.setUint32(56, 7, true)
    view.setFloat32(60, 1, true)
    view.setFloat32(64, 0, true)
    view.setFloat32(68, 0, true)
    view.setFloat32(72, 1, true)
    view.setFloat32(76, 10, true)
    view.setFloat32(80, 20, true)
    view.setUint32(84, 4, true)
    view.setFloat32(88, 2, true)
    view.setFloat32(92, 0, true)
    view.setFloat32(96, 0, true)
    view.setFloat32(100, 3, true)
    view.setFloat32(104, 0, true)
    view.setFloat32(108, 0, true)
    view.setUint32(112, 2, true)
    view.setInt32(116, 0, true)
    view.setInt32(120, 0, true)
    view.setInt32(124, 4, true)
    view.setInt32(128, 4, true)
    view.setUint32(132, 4, true)
    view.setInt16(136, 0, true)
    view.setInt16(138, 0, true)
    view.setInt16(140, 4, true)
    view.setInt16(142, 0, true)
    view.setInt16(144, 4, true)
    view.setInt16(146, 4, true)
    view.setInt16(148, 0, true)
    view.setInt16(150, 4, true)
    view.setInt32(152, 0, true)
    view.setInt32(156, 0, true)
    view.setInt32(160, 6, true)
    view.setInt32(164, 3, true)
    view.setUint32(168, 3, true)
    view.setInt16(172, 1, true)
    view.setInt16(174, 1, true)
    view.setInt16(176, 3, true)
    view.setInt16(178, 2, true)
    view.setInt16(180, 6, true)
    view.setInt16(182, 3, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 44, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETPOLYFILLMODE, dataOffset: 52, dataSize: 4 },
          { type: EMR_SETMITERLIMIT, dataOffset: 56, dataSize: 4 },
          { type: EMR_MODIFYWORLDTRANSFORM, dataOffset: 60, dataSize: 28 },
          { type: EMR_MODIFYWORLDTRANSFORM, dataOffset: 88, dataSize: 28 },
          { type: EMR_POLYGON16, dataOffset: 116, dataSize: 36 },
          { type: EMR_POLYLINE16, dataOffset: 152, dataSize: 32 }
        ]
      },
      backend
    )

    // SET translate(10,20) then MWT_LEFTMULTIPLY scale(2,3): GDI applies the
    // new matrix to points FIRST, so the scale does not scale the prior
    // translate -> [2,0,0,3,10,20].
    expect(transforms.at(-1)).toEqual([2, 0, 0, 3, 10, 20])
    expect(calls).toEqual([
      [
        'fillPath',
        {
          figures: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
                { x: 0, y: 4 }
              ]
            }
          ]
        },
        { kind: 'brush', color: 'rgb(0, 255, 0)' },
        { fillMode: 'winding' }
      ],
      [
        'strokePath',
        {
          figures: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
                { x: 0, y: 4 }
              ]
            }
          ]
        },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 3, miterLimit: 7 }
      ],
      [
        'strokePath',
        {
          figures: [
            {
              closed: false,
              points: [
                { x: 1, y: 1 },
                { x: 3, y: 2 },
                { x: 6, y: 3 }
              ]
            }
          ]
        },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 3, miterLimit: 7 }
      ]
    ])
    expect(runtime.transform.getEffectiveTransform()).toEqual([2, 0, 0, 3, 10, 20])
    expect(runtime.unsupported).toEqual([])
  })

  test('supports classic modify world transform right multiply and identity', () => {
    const transforms = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        transforms.push([...matrix])
      }
    }
    const view = new DataView(new ArrayBuffer(92))
    view.setFloat32(8, 1, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 1, true)
    view.setFloat32(24, 10, true)
    view.setFloat32(28, 20, true)
    view.setUint32(32, 4, true)
    view.setFloat32(36, 2, true)
    view.setFloat32(40, 0, true)
    view.setFloat32(44, 0, true)
    view.setFloat32(48, 3, true)
    view.setFloat32(52, 0, true)
    view.setFloat32(56, 0, true)
    view.setUint32(60, 3, true)
    view.setUint32(88, 1, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_MODIFYWORLDTRANSFORM, dataOffset: 8, dataSize: 28 },
          { type: EMR_MODIFYWORLDTRANSFORM, dataOffset: 36, dataSize: 28 },
          { type: EMR_MODIFYWORLDTRANSFORM, dataOffset: 64, dataSize: 28 }
        ]
      },
      backend
    )

    // SET translate(10,20) then MWT_RIGHTMULTIPLY scale(2,3): GDI applies the
    // new matrix LAST, so the scale also scales the prior translate ->
    // [2,0,0,3,20,60]. Then IDENTITY resets to the base transform.
    expect(transforms).toEqual([
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 10, 20],
      [2, 0, 0, 3, 20, 60],
      [1, 0, 0, 1, 0, 0]
    ])
    expect(runtime.transform.getEffectiveTransform()).toEqual([1, 0, 0, 1, 0, 0])
    expect(runtime.unsupported).toEqual([])
  })

  test('restores fill mode and miter limit through save dc and routes rectangle through classic stroke semantics', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      },
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    const view = new DataView(new ArrayBuffer(164))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 4, true)
    view.setUint32(40, 0x000000ff, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 12, true)
    view.setUint32(56, 2, true)
    view.setInt32(60, -1, true)
    view.setUint32(64, 1, true)
    view.setUint32(68, 3, true)
    view.setUint32(72, 10, true)
    view.setInt32(76, 1, true)
    view.setInt32(80, 2, true)
    view.setInt32(84, 11, true)
    view.setInt32(88, 12, true)
    view.setInt32(92, 0, true)
    view.setInt32(96, 0, true)
    view.setInt32(100, 4, true)
    view.setInt32(104, 4, true)
    view.setUint32(108, 3, true)
    view.setInt16(112, 0, true)
    view.setInt16(114, 0, true)
    view.setInt16(116, 4, true)
    view.setInt16(118, 0, true)
    view.setInt16(120, 4, true)
    view.setInt16(122, 4, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 44, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETMITERLIMIT, dataOffset: 52, dataSize: 4 },
          { type: EMR_SETPOLYFILLMODE, dataOffset: 56, dataSize: 4 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SETMITERLIMIT, dataOffset: 64, dataSize: 4 },
          { type: EMR_SETPOLYFILLMODE, dataOffset: 68, dataSize: 4 },
          { type: EMR_RESTOREDC, dataOffset: 60, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 76, dataSize: 16 },
          { type: EMR_POLYGON16, dataOffset: 92, dataSize: 32 }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'fillRect',
        { left: 1, top: 2, right: 11, bottom: 12 },
        { kind: 'brush', color: 'rgb(0, 255, 0)' }
      ],
      [
        'strokeRect',
        { left: 1, top: 2, right: 11, bottom: 12 },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 4, miterLimit: 12 }
      ],
      [
        'fillPath',
        {
          figures: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 }
              ]
            }
          ]
        },
        { kind: 'brush', color: 'rgb(0, 255, 0)' },
        { fillMode: 'winding' }
      ],
      [
        'strokePath',
        {
          figures: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 }
              ]
            }
          ]
        },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 4, miterLimit: 12 }
      ]
    ])
    expect(runtime.classicState.fillMode).toBe('winding')
    expect(runtime.classicState.miterLimit).toBe(12)
    expect(runtime.unsupported).toEqual([])
  })

  test('replays classic raster records through the shared image surface path', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              createImageData(w, h) {
                return {
                  width: w,
                  height: h,
                  data: new Uint8ClampedArray(w * h * 4)
                }
              },
              putImageData() {}
            }
          }
        }
      },
      drawImageRect(image, destinationRect, sourceRect, options) {
        calls.push(['drawImageRect', image.width, image.height, destinationRect, sourceRect, options])
      }
    }
    const view = new DataView(new ArrayBuffer(264))
    view.setUint32(8, 4, true)

    view.setInt32(36, 3, true)
    view.setInt32(40, 4, true)
    view.setInt32(44, 0, true)
    view.setInt32(48, 0, true)
    view.setInt32(52, 2, true)
    view.setInt32(56, 2, true)
    view.setUint32(60, 92, true)
    view.setUint32(64, 48, true)
    view.setUint32(68, 140, true)
    view.setUint32(72, 8, true)
    view.setUint32(76, 0, true)
    view.setUint32(80, 0x00cc0020, true)
    view.setInt32(84, 2, true)
    view.setInt32(88, 2, true)

    view.setUint32(104, 40, true)
    view.setInt32(108, 2, true)
    view.setInt32(112, 2, true)
    view.setUint16(116, 1, true)
    view.setUint16(118, 1, true)
    view.setUint32(120, 0, true)
    view.setUint32(136, 0, true)
    view.setUint32(140, 0, true)
    view.setUint8(144, 0)
    view.setUint8(145, 0)
    view.setUint8(146, 0)
    view.setUint8(147, 0)
    view.setUint8(148, 255)
    view.setUint8(149, 255)
    view.setUint8(150, 255)
    view.setUint8(151, 0)
    view.setUint8(152, 0b10000000)
    view.setUint8(156, 0b01000000)

    view.setInt32(184, 9, true)
    view.setInt32(188, 10, true)
    view.setInt32(192, 11, true)
    view.setInt32(196, 12, true)
    view.setUint32(200, 0x00aa0029, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 20, bottom: 20 },
          deviceWidth: 20,
          deviceHeight: 20
        },
        view,
        records: [
          { type: EMR_SETSTRETCHBLTMODE, offset: 0, dataOffset: 8, dataSize: 4 },
          { type: EMR_STRETCHDIBITS, offset: 12, size: 148, dataOffset: 20, dataSize: 140 },
          { type: EMR_BITBLT, offset: 160, size: 100, dataOffset: 168, dataSize: 92 }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'drawImageRect',
        2,
        2,
        { x: 3, y: 4, width: 2, height: 2 },
        { x: 0, y: 0, width: 2, height: 2 },
        expect.objectContaining({
          rasterOp: 0x00cc0020,
          stretchMode: 4
        })
      ]
    ])
    expect(runtime.classicState.stretchBltMode).toBe(4)
    expect(runtime.unsupported).toEqual([])
  })

  test('replays added classic bitmap records and reports explicit unsupported blits', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              createImageData(w, h) {
                return {
                  width: w,
                  height: h,
                  data: new Uint8ClampedArray(w * h * 4)
                }
              },
              putImageData() {}
            }
          }
        }
      },
      drawImageRect(image, destinationRect, sourceRect, options) {
        calls.push(['drawImageRect', image.width, image.height, destinationRect, sourceRect, options])
      }
    }
    const view = new DataView(new ArrayBuffer(900))

    function writeDib(offset) {
      view.setUint32(offset, 40, true)
      view.setInt32(offset + 4, 2, true)
      view.setInt32(offset + 8, 2, true)
      view.setUint16(offset + 12, 1, true)
      view.setUint16(offset + 14, 1, true)
      view.setUint32(offset + 16, 0, true)
      view.setUint32(offset + 32, 0, true)
    }

    function writeBits(offset) {
      view.setUint8(offset, 0b10000000)
      view.setUint8(offset + 4, 0b01000000)
    }

    function writeStretchRecord(recordOffset, dataOffset, bmiOffset, bitsOffset, extra = {}) {
      view.setInt32(dataOffset + 16, extra.x ?? 1, true)
      view.setInt32(dataOffset + 20, extra.y ?? 2, true)
      view.setInt32(dataOffset + 24, 0, true)
      view.setInt32(dataOffset + 28, 0, true)
      view.setInt32(dataOffset + 32, 2, true)
      view.setInt32(dataOffset + 36, 2, true)
      view.setInt32(dataOffset + 44, extra.width ?? 2, true)
      view.setInt32(dataOffset + 48, extra.height ?? 2, true)

      if (extra.alpha || extra.transparent) {
        view.setUint32(dataOffset + 64, (200 << 16), true)
        view.setUint32(dataOffset + 80, 0x00030201, true)
        view.setUint32(dataOffset + 88, 0, true)
        view.setUint32(dataOffset + 92, bmiOffset, true)
        view.setUint32(dataOffset + 96, 40, true)
        view.setUint32(dataOffset + 100, bitsOffset, true)
        view.setUint32(dataOffset + 104, 8, true)
      } else {
        view.setUint32(dataOffset + 76, 0x00cc0020, true)
        view.setUint32(dataOffset + 80, 0, true)
        view.setUint32(dataOffset + 84, bmiOffset, true)
        view.setUint32(dataOffset + 88, 40, true)
        view.setUint32(dataOffset + 92, bitsOffset, true)
        view.setUint32(dataOffset + 96, 8, true)
      }
    }

    function writeSetDibitsRecord(recordOffset, dataOffset, bmiOffset, bitsOffset) {
      view.setInt32(dataOffset + 16, 5, true)
      view.setInt32(dataOffset + 20, 6, true)
      view.setInt32(dataOffset + 24, 0, true)
      view.setInt32(dataOffset + 28, 0, true)
      view.setInt32(dataOffset + 32, 2, true)
      view.setInt32(dataOffset + 36, 2, true)
      view.setUint32(dataOffset + 40, bmiOffset, true)
      view.setUint32(dataOffset + 44, 40, true)
      view.setUint32(dataOffset + 48, bitsOffset, true)
      view.setUint32(dataOffset + 52, 8, true)
      view.setUint32(dataOffset + 56, 0, true)
      view.setUint32(dataOffset + 60, 0, true)
      view.setUint32(dataOffset + 64, 2, true)
    }

    writeDib(0 + 120)
    writeBits(0 + 160)
    writeStretchRecord(0, 8, 120, 160, { x: 1, y: 2 })

    writeDib(200 + 112)
    writeBits(200 + 152)
    writeSetDibitsRecord(200, 208, 112, 152)

    writeDib(392 + 120)
    writeBits(392 + 160)
    writeStretchRecord(392, 400, 120, 160, { alpha: true, x: 9, y: 10 })

    writeDib(592 + 120)
    writeBits(592 + 160)
    writeStretchRecord(592, 600, 120, 160, { transparent: true, x: 13, y: 14 })

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 20, bottom: 20 },
          deviceWidth: 20,
          deviceHeight: 20
        },
        view,
        records: [
          { type: EMR_STRETCHBLT, offset: 0, size: 168, dataOffset: 8, dataSize: 160 },
          { type: EMR_SETDIBITSTODEVICE, offset: 200, size: 168, dataOffset: 208, dataSize: 160 },
          { type: EMR_ALPHABLEND, offset: 392, size: 176, dataOffset: 400, dataSize: 168 },
          { type: EMR_TRANSPARENTBLT, offset: 592, size: 176, dataOffset: 600, dataSize: 168 },
          { type: EMR_MASKBLT, offset: 800, dataOffset: 808, dataSize: 0 },
          { type: EMR_PLGBLT, offset: 808, dataOffset: 816, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(4)
    expect(calls[0][3]).toEqual({ x: 1, y: 2, width: 2, height: 2 })
    expect(calls[1][3]).toEqual({ x: 5, y: 6, width: 2, height: 2 })
    expect(calls[2][5]).toEqual(
      expect.objectContaining({
        sourceConstantAlpha: 200 / 255,
        blendFunction: expect.objectContaining({ sourceConstantAlpha: 200 })
      })
    )
    expect(calls[3][5]).toEqual(
      expect.objectContaining({
        transparentColor: { red: 1, green: 2, blue: 3 }
      })
    )
    expect(runtime.unsupported).toEqual(['emf:0x4e', 'emf:0x4f'])
    expect(runtime.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'classic-mask-blit' }),
        expect.objectContaining({ capability: 'classic-parallelogram-blit' })
      ])
    )
  })

  test('records warning and unsupported entry when classic raster payloads are invalid', () => {
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {}
    }
    const view = new DataView(new ArrayBuffer(96))
    view.setInt32(36, 3, true)
    view.setInt32(40, 4, true)
    view.setInt32(44, 0, true)
    view.setInt32(48, 0, true)
    view.setInt32(52, 2, true)
    view.setInt32(56, 2, true)
    view.setUint32(60, 512, true)
    view.setUint32(64, 48, true)
    view.setUint32(68, 520, true)
    view.setUint32(72, 8, true)
    view.setUint32(76, 0, true)
    view.setUint32(80, 0x00cc0020, true)
    view.setInt32(84, 2, true)
    view.setInt32(88, 2, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 20, bottom: 20 },
          deviceWidth: 20,
          deviceHeight: 20
        },
        view,
        records: [{ type: EMR_STRETCHDIBITS, offset: 12, size: 80, dataOffset: 20, dataSize: 72 }]
      },
      backend
    )

    expect(runtime.warnings).toContainEqual(expect.stringContaining('EMR_STRETCHDIBITS'))
    expect(runtime.unsupported).toEqual([])
  })

  test('absorbs classic text/state and font foundation records without marking unsupported', () => {
    const EMR_EXCLUDECLIPRECT = 0x0000001d
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      setClip() {}
    }

    const view = new DataView(new ArrayBuffer(256))
    // Basic state record payloads.
    view.setUint32(8, 7, true) // mapmode
    view.setUint32(12, 2, true) // bkmode
    view.setUint32(16, 13, true) // rop2
    view.setUint32(20, 6, true) // textalign (TA_CENTER)
    view.setUint32(24, 0x000000ff, true) // textcolor (red)
    view.setUint32(28, 0x0000ff00, true) // bkcolor (green)
    view.setInt32(32, 10, true) // moveto x
    view.setInt32(36, 20, true) // moveto y

    // EMR_EXTCREATEFONTINDIRECTW: handle + LOGFONTW
    const fontOffset = 40
    view.setUint32(fontOffset, 9, true)
    const logFontOffset = fontOffset + 4
    view.setInt32(logFontOffset + 0, -18, true) // height
    view.setInt32(logFontOffset + 16, 400, true) // weight
    view.setUint8(logFontOffset + 20, 0) // italic
    writeUtf16Le(view, logFontOffset + 28, 'Arial')

    const selectFontOffset = 140
    view.setUint32(selectFontOffset, 9, true)
    view.setInt32(144, 1, true)
    view.setInt32(148, 2, true)
    view.setInt32(152, 3, true)
    view.setInt32(156, 4, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_SETMAPMODE, dataOffset: 8, dataSize: 4 },
          { type: EMR_SETBKMODE, dataOffset: 12, dataSize: 4 },
          { type: EMR_SETROP2, dataOffset: 16, dataSize: 4 },
          { type: EMR_SETTEXTALIGN, dataOffset: 20, dataSize: 4 },
          { type: EMR_SETTEXTCOLOR, dataOffset: 24, dataSize: 4 },
          { type: EMR_SETBKCOLOR, dataOffset: 28, dataSize: 4 },
          { type: EMR_MOVETOEX, dataOffset: 32, dataSize: 8 },
          { type: EMR_SETMETARGN, dataOffset: 0, dataSize: 0 },
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: fontOffset, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: selectFontOffset, dataSize: 4 },
          { type: EMR_EXCLUDECLIPRECT, dataOffset: 144, dataSize: 16 }
        ]
      },
      backend
    )

    expect(runtime.unsupported).toEqual([])
    expect(runtime.classicState.mapMode).toBe(7)
    expect(runtime.classicState.bkMode).toBe(2)
    expect(runtime.classicState.rop2).toBe(13)
    expect(runtime.classicState.textAlign).toBe(6)
    expect(runtime.classicState.textColor).toBe('rgb(255, 0, 0)')
    expect(runtime.classicState.bkColor).toBe('rgb(0, 255, 0)')
    expect(runtime.classicState.currentPos).toEqual({ x: 10, y: 20 })
    expect(runtime.selectedFontHandle).toBe(9)
    expect(runtime.selectedFont?.css).toContain('Arial')
  })

  test('restores selected font on restore dc', () => {
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {}
    }

    const view = new DataView(new ArrayBuffer(320))

    const font1Offset = 8
    view.setUint32(font1Offset, 1, true)
    view.setInt32(font1Offset + 4 + 0, -12, true)
    view.setInt32(font1Offset + 4 + 16, 400, true)
    writeUtf16Le(view, font1Offset + 4 + 28, 'Arial')

    const font2Offset = 120
    view.setUint32(font2Offset, 2, true)
    view.setInt32(font2Offset + 4 + 0, -14, true)
    view.setInt32(font2Offset + 4 + 16, 700, true)
    writeUtf16Le(view, font2Offset + 4 + 28, 'Times')

    const select1Offset = 240
    view.setUint32(select1Offset, 1, true)
    const select2Offset = 244
    view.setUint32(select2Offset, 2, true)
    const restoreOffset = 248
    view.setInt32(restoreOffset, -1, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: font1Offset, dataSize: 96 },
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: font2Offset, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: select1Offset, dataSize: 4 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_SELECTOBJECT, dataOffset: select2Offset, dataSize: 4 },
          { type: EMR_RESTOREDC, dataOffset: restoreOffset, dataSize: 4 }
        ]
      },
      backend
    )

    expect(runtime.unsupported).toEqual([])
    expect(runtime.selectedFontHandle).toBe(1)
    expect(runtime.selectedFont?.css).toContain('Arial')
  })

  test('clears selected font when EMR_DELETEOBJECT deletes the active font handle', () => {
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {}
    }

    const view = new DataView(new ArrayBuffer(192))
    const fontOffset = 8
    view.setUint32(fontOffset, 7, true)
    view.setInt32(fontOffset + 4 + 0, -12, true)
    view.setInt32(fontOffset + 4 + 16, 400, true)
    writeUtf16Le(view, fontOffset + 4 + 28, 'Arial')

    const selectOffset = 120
    view.setUint32(selectOffset, 7, true)
    const deleteOffset = 124
    view.setUint32(deleteOffset, 7, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: fontOffset, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: selectOffset, dataSize: 4 },
          { type: EMR_DELETEOBJECT, dataOffset: deleteOffset, dataSize: 4 }
        ]
      },
      backend
    )

    expect(runtime.unsupported).toEqual([])
    expect(runtime.selectedFontHandle).toBeNull()
    expect(runtime.selectedFont).toBeNull()
  })

  test('restore dc drops saved font handle when the saved font object has been deleted', () => {
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {}
    }

    const view = new DataView(new ArrayBuffer(320))

    const font1Offset = 8
    view.setUint32(font1Offset, 1, true)
    view.setInt32(font1Offset + 4 + 0, -12, true)
    view.setInt32(font1Offset + 4 + 16, 400, true)
    writeUtf16Le(view, font1Offset + 4 + 28, 'Arial')

    const font2Offset = 120
    view.setUint32(font2Offset, 2, true)
    view.setInt32(font2Offset + 4 + 0, -14, true)
    view.setInt32(font2Offset + 4 + 16, 700, true)
    writeUtf16Le(view, font2Offset + 4 + 28, 'Times')

    const select1Offset = 240
    view.setUint32(select1Offset, 1, true)
    const delete1Offset = 244
    view.setUint32(delete1Offset, 1, true)
    const select2Offset = 248
    view.setUint32(select2Offset, 2, true)
    const restoreOffset = 252
    view.setInt32(restoreOffset, -1, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: font1Offset, dataSize: 96 },
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: font2Offset, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: select1Offset, dataSize: 4 },
          { type: EMR_SAVEDC, dataOffset: 0, dataSize: 0 },
          { type: EMR_DELETEOBJECT, dataOffset: delete1Offset, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: select2Offset, dataSize: 4 },
          { type: EMR_RESTOREDC, dataOffset: restoreOffset, dataSize: 4 }
        ]
      },
      backend
    )

    expect(runtime.unsupported).toEqual([])
    expect(runtime.selectedFontHandle).toBeNull()
    expect(runtime.selectedFont).toBeNull()
  })

  test('routes classic clip, transform, ellipse, line, and state records through shared runtime semantics', () => {
    const calls = []
    const transforms = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        transforms.push([...matrix])
      },
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      },
      fillEllipse(rect, fill) {
        calls.push(['fillEllipse', rect, fill])
      },
      strokeEllipse(rect, stroke) {
        calls.push(['strokeEllipse', rect, stroke])
      },
      drawLine(from, to, stroke) {
        calls.push(['drawLine', from, to, stroke])
      }
    }

    const view = new DataView(new ArrayBuffer(160))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(32, 3, true)
    view.setUint32(40, 0x000000ff, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 7, true)
    view.setUint32(56, 99, true)
    view.setInt32(60, 1, true)
    view.setInt32(64, 2, true)
    view.setInt32(68, 11, true)
    view.setInt32(72, 12, true)
    view.setFloat32(76, 2, true)
    view.setFloat32(80, 0, true)
    view.setFloat32(84, 0, true)
    view.setFloat32(88, 3, true)
    view.setFloat32(92, 10, true)
    view.setFloat32(96, 20, true)
    view.setUint32(100, 1, true)
    view.setInt32(104, 2, true)
    view.setInt32(108, 4, true)
    view.setInt32(112, 8, true)
    view.setInt32(116, 10, true)
    view.setInt32(120, 0, true)
    view.setInt32(124, 0, true)
    view.setInt32(128, 5, true)
    view.setInt32(132, 6, true)
    view.setUint32(136, 0, true)
    view.setUint32(140, 5, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 44, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETICMMODE, dataOffset: 52, dataSize: 4 },
          { type: EMR_SELECTPALETTE, dataOffset: 56, dataSize: 4 },
          { type: EMR_INTERSECTCLIPRECT, dataOffset: 60, dataSize: 16 },
          { type: EMR_SETWORLDTRANSFORM, dataOffset: 76, dataSize: 24 },
          { type: EMR_SETLAYOUT, dataOffset: 100, dataSize: 4 },
          { type: EMR_ELLIPSE, dataOffset: 104, dataSize: 16 },
          { type: EMR_MOVETOEX, dataOffset: 120, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 128, dataSize: 8 },
          { type: EMR_EXTSELECTCLIPRGN, dataOffset: 136, dataSize: 8 }
        ]
      },
      backend
    )

    expect(transforms.at(-1)).toEqual([2, 0, 0, 3, 10, 20])
    expect(calls).toEqual([
      ['clipRect', { x: 1, y: 2, width: 10, height: 10 }, 'intersect'],
      ['fillEllipse', { left: 2, top: 4, right: 8, bottom: 10 }, { kind: 'brush', color: 'rgb(0, 255, 0)' }],
      [
        'strokeEllipse',
        { left: 2, top: 4, right: 8, bottom: 10 },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 3, miterLimit: 10 }
      ],
      [
        'drawLine',
        { x: 0, y: 0 },
        { x: 5, y: 6 },
        { kind: 'pen', color: 'rgb(255, 0, 0)', width: 3, miterLimit: 10 }
      ]
    ])
    expect(runtime.classicState.currentPos).toEqual({ x: 5, y: 6 })
    expect(runtime.unsupported).toEqual([])
  })

  test('routes classic arc-family records through shared path geometry', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, stroke) {
        calls.push(['strokePath', path, stroke])
      }
    }

    const view = new DataView(new ArrayBuffer(220))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(32, 1, true)
    view.setUint32(36, 0, true)
    view.setUint32(40, 0x000000ff, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 1, true)

    for (const offset of [56, 88, 120]) {
      view.setInt32(offset, 0, true)
      view.setInt32(offset + 4, 0, true)
      view.setInt32(offset + 8, 20, true)
      view.setInt32(offset + 12, 20, true)
      view.setInt32(offset + 16, 20, true)
      view.setInt32(offset + 20, 10, true)
      view.setInt32(offset + 24, 10, true)
      view.setInt32(offset + 28, 0, true)
    }

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 44, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETARCDIRECTION, dataOffset: 52, dataSize: 4 },
          { type: EMR_PIE, dataOffset: 56, dataSize: 32 },
          { type: EMR_CHORD, dataOffset: 88, dataSize: 32 },
          { type: EMR_ARC, dataOffset: 120, dataSize: 32 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(5)
    expect(calls[0]).toEqual([
      'fillPath',
      {
        figures: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 10, y: 0 }
            ],
            segments: [
              {
                type: 'line',
                point: { x: 20, y: 10 }
              },
              {
                type: 'arc',
                center: { x: 10, y: 10 },
                radiusX: 10,
                radiusY: 10,
                rotation: 0,
                startAngle: 0,
                endAngle: -Math.PI / 2,
                counterclockwise: true,
                point: { x: 10, y: 0 }
              }
            ]
          }
        ]
      },
      { kind: 'brush', color: 'rgb(0, 255, 0)' },
      { fillMode: 'alternate' }
    ])
    expect(calls[1][0]).toBe('strokePath')
    expect(calls[2]).toEqual([
      'fillPath',
      {
        figures: [
          {
            closed: true,
            points: [
              { x: 20, y: 10 },
              { x: 10, y: 0 }
            ],
            segments: [
              {
                type: 'arc',
                center: { x: 10, y: 10 },
                radiusX: 10,
                radiusY: 10,
                rotation: 0,
                startAngle: 0,
                endAngle: -Math.PI / 2,
                counterclockwise: true,
                point: { x: 10, y: 0 }
              }
            ]
          }
        ]
      },
      { kind: 'brush', color: 'rgb(0, 255, 0)' },
      { fillMode: 'alternate' }
    ])
    expect(calls[3][0]).toBe('strokePath')
    expect(calls[4]).toEqual([
      'strokePath',
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 20, y: 10 },
              { x: 10, y: 0 }
            ],
            segments: [
              {
                type: 'arc',
                center: { x: 10, y: 10 },
                radiusX: 10,
                radiusY: 10,
                rotation: 0,
                startAngle: 0,
                endAngle: -Math.PI / 2,
                counterclockwise: true,
                point: { x: 10, y: 0 }
              }
            ]
          }
        ]
      },
      { kind: 'pen', color: 'rgb(255, 0, 0)', width: 1, miterLimit: 10 }
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('replays classic path lifecycle and 16-bit bezier/polyline geometry without leaving unsupported records', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }

    const view = new DataView(new ArrayBuffer(360))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x0000ff00, true)
    view.setUint32(24, 2, true)
    view.setUint32(32, 3, true)
    view.setUint32(40, 0x000000ff, true)
    view.setUint32(44, 1, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 2, true)
    view.setInt32(64, 0, true)
    view.setInt32(68, 0, true)
    view.setUint32(88, 2, true)
    view.setInt16(92, 4, true)
    view.setInt16(94, 0, true)
    view.setInt16(96, 4, true)
    view.setInt16(98, 4, true)
    view.setInt32(108, 6, true)
    view.setInt32(112, 6, true)
    view.setUint32(132, 3, true)
    view.setInt16(136, 8, true)
    view.setInt16(138, 6, true)
    view.setInt16(140, 8, true)
    view.setInt16(142, 8, true)
    view.setInt16(144, 10, true)
    view.setInt16(146, 8, true)
    view.setInt32(156, 11, true)
    view.setInt32(160, 9, true)
    view.setInt32(168, 0, true)
    view.setInt32(172, 0, true)
    view.setInt32(176, 12, true)
    view.setInt32(180, 12, true)
    view.setUint32(200, 4, true)
    view.setInt16(204, 12, true)
    view.setInt16(206, 12, true)
    view.setInt16(208, 14, true)
    view.setInt16(210, 12, true)
    view.setInt16(212, 14, true)
    view.setInt16(214, 14, true)
    view.setInt16(216, 16, true)
    view.setInt16(218, 14, true)
    view.setInt32(228, 18, true)
    view.setInt32(232, 18, true)
    view.setUint32(252, 2, true)
    view.setUint32(256, 5, true)
    view.setUint32(260, 2, true)
    view.setUint32(264, 3, true)
    view.setInt16(268, 20, true)
    view.setInt16(270, 20, true)
    view.setInt16(272, 22, true)
    view.setInt16(274, 20, true)
    view.setInt16(276, 24, true)
    view.setInt16(278, 20, true)
    view.setInt16(280, 24, true)
    view.setInt16(282, 22, true)
    view.setInt16(284, 26, true)
    view.setInt16(286, 22, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 8, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 24, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 44, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETPOLYFILLMODE, dataOffset: 52, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 64, dataSize: 8 },
          { type: EMR_POLYLINETO16, dataOffset: 72, dataSize: 28 },
          { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 108, dataSize: 8 },
          { type: EMR_POLYBEZIERTO16, dataOffset: 116, dataSize: 32 },
          { type: EMR_LINETO, dataOffset: 156, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 168, dataSize: 16 },
          { type: EMR_POLYBEZIER16, dataOffset: 184, dataSize: 36 },
          { type: EMR_POLYPOLYLINE16, dataOffset: 236, dataSize: 52 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(3)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][1]).toMatchObject({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 }
          ]
        },
        {
          closed: false,
          points: [
            { x: 6, y: 6 },
            { x: 10, y: 8 },
            { x: 11, y: 9 }
          ]
        }
      ]
    })
    expect(calls[0][1].figures[1].segments).toEqual([
      {
        type: 'bezier',
        control1: { x: 8, y: 6 },
        control2: { x: 8, y: 8 },
        point: { x: 10, y: 8 }
      },
      {
        type: 'line',
        point: { x: 11, y: 9 }
      }
    ])
    expect(calls[0][2]).toEqual({ kind: 'brush', color: 'rgb(0, 255, 0)' })
    expect(calls[0][3]).toEqual({ fillMode: 'winding' })

    expect(calls[1][0]).toBe('strokePath')
    expect(calls[1][1].figures[0].segments).toEqual([
      {
        type: 'bezier',
        control1: { x: 14, y: 12 },
        control2: { x: 14, y: 14 },
        point: { x: 16, y: 14 }
      }
    ])

    expect(calls[2]).toEqual([
      'strokePath',
      {
        figures: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 22, y: 20 }
            ]
          },
          {
            closed: false,
            points: [
              { x: 24, y: 20 },
              { x: 24, y: 22 },
              { x: 26, y: 22 }
            ]
          }
        ]
      },
      { kind: 'pen', color: 'rgb(255, 0, 0)', width: 3, miterLimit: 10 }
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('flattens a ready classic bezier path before filling it', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(72))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)
    view.setUint32(16, 1, true)
    view.setInt32(20, 0, true)
    view.setInt32(24, 0, true)
    view.setUint32(44, 3, true)
    view.setInt16(48, 10, true)
    view.setInt16(50, 20, true)
    view.setInt16(52, 20, true)
    view.setInt16(54, 20, true)
    view.setInt16(56, 30, true)
    view.setInt16(58, 0, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 40, bottom: 30 },
          deviceWidth: 40,
          deviceHeight: 30
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_SELECTOBJECT, dataOffset: 16, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 20, dataSize: 8 },
          { type: EMR_POLYBEZIERTO16, dataOffset: 28, dataSize: 32 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FLATTENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1].figures[0].segments).toBeUndefined()
    expect(calls[0][1].figures[0].points[0]).toEqual({ x: 0, y: 0 })
    expect(calls[0][1].figures[0].points.at(-1)).toEqual({ x: 30, y: 0 })
    expect(calls[0][1].figures[0].points.length).toBeGreaterThan(4)
    expect(runtime.unsupported).toEqual([])
  })

  test('widens a ready classic line path using the selected pen width and default round caps', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(48))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 4, true)
    view.setUint32(16, 0x000000ff, true)
    view.setUint32(20, 2, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 10 },
          deviceWidth: 24,
          deviceHeight: 14
        },
        view,
        records: [
          { type: EMR_CREATEPEN, dataOffset: 0, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1].figures[0]).toMatchObject({ closed: true })
    expect(calls[0][1].figures[0].points).toHaveLength(19)
    expect(calls[0][1].figures[0].points[0]).toEqual({ x: 0, y: -2 })
    expect(calls[0][1].figures[0].points[5]).toEqual({ x: 12, y: expect.closeTo(0, 12) })
    expect(calls[0][1].figures[0].points[14]).toEqual({ x: -2, y: expect.closeTo(0, 12) })
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('widens a ready classic line path using square pen caps', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(48))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0x00000100, true)
    view.setUint32(8, 4, true)
    view.setUint32(16, 0x000000ff, true)
    view.setUint32(20, 2, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 10 },
          deviceWidth: 24,
          deviceHeight: 14
        },
        view,
        records: [
          { type: EMR_CREATEPEN, dataOffset: 0, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: -2, y: -2 },
            { x: 12, y: -2 },
            { x: 12, y: 2 },
            { x: -2, y: 2 }
          ]
        }
      ]
    })
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('widens ready classic polyline paths using join-only bevel pens', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(56))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0x00001000, true)
    view.setUint32(8, 4, true)
    view.setUint32(16, 0x000000ff, true)
    view.setUint32(20, 2, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)
    view.setInt32(40, 10, true)
    view.setInt32(44, 10, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 20 },
          deviceWidth: 24,
          deviceHeight: 24
        },
        view,
        records: [
          { type: EMR_CREATEPEN, dataOffset: 0, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 40, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1].figures[0].points).toEqual([
      { x: 0, y: -2 },
      { x: 10, y: -2 },
      { x: 12, y: 0 },
      { x: 12, y: 10 },
      { x: 11.847759065022574, y: 10.76536686473018 },
      { x: 11.414213562373096, y: 11.414213562373096 },
      { x: 10.76536686473018, y: 11.847759065022574 },
      { x: 10, y: 12 },
      { x: 9.23463313526982, y: 11.847759065022574 },
      { x: 8.585786437626904, y: 11.414213562373096 },
      { x: 8.152240934977426, y: 10.76536686473018 },
      { x: 8, y: 10 },
      { x: 8, y: 2 },
      { x: 0, y: 2 },
      { x: -0.7653668647301796, y: 1.8477590650225735 },
      { x: -1.414213562373095, y: 1.4142135623730951 },
      { x: -1.8477590650225735, y: 0.7653668647301797 },
      { x: -2, y: expect.closeTo(0, 12) },
      { x: -1.8477590650225735, y: -0.7653668647301795 },
      { x: -1.4142135623730951, y: -1.414213562373095 },
      { x: -0.7653668647301798, y: -1.8477590650225735 },
      { x: 0, y: -2 }
    ])
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('widens obtuse classic polyline paths without approximation diagnostics', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(56))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0x00002200, true)
    view.setUint32(8, 4, true)
    view.setUint32(16, 0x000000ff, true)
    view.setUint32(20, 2, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)
    view.setInt32(40, 5, true)
    view.setInt32(44, 5, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 20 },
          deviceWidth: 24,
          deviceHeight: 24
        },
        view,
        records: [
          { type: EMR_CREATEPEN, dataOffset: 0, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 40, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1].figures[0].points).toEqual([
      { x: 0, y: -2 },
      { x: expect.closeTo(14.828427124746192, 12), y: -2 },
      { x: expect.closeTo(6.414213562373095, 12), y: expect.closeTo(6.414213562373095, 12) },
      { x: expect.closeTo(3.585786437626905, 12), y: expect.closeTo(3.585786437626905, 12) },
      { x: expect.closeTo(5.171572875253809, 12), y: 2 },
      { x: 0, y: 2 }
    ])
    expect(runtime.warnings).toEqual([])
    expect(runtime.diagnostics.some((diagnostic) => diagnostic.code === 'classic-widenpath-approximation')).toBe(false)
    expect(runtime.unsupported).toEqual([])
  })

  test('records structured diagnostics when WIDENPATH falls back to bounds', () => {
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {}
    }

    const view = new DataView(new ArrayBuffer(64))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 4, true)
    view.setUint32(16, 0x000000ff, true)
    view.setUint32(20, 2, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)
    view.setInt32(40, 10, true)
    view.setInt32(44, 10, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 20 },
          deviceWidth: 24,
          deviceHeight: 24
        },
        view,
        records: [
          { type: EMR_CREATEPEN, dataOffset: 0, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 40, dataSize: 8 },
          { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 48, dataSize: 0 }
        ]
      },
      backend
    )

    expect(runtime.warnings).toEqual([
      'EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths'
    ])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'classic-widenpath-approximation',
        capability: 'classic-path-widening',
        reason: 'closed-path',
        recordType: EMR_WIDENPATH
      })
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('widens a ready classic path to an empty path when the current pen is null', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }

    const view = new DataView(new ArrayBuffer(44))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x000000ff, true)
    view.setUint32(16, 1, true)
    view.setUint32(20, STOCK_NULL_PEN, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 10, true)
    view.setInt32(36, 0, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: -4, top: -4, right: 20, bottom: 10 },
          deviceWidth: 24,
          deviceHeight: 14
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_SELECTOBJECT, dataOffset: 16, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 20, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 24, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_WIDENPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ figures: [] })
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('replays 32-bit classic poly records through the shared geometry runtime', () => {
    const EMR_POLYBEZIER = 0x00000002
    const EMR_POLYGON = 0x00000003
    const EMR_POLYLINE = 0x00000004
    const EMR_POLYBEZIERTO = 0x00000005
    const EMR_POLYLINETO = 0x00000006
    const EMR_POLYPOLYLINE = 0x00000007
    const EMR_POLYPOLYGON = 0x00000008

    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }

    const view = new DataView(new ArrayBuffer(448))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)
    view.setUint32(16, 2, true)
    view.setUint32(20, 0, true)
    view.setUint32(24, 3, true)
    view.setUint32(32, 0x000000ff, true)
    view.setUint32(36, 1, true)
    view.setUint32(40, 2, true)

    view.setUint32(60, 4, true)
    view.setInt32(64, 0, true)
    view.setInt32(68, 0, true)
    view.setInt32(72, 4, true)
    view.setInt32(76, 0, true)
    view.setInt32(80, 4, true)
    view.setInt32(84, 4, true)
    view.setInt32(88, 0, true)
    view.setInt32(92, 4, true)

    view.setUint32(112, 3, true)
    view.setInt32(116, 1, true)
    view.setInt32(120, 1, true)
    view.setInt32(124, 3, true)
    view.setInt32(128, 2, true)
    view.setInt32(132, 6, true)
    view.setInt32(136, 3, true)

    view.setUint32(156, 4, true)
    view.setInt32(160, 10, true)
    view.setInt32(164, 10, true)
    view.setInt32(168, 12, true)
    view.setInt32(172, 10, true)
    view.setInt32(176, 12, true)
    view.setInt32(180, 12, true)
    view.setInt32(184, 14, true)
    view.setInt32(188, 12, true)

    view.setInt32(192, 20, true)
    view.setInt32(196, 20, true)

    view.setUint32(216, 3, true)
    view.setInt32(220, 22, true)
    view.setInt32(224, 20, true)
    view.setInt32(228, 22, true)
    view.setInt32(232, 22, true)
    view.setInt32(236, 24, true)
    view.setInt32(240, 22, true)

    view.setInt32(244, 30, true)
    view.setInt32(248, 30, true)

    view.setUint32(268, 2, true)
    view.setInt32(272, 31, true)
    view.setInt32(276, 31, true)
    view.setInt32(280, 33, true)
    view.setInt32(284, 32, true)

    view.setUint32(304, 2, true)
    view.setUint32(308, 4, true)
    view.setUint32(312, 2, true)
    view.setUint32(316, 2, true)
    view.setInt32(320, 40, true)
    view.setInt32(324, 40, true)
    view.setInt32(328, 42, true)
    view.setInt32(332, 40, true)
    view.setInt32(336, 44, true)
    view.setInt32(340, 40, true)
    view.setInt32(344, 44, true)
    view.setInt32(348, 42, true)

    view.setUint32(368, 2, true)
    view.setUint32(372, 7, true)
    view.setUint32(376, 3, true)
    view.setUint32(380, 4, true)
    view.setInt32(384, 50, true)
    view.setInt32(388, 50, true)
    view.setInt32(392, 54, true)
    view.setInt32(396, 50, true)
    view.setInt32(400, 54, true)
    view.setInt32(404, 54, true)
    view.setInt32(408, 60, true)
    view.setInt32(412, 60, true)
    view.setInt32(416, 64, true)
    view.setInt32(420, 60, true)
    view.setInt32(424, 64, true)
    view.setInt32(428, 64, true)
    view.setInt32(432, 60, true)
    view.setInt32(436, 64, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 120, bottom: 120 },
          deviceWidth: 120,
          deviceHeight: 120
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 16, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 36, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 40, dataSize: 4 },
          { type: EMR_POLYGON, dataOffset: 44, dataSize: 52 },
          { type: EMR_POLYLINE, dataOffset: 96, dataSize: 44 },
          { type: EMR_POLYBEZIER, dataOffset: 140, dataSize: 52 },
          { type: EMR_MOVETOEX, dataOffset: 192, dataSize: 8 },
          { type: EMR_POLYBEZIERTO, dataOffset: 200, dataSize: 44 },
          { type: EMR_MOVETOEX, dataOffset: 244, dataSize: 8 },
          { type: EMR_POLYLINETO, dataOffset: 252, dataSize: 36 },
          { type: EMR_POLYPOLYLINE, dataOffset: 288, dataSize: 64 },
          { type: EMR_POLYPOLYGON, dataOffset: 352, dataSize: 88 }
        ]
      },
      backend
    )

    expect(calls.map((entry) => entry[0])).toEqual([
      'fillPath',
      'strokePath',
      'strokePath',
      'strokePath',
      'strokePath',
      'strokePath',
      'strokePath',
      'fillPath',
      'strokePath'
    ])
    expect(calls[0][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
          ]
        }
      ]
    })
    expect(calls[2][1]).toEqual({
      figures: [
        {
          closed: false,
          points: [
            { x: 1, y: 1 },
            { x: 3, y: 2 },
            { x: 6, y: 3 }
          ]
        }
      ]
    })
    expect(calls[3][1].figures[0].segments).toEqual([
      {
        type: 'bezier',
        control1: { x: 12, y: 10 },
        control2: { x: 12, y: 12 },
        point: { x: 14, y: 12 }
      }
    ])
    expect(calls[4][1].figures[0]).toMatchObject({
      points: [
        { x: 20, y: 20 },
        { x: 24, y: 22 }
      ]
    })
    expect(calls[6][1]).toEqual({
      figures: [
        {
          closed: false,
          points: [
            { x: 40, y: 40 },
            { x: 42, y: 40 }
          ]
        },
        {
          closed: false,
          points: [
            { x: 44, y: 40 },
            { x: 44, y: 42 }
          ]
        }
      ]
    })
    expect(calls[7][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 50, y: 50 },
            { x: 54, y: 50 },
            { x: 54, y: 54 }
          ]
        },
        {
          closed: true,
          points: [
            { x: 60, y: 60 },
            { x: 64, y: 60 },
            { x: 64, y: 64 },
            { x: 60, y: 64 }
          ]
        }
      ]
    })
    expect(runtime.classicState.currentPos).toEqual({ x: 60, y: 64 })
    expect(runtime.unsupported).toEqual([])
  })

  test('replays classic roundrect, arcto, path stroking/filling, clip-path selection, and abortpath semantics', () => {
    const EMR_ROUNDRECT = 0x0000002c
    const EMR_ARCTO = 0x00000037
    const EMR_STROKEANDFILLPATH = 0x0000003f
    const EMR_STROKEPATH = 0x00000040
    const EMR_SELECTCLIPPATH = 0x00000043
    const EMR_ABORTPATH = 0x00000044

    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      },
      setClip(clip) {
        calls.push(['setClip', clip])
      }
    }

    const view = new DataView(new ArrayBuffer(208))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)
    view.setUint32(16, 2, true)
    view.setUint32(20, 0, true)
    view.setUint32(24, 2, true)
    view.setUint32(32, 0x000000ff, true)
    view.setUint32(36, 1, true)
    view.setUint32(40, 2, true)

    view.setInt32(44, 0, true)
    view.setInt32(48, 0, true)
    view.setInt32(52, 20, true)
    view.setInt32(56, 10, true)
    view.setInt32(60, 8, true)
    view.setInt32(64, 4, true)

    view.setInt32(68, 25, true)
    view.setInt32(72, 40, true)

    view.setInt32(76, 30, true)
    view.setInt32(80, 30, true)
    view.setInt32(84, 50, true)
    view.setInt32(88, 50, true)
    view.setInt32(92, 50, true)
    view.setInt32(96, 40, true)
    view.setInt32(100, 40, true)
    view.setInt32(104, 50, true)

    view.setInt32(108, 60, true)
    view.setInt32(112, 60, true)
    view.setInt32(116, 70, true)
    view.setInt32(120, 60, true)
    view.setInt32(124, 70, true)
    view.setInt32(128, 70, true)

    view.setInt32(132, 80, true)
    view.setInt32(136, 80, true)
    view.setInt32(140, 90, true)
    view.setInt32(144, 80, true)
    view.setInt32(148, 90, true)
    view.setInt32(152, 90, true)

    view.setInt32(156, 100, true)
    view.setInt32(160, 100, true)
    view.setInt32(164, 110, true)
    view.setInt32(168, 100, true)
    view.setInt32(172, 110, true)
    view.setInt32(176, 110, true)

    view.setUint32(180, 5, true)

    view.setInt32(184, 120, true)
    view.setInt32(188, 120, true)
    view.setInt32(192, 130, true)
    view.setInt32(196, 120, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 160, bottom: 160 },
          deviceWidth: 160,
          deviceHeight: 160
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 16, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 36, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 40, dataSize: 4 },
          { type: EMR_ROUNDRECT, dataOffset: 44, dataSize: 24 },
          { type: EMR_MOVETOEX, dataOffset: 68, dataSize: 8 },
          { type: EMR_ARCTO, dataOffset: 76, dataSize: 32 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 108, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 116, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 124, dataSize: 8 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_STROKEPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 132, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 140, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 148, dataSize: 8 },
          { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_STROKEANDFILLPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 156, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 164, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 172, dataSize: 8 },
          { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_SELECTCLIPPATH, dataOffset: 180, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_MOVETOEX, dataOffset: 184, dataSize: 8 },
          { type: EMR_LINETO, dataOffset: 192, dataSize: 8 },
          { type: EMR_ABORTPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_FILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(7)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[1][0]).toBe('strokePath')
    expect(calls[2][0]).toBe('strokePath')
    expect(calls[3][0]).toBe('strokePath')
    expect(calls[4][0]).toBe('fillPath')
    expect(calls[5][0]).toBe('strokePath')
    expect(calls[6][0]).toBe('setClip')
    expect(calls[0][1].figures[0].closed).toBe(true)
    expect(calls[1][1].figures[0].closed).toBe(true)
    expect(calls[2][1].figures[0].points[0]).toEqual({ x: 25, y: 40 })
    expect(calls[3][1]).toEqual({
      figures: [
        {
          closed: false,
          points: [
            { x: 60, y: 60 },
            { x: 70, y: 60 },
            { x: 70, y: 70 }
          ]
        }
      ]
    })
    expect(calls[4][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 80, y: 80 },
            { x: 90, y: 80 },
            { x: 90, y: 90 }
          ]
        }
      ]
    })
    expect(calls[6][1]).toMatchObject({
      geometry: expect.any(Array)
    })
    expect(runtime.classicState.currentPos).toEqual({ x: 130, y: 120 })
    expect(runtime.unsupported).toEqual([])
  })

  test('applies classic fill mode when selecting path clips with nested figures', () => {
    function replayClipWithFillMode(polyFillMode, innerDirection = 'same') {
      const clips = []
      const backend = {
        resize() {},
        clear() {},
        save() {},
        restore() {},
        setTransform() {},
        setClip(clip) {
          clips.push(clip)
        }
      }

      const view = new DataView(new ArrayBuffer(84))
      view.setUint32(0, polyFillMode, true)
      view.setUint32(4, 5, true)
      view.setInt32(8, 0, true)
      view.setInt32(12, 0, true)
      view.setInt32(16, 10, true)
      view.setInt32(20, 0, true)
      view.setInt32(24, 10, true)
      view.setInt32(28, 10, true)
      view.setInt32(32, 0, true)
      view.setInt32(36, 10, true)
      view.setInt32(40, 2, true)
      view.setInt32(44, 2, true)

      if (innerDirection === 'reversed') {
        view.setInt32(48, 2, true)
        view.setInt32(52, 8, true)
        view.setInt32(56, 8, true)
        view.setInt32(60, 8, true)
        view.setInt32(64, 8, true)
        view.setInt32(68, 2, true)
      } else {
        view.setInt32(48, 8, true)
        view.setInt32(52, 2, true)
        view.setInt32(56, 8, true)
        view.setInt32(60, 8, true)
        view.setInt32(64, 2, true)
        view.setInt32(68, 8, true)
      }

      playParsedMetafile(
        {
          header: {
            bounds: { left: 0, top: 0, right: 20, bottom: 20 },
            deviceWidth: 20,
            deviceHeight: 20
          },
          view,
          records: [
            { type: EMR_SETPOLYFILLMODE, dataOffset: 0, dataSize: 4 },
            { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
            { type: EMR_MOVETOEX, dataOffset: 8, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 16, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 24, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 32, dataSize: 8 },
            { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
            { type: EMR_MOVETOEX, dataOffset: 40, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 48, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 56, dataSize: 8 },
            { type: EMR_LINETO, dataOffset: 64, dataSize: 8 },
            { type: EMR_CLOSEFIGURE, dataOffset: 0, dataSize: 0 },
            { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
            { type: EMR_SELECTCLIPPATH, dataOffset: 4, dataSize: 4 }
          ]
        },
        backend
      )

      return clips[0]
    }

    expect(replayClipWithFillMode(1)).toMatchObject({
      source: { kind: 'path', fillMode: 'alternate' },
      geometry: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ],
          [
            [2, 2],
            [2, 8],
            [8, 8],
            [8, 2],
            [2, 2]
          ]
        ]
      ]
    })
    expect(replayClipWithFillMode(2)).toMatchObject({
      source: { kind: 'path', fillMode: 'winding' },
      geometry: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ]
        ]
      ]
    })
    expect(replayClipWithFillMode(2, 'reversed')).toMatchObject({
      source: { kind: 'path', fillMode: 'winding' },
      geometry: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ],
          [
            [2, 2],
            [2, 8],
            [8, 8],
            [8, 2],
            [2, 2]
          ]
        ]
      ]
    })
  })

  test('replays classic text output, mapping scale records, and setpixelv without falling back to unsupported', () => {
    const EMR_SCALEVIEWPORTEXTEX = 0x0000001f
    const EMR_SCALEWINDOWEXTEX = 0x00000020
    const EMR_SETPIXELV = 0x0000000f
    const EMR_EXTTEXTOUTW = 0x00000054

    const transforms = []
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform(matrix) {
        transforms.push([...matrix])
      },
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(272))
    view.setUint32(256, 8, true) // MM_ANISOTROPIC so the scale records drive the mapping
    view.setInt32(260, 15, true) // MoveToEx X (TA_UPDATECP reference for the run below)
    view.setInt32(264, 25, true) // MoveToEx Y
    view.setInt32(0, 10, true)
    view.setInt32(4, 10, true)
    view.setInt32(8, 100, true)
    view.setInt32(12, 50, true)
    view.setInt32(16, 2, true)
    view.setInt32(20, 1, true)
    view.setInt32(24, 2, true)
    view.setInt32(28, 1, true)
    view.setInt32(32, 1, true)
    view.setInt32(36, 2, true)
    view.setInt32(40, 1, true)
    view.setInt32(44, 2, true)
    view.setUint32(48, 2, true)
    view.setUint32(52, 0x0000ff00, true)
    view.setUint32(56, 0x000000ff, true)

    view.setUint32(60, 1, true)
    view.setInt32(64, -18, true)
    view.setInt32(80, 400, true)
    writeUtf16Le(view, 92, 'Arial')

    view.setUint32(156, 1, true)
    view.setUint32(160, 0x00000019, true)

    view.setUint32(180, 1, true)
    view.setFloat32(184, 1, true)
    view.setFloat32(188, 1, true)
    view.setInt32(192, 15, true)
    view.setInt32(196, 25, true)
    view.setUint32(200, 2, true)
    view.setUint32(204, 76, true)
    view.setUint32(208, 0x00000002, true)
    view.setInt32(212, 14, true)
    view.setInt32(216, 20, true)
    view.setInt32(220, 30, true)
    view.setInt32(224, 28, true)
    view.setUint32(228, 80, true)
    writeUtf16Le(view, 232, 'Hi')
    view.setInt32(236, 6, true)
    view.setInt32(240, 7, true)

    view.setInt32(244, 3, true)
    view.setInt32(248, 4, true)
    view.setUint32(252, 0x00ff0000, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_SETMAPMODE, dataOffset: 256, dataSize: 4 },
          { type: EMR_SETWINDOWEXTEX, dataOffset: 0, dataSize: 8 },
          { type: EMR_SETVIEWPORTEXTEX, dataOffset: 8, dataSize: 8 },
          { type: EMR_SCALEVIEWPORTEXTEX, dataOffset: 16, dataSize: 16 },
          { type: EMR_SCALEWINDOWEXTEX, dataOffset: 32, dataSize: 16 },
          { type: EMR_SETBKMODE, dataOffset: 48, dataSize: 4 },
          { type: EMR_SETBKCOLOR, dataOffset: 52, dataSize: 4 },
          { type: EMR_SETTEXTCOLOR, dataOffset: 56, dataSize: 4 },
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 60, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 156, dataSize: 4 },
          { type: EMR_SETTEXTALIGN, dataOffset: 160, dataSize: 4 },
          { type: EMR_MOVETOEX, dataOffset: 260, dataSize: 8 },
          { type: EMR_EXTTEXTOUTW, dataOffset: 164, dataSize: 80 },
          { type: EMR_SETPIXELV, dataOffset: 244, dataSize: 12 }
        ]
      },
      backend
    )

    expect(transforms.at(-1)).toEqual([40, 0, 0, 20, 0, 0])
    expect(calls[0]).toEqual([
      'fillRect',
      { left: 14, top: 20, right: 30, bottom: 28 },
      expect.objectContaining({ color: 'rgb(0, 255, 0)' })
    ])
    expect(calls[1][0]).toBe('drawText')
    expect(calls[1][1]).toBe('Hi')
    expect(calls[1][3].css).toContain('Arial')
    expect(calls[1][4]).toEqual(expect.objectContaining({ color: 'rgb(255, 0, 0)' }))
    expect(calls[1][5]).toEqual(
      expect.objectContaining({
        textAlign: 'left',
        textBaseline: 'alphabetic',
        referencePoint: { x: 15, y: 25 }
      })
    )
    expect(calls[2]).toEqual([
      'fillRect',
      { left: 3, top: 4, right: 4, bottom: 5 },
      expect.objectContaining({ color: 'rgb(0, 0, 255)' })
    ])
    expect(runtime.classicState.currentPos).toEqual({ x: 28, y: 25 })
    expect(runtime.unsupported).toEqual([])
  })

  test('passes ETO_PDY advances and text justification into classic drawText format', () => {
    const EMR_EXTTEXTOUTW = 0x00000054
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(320))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(20, 400, true)
    writeUtf16Le(view, 32, 'Arial')
    view.setUint32(100, 1, true)
    view.setInt32(108, 6, true)
    view.setInt32(112, 2, true)
    view.setInt32(148, 20, true)
    view.setInt32(152, 30, true)
    view.setUint32(156, 3, true)
    view.setUint32(160, 88, true)
    view.setUint32(164, 0x2000, true)
    view.setInt32(168, 0, true)
    view.setInt32(172, 0, true)
    view.setInt32(176, 0, true)
    view.setInt32(180, 0, true)
    view.setUint32(184, 96, true)
    writeUtf16Le(view, 200, 'A B')
    view.setInt32(208, 7, true)
    view.setInt32(212, 1, true)
    view.setInt32(216, 8, true)
    view.setInt32(220, 2, true)
    view.setInt32(224, 9, true)
    view.setInt32(228, 3, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_SETTEXTJUSTIFICATION, dataOffset: 108, dataSize: 8 },
          { type: EMR_EXTTEXTOUTW, dataOffset: 120, dataSize: 120 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('A B')
    expect(calls[0][5]).toMatchObject({
      advanceDx: [
        { x: 7, y: 1 },
        { x: 8, y: 2 },
        { x: 9, y: 3 }
      ],
      textJustificationExtra: 6,
      textJustificationCount: 2
    })
    expect(runtime.unsupported).toEqual([])
  })

  test('maps classic SETLAYOUT RTL mode into text draw format', () => {
    const EMR_EXTTEXTOUTW = 0x00000054
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(260))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(20, 400, true)
    writeUtf16Le(view, 32, 'Arial')
    view.setUint32(100, 1, true)
    view.setUint32(104, 1, true)
    view.setUint32(108, 0, true)
    view.setInt32(152, 20, true)
    view.setInt32(156, 30, true)
    view.setUint32(160, 1, true)
    view.setUint32(164, 84, true)
    view.setUint32(168, 0, true)
    view.setUint32(188, 0, true)
    writeUtf16Le(view, 200, 'A')

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_SETLAYOUT, dataOffset: 104, dataSize: 4 },
          { type: EMR_SETTEXTALIGN, dataOffset: 108, dataSize: 4 },
          { type: EMR_EXTTEXTOUTW, dataOffset: 124, dataSize: 100 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][5]).toMatchObject({
      directionRightToLeft: true,
      layoutMode: 1,
      textAlign: 'right'
    })
    expect(runtime.unsupported).toEqual([])
  })

  test('mirrors classic RTL text advances and TA_UPDATECP current position', () => {
    const EMR_EXTTEXTOUTW = 0x00000054
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(260))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(20, 400, true)
    writeUtf16Le(view, 32, 'Arial')
    view.setUint32(100, 1, true)
    view.setUint32(104, 1, true)
    view.setUint32(108, 1, true)
    view.setInt32(148, 50, true)
    view.setInt32(152, 30, true)
    view.setUint32(156, 2, true)
    view.setUint32(160, 88, true)
    view.setUint32(164, 0, true)
    view.setInt32(168, 0, true)
    view.setInt32(172, 0, true)
    view.setInt32(176, 0, true)
    view.setInt32(180, 0, true)
    view.setUint32(184, 92, true)
    writeUtf16Le(view, 200, 'AB')
    view.setInt32(204, 7, true)
    view.setInt32(208, 8, true)
    view.setInt32(220, 50, true) // MoveToEx X — TA_UPDATECP uses the current position as the reference
    view.setInt32(224, 30, true) // MoveToEx Y

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_SETLAYOUT, dataOffset: 104, dataSize: 4 },
          { type: EMR_SETTEXTALIGN, dataOffset: 108, dataSize: 4 },
          { type: EMR_MOVETOEX, dataOffset: 220, dataSize: 8 },
          { type: EMR_EXTTEXTOUTW, dataOffset: 120, dataSize: 100 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][5]).toMatchObject({
      directionRightToLeft: true,
      referencePoint: { x: 50, y: 30 },
      referencePointMode: 'rtl',
      advanceDx: [
        { x: -7, y: 0 },
        { x: -8, y: 0 }
      ]
    })
    expect(runtime.classicState.currentPos).toEqual({ x: 35, y: 30 })
    expect(runtime.unsupported).toEqual([])
  })

  test('maps classic LOGFONTW escapement into drawText transforms for EXTTEXTOUTW', () => {
    const EMR_EXTTEXTOUTW = 0x00000054

    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(220))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(12, 900, true)
    view.setInt32(20, 400, true)
    writeUtf16Le(view, 32, 'Arial')
    view.setUint32(100, 1, true)
    view.setUint32(104, 0, true)
    view.setUint32(108, 0x00000018, true)
    view.setUint32(128, 1, true)
    view.setFloat32(132, 1, true)
    view.setFloat32(136, 1, true)
    view.setInt32(152, 20, true)
    view.setInt32(156, 30, true)
    view.setUint32(160, 1, true)
    view.setUint32(164, 72, true)
    view.setUint32(168, 0, true)
    view.setInt32(172, 0, true)
    view.setInt32(176, 0, true)
    view.setInt32(180, 0, true)
    view.setInt32(184, 0, true)
    writeUtf16Le(view, 188, 'A')

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_SETTEXTALIGN, dataOffset: 104, dataSize: 4 },
          { type: EMR_EXTTEXTOUTW, dataOffset: 124, dataSize: 76 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('drawText')
    expect(calls[0][1]).toBe('A')
    expect(calls[0][2]).toEqual({ x: 20, y: 30, width: 0, height: 0 })
    expect(calls[0][3]).toEqual(expect.objectContaining({ escapement: 900, css: expect.stringContaining('Arial') }))
    expect(calls[0][4]).toEqual(expect.objectContaining({ color: 'rgb(0, 0, 0)' }))
    expect(calls[0][5]).toEqual(
      expect.objectContaining({
        referencePoint: { x: 20, y: 30 },
        textAlign: 'left',
        textBaseline: 'top'
      })
    )
    expect(calls[0][5].transform[0]).toBeCloseTo(0)
    expect(calls[0][5].transform[1]).toBeCloseTo(-1)
    expect(calls[0][5].transform[2]).toBeCloseTo(1)
    expect(calls[0][5].transform[3]).toBeCloseTo(0)
    expect(calls[0][5].transform[4]).toBeCloseTo(-10)
    expect(calls[0][5].transform[5]).toBeCloseTo(50)
    expect(runtime.unsupported).toEqual([])
  })

  test('decodes EXTTEXTOUTA bytes with the selected LOGFONTW charset policy', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(260))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(20, 400, true)
    view.setUint8(27, 0)
    writeUtf16Le(view, 32, 'Arial')
    view.setUint32(100, 1, true)
    view.setInt32(152, 20, true)
    view.setInt32(156, 30, true)
    view.setUint32(160, 5, true)
    view.setUint32(164, 76, true)
    view.setUint32(168, 0, true)
    view.setUint32(188, 0, true)
    view.setUint8(192, 0x48)
    view.setUint8(193, 0x80)
    view.setUint8(194, 0x93)
    view.setUint8(195, 0x51)
    view.setUint8(196, 0x94)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_EXTTEXTOUTA, dataOffset: 124, dataSize: 76 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('H\u20ac\u201cQ\u201d')
    expect(calls[0][3]).toMatchObject({ charSet: 0, css: expect.stringContaining('Arial') })
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('records diagnostics for unsupported EXTTEXTOUTA charsets', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }

    const view = new DataView(new ArrayBuffer(220))
    view.setUint32(0, 1, true)
    view.setInt32(4, -18, true)
    view.setInt32(20, 400, true)
    view.setUint8(27, 0xba)
    writeUtf16Le(view, 32, 'Wingdings')
    view.setUint32(100, 1, true)
    view.setInt32(152, 20, true)
    view.setInt32(156, 30, true)
    view.setUint32(160, 1, true)
    view.setUint32(164, 76, true)
    view.setUint32(168, 0, true)
    view.setUint32(188, 0, true)
    view.setUint8(192, 0x80)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 200, bottom: 100 },
          deviceWidth: 200,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_EXTCREATEFONTINDIRECTW, dataOffset: 0, dataSize: 96 },
          { type: EMR_SELECTOBJECT, dataOffset: 100, dataSize: 4 },
          { type: EMR_EXTTEXTOUTA, dataOffset: 124, dataSize: 76 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('\u20ac')
    expect(runtime.warnings).toEqual(['Unsupported EXTTEXTOUTA charset 186; decoding bytes as Windows-1252'])
    expect(runtime.diagnostics).toEqual([
      {
        level: 'warning',
        code: 'classic-text-charset-unsupported',
        message: 'Unsupported EXTTEXTOUTA charset 186; decoding bytes as Windows-1252',
        source: 'emf',
        recordType: EMR_EXTTEXTOUTA,
        recordOffset: 116,
        capability: 'classic-text-encoding'
      }
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('appends classic polygon-family geometry to the active path bracket instead of drawing eagerly', () => {
    const EMR_POLYGON = 0x00000003
    const EMR_ROUNDRECT = 0x0000002c
    const EMR_STROKEANDFILLPATH = 0x0000003f
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }

    const view = new DataView(new ArrayBuffer(192))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)
    view.setUint32(16, 2, true)
    view.setUint32(20, 0, true)
    view.setUint32(24, 2, true)
    view.setUint32(32, 0x000000ff, true)
    view.setUint32(36, 1, true)
    view.setUint32(40, 2, true)

    view.setUint32(60, 4, true)
    view.setInt32(64, 0, true)
    view.setInt32(68, 0, true)
    view.setInt32(72, 4, true)
    view.setInt32(76, 0, true)
    view.setInt32(80, 4, true)
    view.setInt32(84, 4, true)
    view.setInt32(88, 0, true)
    view.setInt32(92, 4, true)

    view.setUint32(112, 3, true)
    view.setInt16(116, 10, true)
    view.setInt16(118, 10, true)
    view.setInt16(120, 14, true)
    view.setInt16(122, 10, true)
    view.setInt16(124, 14, true)
    view.setInt16(126, 14, true)

    view.setInt32(128, 20, true)
    view.setInt32(132, 0, true)
    view.setInt32(136, 40, true)
    view.setInt32(140, 10, true)
    view.setInt32(144, 8, true)
    view.setInt32(148, 4, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 160, bottom: 80 },
          deviceWidth: 160,
          deviceHeight: 80
        },
        view,
        records: [
          { type: EMR_CREATEBRUSHINDIRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_CREATEPEN, dataOffset: 16, dataSize: 20 },
          { type: EMR_SELECTOBJECT, dataOffset: 36, dataSize: 4 },
          { type: EMR_SELECTOBJECT, dataOffset: 40, dataSize: 4 },
          { type: EMR_BEGINPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_POLYGON, dataOffset: 44, dataSize: 52 },
          { type: EMR_POLYGON16, dataOffset: 96, dataSize: 32 },
          { type: EMR_ROUNDRECT, dataOffset: 128, dataSize: 24 },
          { type: EMR_ENDPATH, dataOffset: 0, dataSize: 0 },
          { type: EMR_STROKEANDFILLPATH, dataOffset: 0, dataSize: 0 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[1][0]).toBe('strokePath')
    expect(calls[0][1].figures).toHaveLength(3)
    expect(calls[0][1].figures.map((figure) => figure.closed)).toEqual([true, true, true])
    expect(calls[0][1].figures[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 }
    ])
    expect(calls[0][1].figures[1].points).toEqual([
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 14 }
    ])
    expect(calls[0][1].figures[2].segments).toEqual(expect.any(Array))
    expect(runtime.unsupported).toEqual([])
  })

  test('realizes classic DIB pattern brushes as texture fills during playback', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              createImageData(w, h) {
                return {
                  width: w,
                  height: h,
                  data: new Uint8ClampedArray(w * h * 4)
                }
              },
              putImageData() {}
            }
          }
        }
      },
      fillRect(rect, brush) {
        calls.push(['fillRect', rect, brush])
      }
    }

    const view = new DataView(new ArrayBuffer(112))
    view.setUint32(8, 1, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 32, true)
    view.setUint32(20, 48, true)
    view.setUint32(24, 80, true)
    view.setUint32(28, 8, true)

    view.setUint32(32, 40, true)
    view.setInt32(36, 2, true)
    view.setInt32(40, 2, true)
    view.setUint16(44, 1, true)
    view.setUint16(46, 1, true)
    view.setUint32(48, 0, true)
    view.setUint32(64, 0, true)
    view.setUint32(68, 0, true)
    view.setUint8(72, 0)
    view.setUint8(73, 0)
    view.setUint8(74, 0)
    view.setUint8(75, 0)
    view.setUint8(76, 255)
    view.setUint8(77, 255)
    view.setUint8(78, 255)
    view.setUint8(79, 0)
    view.setUint8(80, 0b10000000)
    view.setUint8(84, 0b01000000)

    view.setUint32(88, 1, true)
    view.setInt32(92, 5, true)
    view.setInt32(96, 6, true)
    view.setInt32(100, 25, true)
    view.setInt32(104, 16, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 40, bottom: 30 },
          deviceWidth: 40,
          deviceHeight: 30
        },
        view,
        records: [
          { type: 0x5e, dataOffset: 8, dataSize: 80 },
          { type: EMR_SELECTOBJECT, dataOffset: 88, dataSize: 4 },
          { type: EMR_RECTANGLE, dataOffset: 92, dataSize: 16 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('fillRect')
    expect(calls[0][1]).toEqual({ left: 5, top: 6, right: 25, bottom: 16 })
    expect(calls[0][2]).toEqual(
      expect.objectContaining({
        kind: 'brush',
        type: 'texture',
        image: expect.objectContaining({
          format: 'dib',
          width: 2,
          height: 2,
          canvas: expect.objectContaining({ width: 2, height: 2 })
        })
      })
    )
    expect(runtime.unsupported).toEqual([])
  })

  test('parses RegionData payloads in EMR_EXTSELECTCLIPRGN and replaces clip geometry', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      setClip(clip) {
        calls.push(['setClip', clip])
      }
    }

    const view = new DataView(new ArrayBuffer(80))
    view.setUint32(0, 64, true)
    view.setUint32(4, 5, true)
    view.setUint32(8, 32, true)
    view.setUint32(12, 1, true)
    view.setUint32(16, 2, true)
    view.setUint32(20, 32, true)
    view.setInt32(24, 0, true)
    view.setInt32(28, 0, true)
    view.setInt32(32, 30, true)
    view.setInt32(36, 20, true)
    view.setInt32(40, 0, true)
    view.setInt32(44, 0, true)
    view.setInt32(48, 10, true)
    view.setInt32(52, 10, true)
    view.setInt32(56, 20, true)
    view.setInt32(60, 0, true)
    view.setInt32(64, 30, true)
    view.setInt32(68, 20, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [{ type: EMR_EXTSELECTCLIPRGN, dataOffset: 0, dataSize: 72 }]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'setClip',
        {
          kind: 'geometry',
          mode: 'replace',
          source: {
            kind: 'region',
            region: {
              kind: 'region',
              type: 'rects',
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
                    [30, 20],
                    [20, 20],
                    [20, 0]
                  ]
                ]
              ]
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
                [30, 20],
                [20, 20],
                [20, 0]
              ]
            ]
          ]
        }
      ]
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('applies SETMETARGN by promoting the classic clip into the meta region', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      setClip(clip) {
        calls.push(['setClip', clip])
      }
    }

    const view = new DataView(new ArrayBuffer(24))
    view.setInt32(0, 0, true)
    view.setInt32(4, 0, true)
    view.setInt32(8, 20, true)
    view.setInt32(12, 20, true)
    view.setUint32(16, 0, true)
    view.setUint32(20, 5, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_INTERSECTCLIPRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_SETMETARGN, dataOffset: 0, dataSize: 0 },
          { type: EMR_EXTSELECTCLIPRGN, dataOffset: 16, dataSize: 8 }
        ]
      },
      backend
    )

    expect(calls).toHaveLength(3)
    expect(calls[0][1].source).toEqual({ kind: 'rect', rect: { x: 0, y: 0, width: 20, height: 20 } })
    expect(calls[1][1].source).toEqual({ kind: 'metargn' })
    expect(calls[2][1].source).toEqual({ kind: 'classic-clip' })
    expect(calls[2][1].geometry).toEqual(calls[0][1].geometry)
    expect(runtime.classicState.classicClipRegionGeometry).toBeNull()
    expect(runtime.classicState.classicMetaRegionGeometry).toEqual(calls[0][1].geometry)
    expect(runtime.state.current.clip.geometry).toEqual(calls[0][1].geometry)
    expect(runtime.unsupported).toEqual([])
  })

  test('does not mark SETMETARGN unsupported when a rect-only backend clip is unchanged', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      },
      resetClip() {
        calls.push(['resetClip'])
      }
    }

    const view = new DataView(new ArrayBuffer(24))
    view.setInt32(0, 0, true)
    view.setInt32(4, 0, true)
    view.setInt32(8, 20, true)
    view.setInt32(12, 20, true)
    view.setUint32(16, 0, true)
    view.setUint32(20, 5, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_INTERSECTCLIPRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_SETMETARGN, dataOffset: 0, dataSize: 0 },
          { type: EMR_EXTSELECTCLIPRGN, dataOffset: 16, dataSize: 8 }
        ]
      },
      backend
    )

    expect(calls).toEqual([['clipRect', { x: 0, y: 0, width: 20, height: 20 }, 'intersect']])
    expect(runtime.classicState.classicClipRegionGeometry).toBeNull()
    expect(runtime.classicState.classicMetaRegionGeometry).toEqual(runtime.state.current.clip.geometry)
    expect(runtime.unsupported).toEqual([])
  })

  test('combines RegionData payloads with the current clip using the requested region mode', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      setClip(clip) {
        calls.push(['setClip', clip])
      }
    }

    const view = new DataView(new ArrayBuffer(96))
    view.setInt32(0, 0, true)
    view.setInt32(4, 0, true)
    view.setInt32(8, 20, true)
    view.setInt32(12, 20, true)

    view.setUint32(16, 48, true)
    view.setUint32(20, 1, true)
    view.setUint32(24, 32, true)
    view.setUint32(28, 1, true)
    view.setUint32(32, 1, true)
    view.setUint32(36, 16, true)
    view.setInt32(40, 10, true)
    view.setInt32(44, 10, true)
    view.setInt32(48, 30, true)
    view.setInt32(52, 30, true)
    view.setInt32(56, 10, true)
    view.setInt32(60, 10, true)
    view.setInt32(64, 30, true)
    view.setInt32(68, 30, true)

    const runtime = playParsedMetafile(
      {
        header: {
          bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          deviceWidth: 100,
          deviceHeight: 100
        },
        view,
        records: [
          { type: EMR_INTERSECTCLIPRECT, dataOffset: 0, dataSize: 16 },
          { type: EMR_EXTSELECTCLIPRGN, dataOffset: 16, dataSize: 56 }
        ]
      },
      backend
    )

    expect(calls).toEqual([
      [
        'setClip',
        {
          kind: 'geometry',
          mode: 'intersect',
          source: { kind: 'rect', rect: { x: 0, y: 0, width: 20, height: 20 } },
          geometry: [
            [
              [
                [0, 0],
                [20, 0],
                [20, 20],
                [0, 20],
                [0, 0]
              ]
            ]
          ]
        }
      ],
      [
        'setClip',
        {
          kind: 'geometry',
          mode: 'intersect',
          source: {
            kind: 'region',
            region: {
              kind: 'region',
              type: 'rects',
              geometry: [
                [
                  [
                    [10, 10],
                    [30, 10],
                    [30, 30],
                    [10, 30],
                    [10, 10]
                  ]
                ]
              ]
            }
          },
          geometry: [
            [
              [
                [10, 10],
                [20, 10],
                [20, 20],
                [10, 20],
                [10, 10]
              ]
            ]
          ]
        }
      ]
    ])
    expect(runtime.unsupported).toEqual([])
  })
})
