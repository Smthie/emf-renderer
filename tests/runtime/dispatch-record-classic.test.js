import { describe, expect, test } from 'vitest'
import { createPlaybackRuntime } from '../../src/runtime/playback.js'
import { dispatchRecord } from '../../src/runtime/dispatch-record.js'
import {
  EMR_ANGLEARC,
  EMR_BITBLT,
  EMR_CREATEBRUSHINDIRECT,
  EMR_CREATEPALETTE,
  EMR_CREATEDIBPATTERNBRUSHPT,
  EMR_CREATEPEN,
  EMR_EXCLUDECLIPRECT,
  EMR_EXTCREATEPEN,
  EMR_FILLRGN,
  EMR_GRADIENTFILL,
  EMR_POLYDRAW,
  EMR_FLATTENPATH,
  EMR_REALIZEPALETTE,
  EMR_RECTANGLE,
  EMR_SETCOLORADJUSTMENT,
  EMR_SETLAYOUT,
  EMR_SETLINKEDUFIS,
  EMR_SELECTOBJECT,
  EMR_SELECTPALETTE,
  EMR_SETSTRETCHBLTMODE,
  EMR_SETTEXTJUSTIFICATION,
  EMR_WIDENPATH,
  EMR_SETWINDOWORGEX
} from '../../src/emf/constants.js'

function createBackend() {
  return {
    resize() {},
    clear() {},
    setTransform() {},
    save() {},
    restore() {}
  }
}

describe('dispatchRecord classic EMF', () => {
  test('creates and selects brush and pen through the shared dispatcher', () => {
    const view = new DataView(new ArrayBuffer(44))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)
    view.setUint32(16, 2, true)
    view.setUint32(20, 0, true)
    view.setUint32(24, 1, true)
    view.setUint32(32, 0x000000ff, true)
    view.setUint32(36, 1, true)
    view.setUint32(40, 2, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEBRUSHINDIRECT,
      dataOffset: 0,
      dataSize: 16
    })
    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEPEN,
      dataOffset: 16,
      dataSize: 20
    })
    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_SELECTOBJECT,
      dataOffset: 36,
      dataSize: 4
    })
    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_SELECTOBJECT,
      dataOffset: 40,
      dataSize: 4
    })

    expect(runtime.objects.get(1)).toEqual({ kind: 'brush', color: 'rgb(0, 255, 0)' })
    expect(runtime.objects.get(2)).toEqual({ kind: 'pen', color: 'rgb(255, 0, 0)', width: 1 })
    expect(runtime.selectedBrushHandle).toBe(1)
    expect(runtime.selectedPenHandle).toBe(2)
    expect(runtime.selectedBrush).toEqual(runtime.objects.get(1))
    expect(runtime.selectedPen).toEqual(runtime.objects.get(2))
    expect(runtime.unsupported).toEqual([])
  })

  test('leaves rectangle playback to legacy bridge logic', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillRect(rect, fill) {
        calls.push(['fillRect', rect, fill])
      },
      strokeRect(rect, stroke) {
        calls.push(['strokeRect', rect, stroke])
      }
    }
    const view = new DataView(new ArrayBuffer(16))
    view.setInt32(0, 1, true)
    view.setInt32(4, 2, true)
    view.setInt32(8, 3, true)
    view.setInt32(12, 4, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }

    const handled = dispatchRecord(parsed, createPlaybackRuntime(parsed, backend), backend, {
      source: 'emf',
      type: EMR_RECTANGLE,
      dataOffset: 0,
      dataSize: 16
    })

    expect(handled).toBe(false)
    expect(calls).toEqual([])
  })

  test('requires explicit source metadata instead of inferring classic format from type range', () => {
    const view = new DataView(new ArrayBuffer(16))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x0000ff00, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    const handled = dispatchRecord(parsed, runtime, createBackend(), {
      type: EMR_CREATEBRUSHINDIRECT,
      dataOffset: 0,
      dataSize: 16
    })

    expect(handled).toBe(false)
    expect(runtime.objects.get(1)).toBeUndefined()
  })

  test('dispatches classic records by numeric type instead of parser typeName metadata', () => {
    const view = new DataView(new ArrayBuffer(8))
    view.setInt32(0, 10, true)
    view.setInt32(4, 20, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    const handled = dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: 0x7fffffff,
      typeName: 'EMR_SETWINDOWORGEX',
      dataOffset: 0,
      dataSize: 8
    })

    expect(handled).toBe(false)
    expect(runtime.classicState.windowOrg).toEqual({ x: 0, y: 0 })

    const numericHandled = dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_SETWINDOWORGEX,
      typeName: 'EMR_CREATEPEN',
      dataOffset: 0,
      dataSize: 8
    })

    expect(numericHandled).toBe(true)
    expect(runtime.classicState.windowOrg).toEqual({ x: 10, y: 20 })
  })

  test('tracks stretch blt mode and treats no-op bitblt records as handled', () => {
    const view = new DataView(new ArrayBuffer(108))
    view.setUint32(0, 4, true)
    view.setInt32(32, 5, true)
    view.setInt32(36, 6, true)
    view.setInt32(40, 7, true)
    view.setInt32(44, 8, true)
    view.setUint32(48, 0x00aa0029, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    const stretchHandled = dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_SETSTRETCHBLTMODE,
      dataOffset: 0,
      dataSize: 4
    })

    const bitbltHandled = dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_BITBLT,
      offset: 8,
      dataOffset: 16,
      dataSize: 92
    })

    expect(stretchHandled).toBe(true)
    expect(bitbltHandled).toBe(true)
    expect(runtime.classicState.stretchBltMode).toBe(4)
  })

  test('degrades solid raster operations to a capability diagnostic when fillRect is unavailable', () => {
    // A recognized raster record whose backend lacks fillRect is a capability
    // gap, not an unsupported record: it must be handled (not counted
    // unsupported) and emit a capability-unavailable diagnostic. (Previously it
    // returned false, double-counting the record as warning + unsupported.)
    const view = new DataView(new ArrayBuffer(108))
    view.setInt32(32, 5, true)
    view.setInt32(36, 6, true)
    view.setInt32(40, 7, true)
    view.setInt32(44, 8, true)
    view.setUint32(48, 0x00000042, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    const handled = dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_BITBLT,
      offset: 8,
      dataOffset: 16,
      dataSize: 92
    })

    expect(handled).toBe(true)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.warnings).toEqual([expect.stringContaining('fillRect')])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        code: 'capability-unavailable',
        capability: 'fillRect'
      })
    )
  })

  test('preserves classic pen caps, joins, dash styles, and hatch brushes when creating objects', () => {
    const view = new DataView(new ArrayBuffer(96))
    view.setUint32(0, 1, true)
    view.setUint32(4, 0x00000002, true)
    view.setUint32(8, 0x00030201, true)
    view.setUint32(12, 5, true)

    view.setUint32(16, 2, true)
    view.setUint32(20, 0x00001103, true)
    view.setUint32(24, 5, true)
    view.setUint32(32, 0x000c0b0a, true)

    view.setUint32(36, 3, true)
    view.setUint32(56, 0x00002207, true)
    view.setUint32(60, 7, true)
    view.setUint32(68, 0x001d1c1b, true)
    view.setUint32(76, 3, true)
    view.setUint32(80, 2, true)
    view.setUint32(84, 4, true)
    view.setUint32(88, 1, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEBRUSHINDIRECT,
      dataOffset: 0,
      dataSize: 16
    })
    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEPEN,
      dataOffset: 16,
      dataSize: 20
    })
    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_EXTCREATEPEN,
      dataOffset: 36,
      dataSize: 56
    })

    expect(runtime.objects.get(1)).toMatchObject({
      kind: 'brush',
      type: 'hatch',
      style: 0x00000002,
      color: 'rgb(1, 2, 3)',
      hatch: 5
    })
    expect(runtime.objects.get(2)).toMatchObject({
      kind: 'pen',
      width: 5,
      color: 'rgb(10, 11, 12)',
      dashStyle: 'dashDot',
      lineCap: 'square',
      lineJoin: 'bevel'
    })
    expect(runtime.objects.get(3)).toMatchObject({
      kind: 'pen',
      width: 7,
      color: 'rgb(27, 28, 29)',
      dashStyle: 'custom',
      dashPattern: [2, 4, 1],
      lineCap: 'butt',
      lineJoin: 'miter'
    })
  })

  test('preserves join-only classic pen state without adding dash metadata', () => {
    const view = new DataView(new ArrayBuffer(36))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0x00001000, true)
    view.setUint32(8, 5, true)
    view.setUint32(16, 0x000c0b0a, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEPEN,
      dataOffset: 0,
      dataSize: 20
    })

    expect(runtime.objects.get(2)).toEqual({
      kind: 'pen',
      width: 5,
      color: 'rgb(10, 11, 12)',
      lineJoin: 'bevel'
    })
  })

  test('captures DIB pattern brush payload offsets for classic pattern-brush playback', () => {
    const view = new DataView(new ArrayBuffer(64))
    view.setUint32(8, 9, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 32, true)
    view.setUint32(20, 12, true)
    view.setUint32(24, 44, true)
    view.setUint32(28, 8, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    dispatchRecord(parsed, runtime, createBackend(), {
      source: 'emf',
      type: EMR_CREATEDIBPATTERNBRUSHPT,
      dataOffset: 8,
      dataSize: 24
    })

    expect(runtime.objects.get(9)).toMatchObject({
      kind: 'brush',
      type: 'texture',
      dib: {
        bmiOffset: 32,
        bmiSize: 12,
        bitsOffset: 44,
        bitsSize: 8
      },
      image: {
        format: 'dib'
      }
    })
  })

  test('initializes classic runtime with legacy stock defaults', () => {
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view: new DataView(new ArrayBuffer(0)),
      records: []
    }

    const runtime = createPlaybackRuntime(parsed, createBackend())

    expect(runtime.classicState.mapMode).toBe(1)
    expect(runtime.classicState.bkMode).toBe(2)
    expect(runtime.classicState.rop2).toBe(13)
    expect(runtime.classicState.stretchBltMode).toBe(3)
    expect(runtime.selectedBrushHandle).toBe(0x80000000)
    expect(runtime.selectedBrush).toEqual({ kind: 'brush', color: 'rgb(255, 255, 255)' })
    expect(runtime.selectedPenHandle).toBe(0x80000007)
    expect(runtime.selectedPen).toEqual({ kind: 'pen', color: 'rgb(0, 0, 0)', width: 1 })
    expect(runtime.selectedFontHandle).toBe(0x8000000d)
    expect(runtime.selectedFont).toMatchObject({
      kind: 'font',
      faceName: 'System',
      weight: 700,
      css: '700 16px System'
    })
    expect(runtime.resolveClassicObject(0x8000000f)).toEqual({ kind: 'palette' })
  })

  test('absorbs legacy palette and no-op classic records while preserving layout state', () => {
    const view = new DataView(new ArrayBuffer(48))
    view.setUint32(8, 12, true)
    view.setUint16(12, 0x0300, true)
    view.setUint16(14, 2, true)
    view.setUint8(16, 1)
    view.setUint8(17, 2)
    view.setUint8(18, 3)
    view.setUint8(20, 4)
    view.setUint8(21, 5)
    view.setUint8(22, 6)
    view.setUint32(24, 12, true)
    view.setUint32(28, 2, true)
    view.setInt32(32, 5, true)
    view.setInt32(36, 7, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, createBackend())

    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_SETCOLORADJUSTMENT,
        dataOffset: 0,
        dataSize: 4
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_CREATEPALETTE,
        dataOffset: 8,
        dataSize: 16
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_SELECTPALETTE,
        dataOffset: 24,
        dataSize: 4
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_SETLAYOUT,
        dataOffset: 28,
        dataSize: 4
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_SETTEXTJUSTIFICATION,
        dataOffset: 32,
        dataSize: 8
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_SETLINKEDUFIS,
        dataOffset: 0,
        dataSize: 0
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_REALIZEPALETTE,
        dataOffset: 0,
        dataSize: 0
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_FLATTENPATH,
        dataOffset: 0,
        dataSize: 0
      })
    ).toBe(true)
    expect(
      dispatchRecord(parsed, runtime, createBackend(), {
        source: 'emf',
        type: EMR_WIDENPATH,
        dataOffset: 0,
        dataSize: 0
      })
    ).toBe(true)

    expect(runtime.objects.get(12)).toEqual({
      kind: 'palette',
      entries: [
        { r: 1, g: 2, b: 3 },
        { r: 4, g: 5, b: 6 }
      ]
    })
    expect(runtime.selectedPaletteHandle).toBe(12)
    expect(runtime.selectedPalette).toEqual({
      kind: 'palette',
      entries: [
        { r: 1, g: 2, b: 3 },
        { r: 4, g: 5, b: 6 }
      ]
    })
    expect(runtime.classicState.layoutMode).toBe(2)
    expect(runtime.classicState.textJustificationExtra).toBe(5)
    expect(runtime.classicState.textJustificationCount).toBe(7)
    expect(runtime.unsupported).toEqual([])
  })

  test('dispatches EMR_ANGLEARC through shared arc path geometry', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokePath(path, stroke) {
        calls.push(['strokePath', path, stroke])
      }
    }
    const view = new DataView(new ArrayBuffer(20))
    view.setInt32(0, 20, true)
    view.setInt32(4, 30, true)
    view.setUint32(8, 10, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 90, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 80, bottom: 80 },
        deviceWidth: 80,
        deviceHeight: 80
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.classicState.currentPos = { x: 0, y: 0 }
    runtime.classicState.arcDirection = 2

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emf',
      type: EMR_ANGLEARC,
      dataOffset: 0,
      dataSize: 20
    })

    expect(handled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('strokePath')
    expect(calls[0][1].figures[0].segments[0]).toEqual({
      type: 'line',
      point: { x: 30, y: 30 }
    })
    expect(calls[0][1].figures[0].segments[1]).toMatchObject({
      type: 'arc',
      center: { x: 20, y: 30 },
      radiusX: 10,
      radiusY: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
      counterclockwise: false
    })
    expect(runtime.classicState.currentPos.x).toBeCloseTo(20)
    expect(runtime.classicState.currentPos.y).toBeCloseTo(40)
    expect(runtime.unsupported).toEqual([])
  })

  test('applies EMR_EXCLUDECLIPRECT as a clip region difference', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      setClip(clip) {
        calls.push(['setClip', clip])
      }
    }
    const view = new DataView(new ArrayBuffer(16))
    view.setInt32(0, 10, true)
    view.setInt32(4, 10, true)
    view.setInt32(8, 30, true)
    view.setInt32(12, 30, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 100, bottom: 80 },
        deviceWidth: 100,
        deviceHeight: 80
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emf',
      type: EMR_EXCLUDECLIPRECT,
      dataOffset: 0,
      dataSize: 16
    })

    const expectedClip = {
      kind: 'geometry',
      mode: 'exclude',
      source: { kind: 'rect', rect: { x: 10, y: 10, width: 20, height: 20 } },
      geometry: [
        [
          [
            [0, 0],
            [100, 0],
            [100, 80],
            [0, 80],
            [0, 0]
          ],
          [
            [10, 10],
            [10, 30],
            [30, 30],
            [30, 10],
            [10, 10]
          ]
        ]
      ]
    }

    expect(handled).toBe(true)
    expect(calls).toEqual([['setClip', expectedClip]])
    expect(runtime.state.current.clip).toEqual(expectedClip)
    expect(runtime.unsupported).toEqual([])
  })

  test('EMR_FILLRGN fills the region geometry with the referenced brush', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillGeometry(geometry, brush, options) {
        calls.push(['fillGeometry', geometry, brush, options])
      }
    }
    // rclBounds(16) cbRgnData(4) ihBrush(4) RgnData(RGNDATAHEADER 32 + one RECTL).
    const view = new DataView(new ArrayBuffer(72))
    view.setUint32(16, 48, true) // cbRgnData = 32 header + 16 rect
    view.setUint32(20, 1, true) // ihBrush
    view.setUint32(24, 32, true) // RGNDATAHEADER.dwSize
    view.setUint32(32, 1, true) // RGNDATAHEADER.nCount
    view.setInt32(56, 10, true)
    view.setInt32(60, 20, true)
    view.setInt32(64, 40, true)
    view.setInt32(68, 60, true)

    const parsed = {
      header: { bounds: { left: 0, top: 0, right: 100, bottom: 100 }, deviceWidth: 100, deviceHeight: 100 },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    const brush = { kind: 'brush', color: 'rgb(1, 2, 3)' }
    runtime.objects.set(1, brush)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emf',
      type: EMR_FILLRGN,
      dataOffset: 0,
      dataSize: 72
    })

    expect(handled).toBe(true)
    expect(calls[0][0]).toBe('fillGeometry')
    expect(calls[0][1].length).toBeGreaterThan(0)
    expect(calls[0][2]).toBe(brush)
    expect(runtime.unsupported).toEqual([])
  })

  test('EMR_POLYDRAW builds a path from per-point move/line/close types', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillPath(path, brush) {
        calls.push(['fillPath', path, brush])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    // rclBounds(16) cptl(4) aptl[4] (POINTL) abTypes[4].
    const view = new DataView(new ArrayBuffer(56))
    view.setUint32(16, 4, true) // cptl
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ]
    points.forEach(([x, y], index) => {
      view.setInt32(20 + index * 8, x, true)
      view.setInt32(24 + index * 8, y, true)
    })
    // PT_MOVETO(6), PT_LINETO(2), PT_LINETO(2), PT_LINETO|PT_CLOSEFIGURE(3)
    new Uint8Array(view.buffer).set([6, 2, 2, 3], 52)

    const parsed = {
      header: { bounds: { left: 0, top: 0, right: 100, bottom: 100 }, deviceWidth: 100, deviceHeight: 100 },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.selectedBrush = { kind: 'brush', color: 'rgb(4, 5, 6)' }
    runtime.selectedPen = { kind: 'pen', color: 'rgb(7, 8, 9)', width: 1 }

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emf',
      type: EMR_POLYDRAW,
      dataOffset: 0,
      dataSize: 56
    })

    expect(handled).toBe(true)
    const stroke = calls.find((call) => call[0] === 'strokePath')
    expect(stroke).toBeDefined()
    const figure = stroke[1].figures[0]
    expect(figure.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ])
    expect(figure.closed).toBe(true)
    expect(runtime.unsupported).toEqual([])
  })

  test('EMR_GRADIENTFILL fills a horizontal rect gradient between two TRIVERTEX colors', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillRect(rect, brush) {
        calls.push(['fillRect', rect, brush])
      }
    }
    // rclBounds(16) nVer(4) nTri(4) ulMode(4) TRIVERTEX[2] GRADIENT_RECT[1].
    const view = new DataView(new ArrayBuffer(68))
    view.setUint32(16, 2, true) // nVer
    view.setUint32(20, 1, true) // nTri
    view.setUint32(24, 0, true) // ulMode = GRADIENT_FILL_RECT_H
    view.setInt32(28, 10, true) // v0.x
    view.setInt32(32, 20, true) // v0.y
    view.setUint16(36, 0xffff, true) // v0 Red16
    view.setInt32(44, 50, true) // v1.x
    view.setInt32(48, 60, true) // v1.y
    view.setUint16(56, 0xffff, true) // v1 Blue16
    view.setUint32(60, 0, true) // UpperLeft index
    view.setUint32(64, 1, true) // LowerRight index

    const parsed = {
      header: { bounds: { left: 0, top: 0, right: 100, bottom: 100 }, deviceWidth: 100, deviceHeight: 100 },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emf',
      type: EMR_GRADIENTFILL,
      dataOffset: 0,
      dataSize: 68
    })

    expect(handled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ left: 10, top: 20, right: 50, bottom: 60 })
    expect(calls[0][2]).toEqual({
      type: 'linearGradient',
      rect: { x: 10, y: 20, width: 40, height: 40 },
      startColor: 'rgb(255, 0, 0)',
      endColor: 'rgb(0, 0, 255)',
      startPoint: { x: 10, y: 20 },
      endPoint: { x: 50, y: 20 }
    })
    expect(runtime.unsupported).toEqual([])
  })
})
