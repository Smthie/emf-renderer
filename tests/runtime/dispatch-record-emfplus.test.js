import { describe, expect, test } from 'vitest'
import { createPlaybackRuntime } from '../../src/runtime/playback.js'
import { dispatchRecord } from '../../src/runtime/dispatch-record.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'

const EMFPLUS_FILL_RECTS = 0x400a
const EMFPLUS_CLEAR = 0x4009
const EMFPLUS_DRAW_RECTS = 0x400b
const EMFPLUS_FILL_POLYGON = 0x400c
const EMFPLUS_DRAW_LINES = 0x400d
const EMFPLUS_FILL_ELLIPSE = 0x400e
const EMFPLUS_DRAW_ELLIPSE = 0x400f
const EMFPLUS_FILL_PIE = 0x4010
const EMFPLUS_DRAW_PIE = 0x4011
const EMFPLUS_DRAW_ARC = 0x4012
const EMFPLUS_FILL_REGION = 0x4013
const EMFPLUS_DRAW_BEZIERS = 0x4019
const EMFPLUS_DRAW_IMAGE = 0x401a
const EMFPLUS_DRAW_STRING = 0x401c
const EMFPLUS_SET_RENDERING_ORIGIN = 0x401d
const EMFPLUS_SET_TEXT_CONTRAST = 0x4020
const EMFPLUS_TRANSLATE_WORLD_TRANSFORM = 0x402d
const EMFPLUS_SCALE_WORLD_TRANSFORM = 0x402e
const EMFPLUS_ROTATE_WORLD_TRANSFORM = 0x402f
const EMFPLUS_RESET_CLIP = 0x4031
const EMFPLUS_SET_CLIP_PATH = 0x4033
const EMFPLUS_OFFSET_CLIP = 0x4035
const EMFPLUS_DRAW_DRIVER_STRING = 0x4036
const EMFPLUS_OBJECT_BRUSH = 1
const EMFPLUS_OBJECT_PEN = 2
const EMFPLUS_OBJECT_REGION = 4
const EMFPLUS_OBJECT_IMAGE = 5
const EMFPLUS_OBJECT_CUSTOM_LINE_CAP = 9

function encodeTsClipValue(value, compressed = false) {
  if (compressed) {
    if (value < -64 || value > 63) {
      throw new RangeError(`compressed TS clip delta out of range: ${value}`)
    }

    return [0x80 | (value & 0x7f)]
  }

  if (value < -0x4000 || value > 0x3fff) {
    throw new RangeError(`TS clip delta out of range: ${value}`)
  }

  const encoded = value < 0 ? value + 0x8000 : value

  return [((encoded >> 8) & 0x7f), encoded & 0xff]
}

function encodeTsClipRects(rects, compressed = false) {
  const bytes = []
  let previousLeft = 0
  let previousTop = 0
  let previousRight = 0

  for (const rect of rects) {
    bytes.push(...encodeTsClipValue(rect.left - previousLeft, compressed))
    bytes.push(...encodeTsClipValue(rect.top - previousTop, compressed))
    bytes.push(...encodeTsClipValue(rect.right - previousRight, compressed))
    bytes.push(...encodeTsClipValue(rect.bottom - rect.top, compressed))
    previousLeft = rect.left
    previousTop = rect.top
    previousRight = rect.right
  }

  return Uint8Array.from(bytes)
}

function rectToClipPolygon(rect) {
  return [
    [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
      [rect.left, rect.top]
    ]
  ]
}

function writeSimplePathObject(view, offset) {
  view.setUint32(offset, 0xdbc01002, true)
  view.setUint32(offset + 4, 2, true)
  view.setUint32(offset + 8, 0, true)
  view.setFloat32(offset + 12, 0, true)
  view.setFloat32(offset + 16, 0, true)
  view.setFloat32(offset + 20, -2, true)
  view.setFloat32(offset + 24, 0, true)
  view.setUint8(offset + 28, 0)
  view.setUint8(offset + 29, 1)
  return 32
}

function writeDefaultCustomLineCap(view, offset) {
  view.setUint32(offset, 0xdbc01002, true)
  view.setUint32(offset + 4, 0, true)
  view.setUint32(offset + 8, 0x00000001, true)
  view.setUint32(offset + 12, 2, true)
  view.setFloat32(offset + 16, 0, true)
  view.setUint32(offset + 20, 0, true)
  view.setUint32(offset + 24, 0, true)
  view.setUint32(offset + 28, 0, true)
  view.setFloat32(offset + 32, 10, true)
  view.setFloat32(offset + 36, 1, true)
  view.setFloat32(offset + 40, 0, true)
  view.setFloat32(offset + 44, 0, true)
  view.setFloat32(offset + 48, 0, true)
  view.setFloat32(offset + 52, 0, true)
  const pathSize = writeSimplePathObject(view, offset + 60)
  view.setInt32(offset + 56, pathSize, true)
}

function createMinimalEmfPlusRuntime(view = new DataView(new ArrayBuffer(64))) {
  const backend = {
    resize() {},
    clear() {},
    setTransform() {},
    save() {},
    restore() {}
  }
  const parsed = {
    header: {
      bounds: { left: 0, top: 0, right: 40, bottom: 30 },
      deviceWidth: 40,
      deviceHeight: 30
    },
    view,
    records: []
  }

  return {
    backend,
    parsed,
    runtime: createPlaybackRuntime(parsed, backend)
  }
}

function dispatchEmfPlusObject(parsed, runtime, backend, objectType, objectId, dataSize, extra = {}) {
  return dispatchRecord(parsed, runtime, backend, {
    source: 'emfplus',
    type: EmfPlusRecordType.Object,
    flags: (objectType << 8) | objectId,
    dataOffset: 0,
    dataSize,
    ...extra
  })
}

describe('dispatchRecord EMF+', () => {
  test('decodes path objects and routes FillPath through the shared dispatcher', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillPath(path, brush) {
        calls.push(['fillPath', path, brush])
      }
    }
    const view = new DataView(new ArrayBuffer(64))
    view.setUint32(4, 1, true)
    view.setFloat32(12, 10, true)
    view.setFloat32(16, 20, true)
    new Uint8Array(view.buffer)[20] = 0
    view.setUint32(24, 0xff336699, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags: (3 << 8) | 5,
      dataOffset: 0,
      dataSize: 21
    })
    dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.FillPath,
      flags: 0x8000 | 5,
      dataOffset: 24,
      dataSize: 4,
      format: 'emfplus'
    })

    expect(runtime.objects.get(5)).toEqual({
      kind: 'path',
      flags: 0,
      figures: [
        {
          closed: false,
          points: [{ x: 10, y: 20 }]
        }
      ]
    })
    expect(calls).toEqual([
      [
        'fillPath',
        runtime.objects.get(5),
        { kind: 'brush', type: 'solid', color: 'rgba(51, 102, 153, 1)' }
      ]
    ])
    expect(runtime.unsupported).toEqual([])
  })

  test('stores default custom line cap path data without unsupported warnings', () => {
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {}
    }
    const view = new DataView(new ArrayBuffer(92))

    writeDefaultCustomLineCap(view, 0)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags: (9 << 8) | 4,
      dataOffset: 0,
      dataSize: 92
    })

    expect(runtime.objects.get(4)).toMatchObject({
      kind: 'customLineCap',
      type: 'default',
      fillPath: {
        kind: 'path',
        figures: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: -2, y: 0 }
            ]
          }
        ]
      }
    })
    expect(runtime.warnings).not.toContain('Unsupported EMF+ CustomLineCap default path data: truncated')
  })

  test('records a warning when an EMF+ brush object uses an unsupported brush type', () => {
    const view = new DataView(new ArrayBuffer(12))
    view.setUint32(4, 99, true)
    view.setUint32(8, 0xff010203, true)
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(view)

    const handled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_BRUSH, 2, 12)

    expect(handled).toBe(true)
    expect(runtime.warnings).toContain('Unsupported EMF+ brush: type=99')
  })

  test('records a warning when an EMF+ image object uses an unsupported image type', () => {
    const view = new DataView(new ArrayBuffer(8))
    view.setUint32(4, 77, true)
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(view)

    const handled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_IMAGE, 3, 8)

    expect(handled).toBe(true)
    expect(runtime.warnings).toContain('Unsupported EMF+ image: type=77')
  })

  test('records region warnings for short headers and parse failures', () => {
    const view = new DataView(new ArrayBuffer(8))
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(view)

    const shortHeaderHandled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_REGION, 4, 4)
    const parseFailureHandled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_REGION, 5, 8)

    expect(shortHeaderHandled).toBe(true)
    expect(parseFailureHandled).toBe(true)
    expect(runtime.warnings).toContain('Unsupported EMF+ region: header too short')
    expect(runtime.warnings).toContain('Unsupported EMF+ region: Region node exceeds object bounds')
  })

  test('records a warning when a serializable EMF+ effect has an unsupported GUID', () => {
    const view = new DataView(new ArrayBuffer(20))
    const expectedGuid = '12345678-9abc-def0-1122-334455667788'
    view.setUint32(0, 0x12345678, true)
    view.setUint16(4, 0x9abc, true)
    view.setUint16(6, 0xdef0, true)
    new Uint8Array(view.buffer, 8, 8).set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88])
    view.setUint32(16, 4, true)
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(view)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SerializableObject,
      flags: 0,
      dataOffset: 0,
      dataSize: 20
    })

    expect(handled).toBe(true)
    expect(runtime.currentEmfPlusEffect).toMatchObject({
      kind: 'effect',
      type: 'unknown',
      guid: expectedGuid
    })
    expect(runtime.warnings).toContain(`Unsupported EMF+ effect: guid=${expectedGuid}`)
  })

  test('records warnings for unknown EMF+ custom line cap placeholders', () => {
    const view = new DataView(new ArrayBuffer(8))
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(view)

    const shortHeaderHandled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_CUSTOM_LINE_CAP, 6, 4)
    view.setUint32(4, 88, true)
    const unknownTypeHandled = dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_CUSTOM_LINE_CAP, 7, 8)

    expect(shortHeaderHandled).toBe(true)
    expect(unknownTypeHandled).toBe(true)
    expect(runtime.warnings).toContain('Unsupported EMF+ custom line cap: header too short')
    expect(runtime.warnings).toContain('Unsupported EMF+ custom line cap: type=88')
  })

  test('recurses into EMF+ pen and texture brush children and deduplicates repeated object references', () => {
    const { backend, parsed, runtime } = createMinimalEmfPlusRuntime(new DataView(new ArrayBuffer(4)))
    const pen = {
      kind: 'pen',
      width: 1,
      color: 'rgba(0, 0, 0, 1)',
      brush: {
        kind: 'brush',
        type: 'unknown',
        brushType: 123
      },
      customStartCap: {
        kind: 'customLineCap',
        type: 'unknown'
      },
      customEndCap: {
        kind: 'customLineCap',
        type: 'unknown',
        customLineCapType: 456
      }
    }
    const textureBrush = {
      kind: 'brush',
      type: 'texture',
      image: {
        kind: 'image',
        format: 'unknown',
        imageType: 789,
        bytes: new Uint8Array(0),
        buffer: new ArrayBuffer(0)
      }
    }
    const warningCount = (message) => runtime.warnings.filter((warning) => warning === message).length

    dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_PEN, 8, 0, { prefetchedObject: pen })
    dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_PEN, 8, 0, { prefetchedObject: pen })
    dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_BRUSH, 9, 0, { prefetchedObject: textureBrush })
    dispatchEmfPlusObject(parsed, runtime, backend, EMFPLUS_OBJECT_BRUSH, 9, 0, { prefetchedObject: textureBrush })

    expect(warningCount('Unsupported EMF+ brush: type=123')).toBe(1)
    expect(warningCount('Unsupported EMF+ custom line cap: header too short')).toBe(1)
    expect(warningCount('Unsupported EMF+ custom line cap: type=456')).toBe(1)
    expect(warningCount('Unsupported EMF+ image: type=789')).toBe(1)
  })

  test('realizes embedded texture-brush images when EMF+ object records are stored and reused', () => {
    const calls = []
    const surfacedImages = []
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
    const view = new DataView(new ArrayBuffer(112))

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
    new Uint8Array(view.buffer, 68, 4).set([0, 0, 255, 255])

    view.setUint32(80, 6, true)
    view.setUint32(84, 1, true)
    view.setFloat32(88, 2, true)
    view.setFloat32(92, 3, true)
    view.setFloat32(96, 10, true)
    view.setFloat32(100, 20, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    const surface = { width: 1, height: 1, __canvasBackendImageSource: true }

    runtime.ensureImageSurface = (image) => {
      // Mirror the real ensureImageSurface: an already-realized image surface
      // is returned untouched, so reusing a stored brush does not re-create it.
      if (image.canvas) {
        return image
      }

      surfacedImages.push(image)
      return {
        ...image,
        canvas: surface
      }
    }

    const objectHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags: (1 << 8) | 6,
      dataOffset: 0,
      dataSize: 72
    })
    const fillHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_RECTS,
      flags: 6,
      dataOffset: 80,
      dataSize: 24
    })

    expect(objectHandled).toBe(true)
    expect(fillHandled).toBe(true)
    expect(surfacedImages).toHaveLength(1)
    expect(runtime.objects.get(6)).toMatchObject({
      kind: 'brush',
      type: 'texture',
      image: {
        canvas: surface
      }
    })
    expect(calls).toEqual([
      [
        'fillRect',
        { left: 2, top: 3, right: 12, bottom: 23 },
        runtime.objects.get(6)
      ]
    ])
  })

  test('dispatches EMF+ state, transform, quality, and clip records through the shared dispatcher', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      save() {},
      restore() {},
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      }
    }
    const view = new DataView(new ArrayBuffer(96))
    view.setUint32(0, 9, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 3, true)
    view.setFloat32(24, 10, true)
    view.setFloat32(28, 20, true)
    view.setFloat32(32, 5, true)
    view.setFloat32(36, 6, true)
    view.setFloat32(40, 70, true)
    view.setFloat32(44, 80, true)
    view.setFloat32(48, 1.5, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    calls.length = 0

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.Save,
        flags: 0,
        dataOffset: 0,
        dataSize: 4
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetWorldTransform,
        flags: 0,
        dataOffset: 8,
        dataSize: 24
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetPageTransform,
        flags: 2,
        dataOffset: 48,
        dataSize: 4
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRect,
        flags: 0x0200,
        dataOffset: 32,
        dataSize: 16
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetAntiAliasMode,
        flags: 3,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetInterpolationMode,
        flags: 4,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetPixelOffsetMode,
        flags: 5,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetTextRenderingHint,
        flags: 6,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_SET_TEXT_CONTRAST,
        flags: 0,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetCompositingQuality,
        flags: 7,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.Restore,
        flags: 0,
        dataOffset: 0,
        dataSize: 4
      })
    ]

    expect(handled).toEqual([true, true, true, true, true, true, true, true, true, true, true])
    expect(calls).toEqual([
      ['setTransform', [2, 0, 0, 3, 10, 20]],
      ['setTransform', [3, 0, 0, 4.5, 15, 30]],
      ['clipRect', { x: 5, y: 6, width: 70, height: 80 }, 'intersect'],
      ['setTransform', [1, 0, 0, 1, 0, 0]]
    ])
    expect(runtime.state.current).toMatchObject({
      worldTransform: [1, 0, 0, 1, 0, 0],
      pageScale: 1,
      pageUnit: 'pixel',
      clip: null,
      smoothingMode: 'default',
      interpolationMode: 'default',
      pixelOffsetMode: 'default',
      textRenderingHint: 'system',
      textContrast: 0,
      compositingQuality: 'default'
    })
  })

  test('dispatches SetTSGraphics as a terminal-server graphics-state snapshot', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      save() {},
      restore() {}
    }
    const view = new DataView(new ArrayBuffer(48))
    view.setUint8(0, 3)
    view.setUint8(1, 4)
    view.setUint8(2, 1)
    view.setUint8(3, 5)
    view.setInt16(4, 12, true)
    view.setInt16(6, 13, true)
    view.setUint16(8, 77, true)
    view.setUint8(10, 6)
    view.setUint8(11, 7)
    view.setFloat32(12, 2, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 3, true)
    view.setFloat32(28, 10, true)
    view.setFloat32(32, 20, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    calls.length = 0

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetTSGraphics,
      flags: 0,
      dataOffset: 0,
      dataSize: 36
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([['setTransform', [2, 0, 0, 3, 10, 20]]])
    expect(runtime.state.current).toMatchObject({
      worldTransform: [2, 0, 0, 3, 10, 20],
      renderingOrigin: { x: 12, y: 13 },
      smoothingMode: 3,
      interpolationMode: 6,
      pixelOffsetMode: 7,
      textRenderingHint: 4,
      textContrast: 77,
      compositingMode: 'sourceCopy',
      compositingQuality: 5
    })
  })

  test('dispatches SetTSClip as a replace clip region built from delta-encoded 16-bit rectangles', () => {
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
    const rects = [
      { left: 100, top: 200, right: 130, bottom: 240 },
      { left: 150, top: 210, right: 170, bottom: 260 }
    ]
    const bytes = encodeTsClipRects(rects)
    const view = new DataView(bytes.buffer)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetTSClip,
      flags: rects.length,
      dataOffset: 0,
      dataSize: bytes.length
    })

    expect(handled).toBe(true)
    expect(runtime.state.current.clip).toMatchObject({
      kind: 'geometry',
      mode: 'replace'
    })
    expect(runtime.state.current.clip.geometry).toEqual(rects.map(rectToClipPolygon))
    expect(calls).toEqual([['setClip', runtime.state.current.clip]])
  })

  test('dispatches SetTSClip compressed rectangles using signed delta bytes', () => {
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
    const rects = [
      { left: 20, top: 30, right: 45, bottom: 55 },
      { left: 50, top: 35, right: 70, bottom: 60 }
    ]
    const bytes = encodeTsClipRects(rects, true)
    const view = new DataView(bytes.buffer)
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

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetTSClip,
      flags: 0x8000 | rects.length,
      dataOffset: 0,
      dataSize: bytes.length
    })

    expect(handled).toBe(true)
    expect(runtime.state.current.clip.geometry).toEqual(rects.map(rectToClipPolygon))
    expect(calls).toEqual([['setClip', runtime.state.current.clip]])
  })

  test('dispatches SetClipRegion by reusing decoded region objects', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      }
    }
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view: new DataView(new ArrayBuffer(32)),
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    calls.length = 0
    runtime.objects.set(1, {
      kind: 'region',
      type: 'rect',
      rect: { x: 8, y: 9, width: 10, height: 11 }
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetClipRegion,
      flags: 1,
      dataOffset: 0,
      dataSize: 0
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      ['clipRect', { x: 8, y: 9, width: 10, height: 11 }, 'replace']
    ])
    expect(runtime.state.current.clip).toEqual({
      kind: 'geometry',
      mode: 'replace',
      source: {
        kind: 'region',
        region: runtime.objects.get(1)
      },
      geometry: [
        [
          [
            [8, 9],
            [18, 9],
            [18, 20],
            [8, 20],
            [8, 9]
          ]
        ]
      ]
    })
  })

  test('combines clip geometry in runtime and clears infinite or reset clips through backend.setClip', () => {
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
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 80, bottom: 60 },
        deviceWidth: 80,
        deviceHeight: 60
      },
      view: new DataView(new ArrayBuffer(32)),
      records: []
    }
    parsed.view.setFloat32(0, 0, true)
    parsed.view.setFloat32(4, 0, true)
    parsed.view.setFloat32(8, 10, true)
    parsed.view.setFloat32(12, 10, true)
    parsed.view.setFloat32(16, 40, true)
    parsed.view.setFloat32(20, 5, true)
    parsed.view.setFloat32(24, 8, true)
    parsed.view.setFloat32(28, 9, true)
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(1, {
      kind: 'region',
      type: 'rect',
      rect: { x: 20, y: 0, width: 10, height: 10 }
    })
    runtime.objects.set(2, {
      kind: 'region',
      type: 'infinite'
    })

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRect,
        flags: 0x0100,
        dataOffset: 0,
        dataSize: 16
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRegion,
        flags: 0x0301,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRegion,
        flags: 0x0102,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRect,
        flags: 0x0100,
        dataOffset: 16,
        dataSize: 16
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_RESET_CLIP,
        flags: 0,
        dataOffset: 0,
        dataSize: 0
      })
    ]

    expect(handled).toEqual([true, true, true, true, true])
    expect(calls[0]).toEqual([
      'setClip',
      {
        kind: 'geometry',
        mode: 'replace',
        source: {
          kind: 'rect',
          rect: { x: 0, y: 0, width: 10, height: 10 }
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
          ]
        ]
      }
    ])
    expect(calls[1][0]).toBe('setClip')
    expect(calls[1][1]).toMatchObject({
      kind: 'geometry',
      mode: 'union'
    })
    expect(calls[1][1].geometry).toHaveLength(2)
    expect(calls[2]).toEqual(['setClip', null])
    expect(calls[3][1]).toMatchObject({
      kind: 'geometry',
      mode: 'replace',
      source: {
        kind: 'rect',
        rect: { x: 40, y: 5, width: 8, height: 9 }
      }
    })
    expect(calls[4]).toEqual(['setClip', null])
    expect(runtime.state.current.clip).toBeNull()
  })

  test('routes SetClipPath through path geometry instead of relying on rect-only clip fallbacks', () => {
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
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 80, bottom: 60 },
        deviceWidth: 80,
        deviceHeight: 60
      },
      view: new DataView(new ArrayBuffer(16)),
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(7, {
      kind: 'path',
      figures: [
        {
          closed: true,
          points: [
            { x: 5, y: 6 },
            { x: 25, y: 6 },
            { x: 5, y: 26 }
          ]
        }
      ]
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_SET_CLIP_PATH,
      flags: 0x0107,
      dataOffset: 0,
      dataSize: 0
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'setClip',
        {
          kind: 'geometry',
          mode: 'replace',
          source: {
            kind: 'path',
            path: runtime.objects.get(7)
          },
          geometry: [
            [
              [
                [5, 6],
                [25, 6],
                [5, 26],
                [5, 6]
              ]
            ]
          ]
        }
      ]
    ])
  })

  test('evaluates infinite Region trees against the playback viewport when clip geometry is requested', () => {
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
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 80, bottom: 60 },
        deviceWidth: 80,
        deviceHeight: 60
      },
      view: new DataView(new ArrayBuffer(8)),
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(9, {
      kind: 'region',
      type: 'tree',
      nodeCount: 3,
      root: {
        type: 'exclude',
        left: {
          type: 'infinite'
        },
        right: {
          type: 'rect',
          rect: { x: 10, y: 12, width: 20, height: 15 }
        }
      }
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetClipRegion,
      flags: 0x0109,
      dataOffset: 0,
      dataSize: 0
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'setClip',
        {
          kind: 'geometry',
          mode: 'replace',
          source: {
            kind: 'region',
            region: runtime.objects.get(9)
          },
          geometry: [
            [
              [
                [0, 0],
                [80, 0],
                [80, 60],
                [0, 60],
                [0, 0]
              ],
              [
                [10, 12],
                [10, 27],
                [30, 27],
                [30, 12],
                [10, 12]
              ]
            ]
          ]
        }
      ]
    ])
  })

  test('decodes generic objects and routes DrawPath and DrawImagePoints through the shared dispatcher', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      },
      drawImageParallelogram(image, points, sourceRect) {
        calls.push(['drawImageParallelogram', image, points, sourceRect])
      }
    }
    const view = new DataView(new ArrayBuffer(96))
    view.setUint32(8, 0xff112233, true)
    view.setUint32(12, 6, true)
    view.setUint32(24, 3, true)
    view.setInt32(28, 0, true)
    view.setFloat32(32, 2, true)
    view.setFloat32(36, 4, true)
    view.setFloat32(40, 20, true)
    view.setFloat32(44, 30, true)
    view.setUint32(48, 3, true)
    view.setFloat32(52, 10, true)
    view.setFloat32(56, 11, true)
    view.setFloat32(60, 30, true)
    view.setFloat32(64, 11, true)
    view.setFloat32(68, 10, true)
    view.setFloat32(72, 41, true)
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    calls.length = 0
    runtime.objects.set(3, {
      kind: 'path',
      figures: [{ closed: false, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }]
    })
    runtime.objects.set(6, {
      kind: 'pen',
      width: 2,
      color: 'rgba(200, 100, 50, 1)'
    })
    runtime.objects.set(7, {
      kind: 'image',
      format: 'bitmap',
      width: 20,
      height: 30,
      canvas: { width: 20, height: 30 }
    })

    const objectHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags: (1 << 8) | 5,
      dataOffset: 0,
      dataSize: 12
    })
    const drawPathHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawPath,
      flags: 3,
      dataOffset: 12,
      dataSize: 4
    })
    const drawImageHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImagePoints,
      flags: 7,
      dataOffset: 24,
      dataSize: 52
    })

    expect(objectHandled).toBe(true)
    expect(drawPathHandled).toBe(true)
    expect(drawImageHandled).toBe(true)
    expect(runtime.objects.get(5)).toEqual({
      kind: 'brush',
      type: 'solid',
      color: 'rgba(17, 34, 51, 1)'
    })
    expect(calls).toEqual([
      [
        'strokePath',
        runtime.objects.get(3),
        runtime.objects.get(6)
      ],
      [
        'drawImageParallelogram',
        runtime.objects.get(7),
        [
          { x: 10, y: 11 },
          { x: 30, y: 11 },
          { x: 10, y: 41 }
        ],
        { x: 2, y: 4, width: 20, height: 30 }
      ]
    ])
  })

  test('reuses the latest serializable color-matrix effect when DrawImagePoints sets the E flag', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      drawImageParallelogram(image, points, sourceRect, imageAttributes, effect) {
        calls.push(['drawImageParallelogram', image, points, sourceRect, imageAttributes, effect])
      }
    }
    const view = new DataView(new ArrayBuffer(192))
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

    view.setUint32(124, 0, true)
    view.setInt32(128, 2, true)
    view.setFloat32(132, 0, true)
    view.setFloat32(136, 0, true)
    view.setFloat32(140, 20, true)
    view.setFloat32(144, 10, true)
    view.setUint32(148, 3, true)
    view.setFloat32(152, 10, true)
    view.setFloat32(156, 11, true)
    view.setFloat32(160, 30, true)
    view.setFloat32(164, 11, true)
    view.setFloat32(168, 10, true)
    view.setFloat32(172, 21, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(7, {
      kind: 'image',
      format: 'bitmap',
      width: 20,
      height: 10,
      canvas: { width: 20, height: 10 }
    })
    runtime.ensureImageSurface = (image) => image

    const serializableHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: 0x4038,
      flags: 0,
      dataOffset: 0,
      dataSize: 120
    })
    const drawImageHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImagePoints,
      flags: 0x2000 | 7,
      dataOffset: 124,
      dataSize: 52
    })

    expect(serializableHandled).toBe(true)
    expect(drawImageHandled).toBe(true)
    expect(calls).toEqual([
      [
        'drawImageParallelogram',
        runtime.objects.get(7),
        [
          { x: 10, y: 11 },
          { x: 30, y: 11 },
          { x: 10, y: 21 }
        ],
        { x: 0.5, y: 0.5, width: 20, height: 10 },
        null,
        {
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
        }
      ]
    ])
  })

  test('reuses the latest serializable effect when DrawImage sets the E flag', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      drawImageRect(image, destinationRect, sourceRect, imageAttributes, effect) {
        calls.push(['drawImageRect', image, destinationRect, sourceRect, imageAttributes, effect])
      }
    }
    const view = new DataView(new ArrayBuffer(64))

    view.setUint32(0, 0, true)
    view.setInt32(4, 2, true)
    view.setFloat32(8, 0, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 16, true)
    view.setFloat32(20, 12, true)
    view.setFloat32(24, 3, true)
    view.setFloat32(28, 4, true)
    view.setFloat32(32, 40, true)
    view.setFloat32(36, 20, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 80, bottom: 60 },
        deviceWidth: 80,
        deviceHeight: 60
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(8, {
      kind: 'image',
      format: 'bitmap',
      width: 16,
      height: 12,
      canvas: { width: 16, height: 12 }
    })
    runtime.ensureImageSurface = (image) => image
    runtime.currentEmfPlusEffect = {
      kind: 'effect',
      type: 'brightnessContrast',
      brightnessLevel: 20,
      contrastLevel: -5
    }

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImage,
      flags: 0x2000 | 8,
      dataOffset: 0,
      dataSize: 40
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'drawImageRect',
        runtime.objects.get(8),
        { x: 3, y: 4, width: 40, height: 20 },
        { x: 0.5, y: 0.5, width: 16, height: 12 },
        null,
        runtime.currentEmfPlusEffect
      ]
    ])
  })

  test('treats EMF+ DrawImage / DrawImagePoints as handled (not unsupported) when no drawable surface exists', () => {
    // Regression: both handlers used to emit the image-surface-unavailable
    // warning and then fall through to `return false`, so playback counted the
    // record as BOTH a warning and an unsupported record (double counting). A
    // headless host with no canvas must degrade to a single diagnostic, mirroring
    // handleClassicRasterOperation.
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      drawImageRect(...args) {
        calls.push(['drawImageRect', ...args])
      },
      drawImageParallelogram(...args) {
        calls.push(['drawImageParallelogram', ...args])
      }
    }

    const view = new DataView(new ArrayBuffer(104))
    // DrawImage record at offset 0: srcUnit, sourceRect (16), destRect (16)
    view.setInt32(4, 2, true)
    view.setFloat32(8, 0, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 16, true)
    view.setFloat32(20, 12, true)
    view.setFloat32(24, 3, true)
    view.setFloat32(28, 4, true)
    view.setFloat32(32, 40, true)
    view.setFloat32(36, 20, true)
    // DrawImagePoints record at offset 48: srcUnit, sourceRect (16), count, 3 points (8 bytes each)
    view.setInt32(52, 0, true)
    view.setFloat32(56, 2, true)
    view.setFloat32(60, 4, true)
    view.setFloat32(64, 20, true)
    view.setFloat32(68, 30, true)
    view.setUint32(72, 3, true)
    view.setFloat32(76, 10, true)
    view.setFloat32(80, 11, true)
    view.setFloat32(84, 30, true)
    view.setFloat32(88, 11, true)
    view.setFloat32(92, 10, true)
    view.setFloat32(96, 41, true)

    const parsed = {
      header: { bounds: { left: 0, top: 0, right: 80, bottom: 60 }, deviceWidth: 80, deviceHeight: 60 },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    // Surfaceless images (no canvas/element) — resolveBackendImageSource returns null.
    runtime.objects.set(8, { kind: 'image', format: 'bitmap', width: 16, height: 12 })
    runtime.objects.set(7, { kind: 'image', format: 'bitmap', width: 20, height: 30 })
    runtime.ensureImageSurface = (image) => ({
      ...image,
      surfaceFailure: {
        message: 'headless host has no canvas',
        code: 'image-surface-unavailable',
        capability: 'image-surface'
      }
    })

    const drawImageHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImage,
      flags: 8,
      dataOffset: 0,
      dataSize: 40
    })
    const drawImagePointsHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImagePoints,
      flags: 7,
      dataOffset: 48,
      dataSize: 44
    })

    // Recognized + degraded: handled is true so playback does NOT mark it unsupported.
    expect(drawImageHandled).toBe(true)
    expect(drawImagePointsHandled).toBe(true)
    // No backend draw happened (no surface), and the surface-unavailable diagnostic fired once per record.
    expect(calls).toEqual([])
    expect(runtime.unsupported).toEqual([])
    const surfaceWarnings = runtime.diagnostics.filter((entry) => entry.code === 'image-surface-unavailable')
    expect(surfaceWarnings).toHaveLength(2)
  })

  test('dispatches StrokeFillPath by using the current pen and brush instead of payload object ids', () => {
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
    const view = new DataView(new ArrayBuffer(0))

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(3, {
      kind: 'path',
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
          ]
        }
      ]
    })
    runtime.selectedBrush = {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(1, 2, 3, 1)'
    }
    runtime.selectedPen = {
      kind: 'pen',
      width: 2,
      color: 'rgba(4, 5, 6, 1)'
    }
    runtime.classicState.miterLimit = 11

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.StrokeFillPath,
      flags: 3,
      dataOffset: 0,
      dataSize: 0
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      ['fillPath', runtime.objects.get(3), runtime.selectedBrush],
      ['strokePath', runtime.objects.get(3), { ...runtime.selectedPen, miterLimit: 11 }]
    ])
  })

  test('passes destination display size hints when drawing vector metafile images', () => {
    const calls = []
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 400, bottom: 200 },
        deviceWidth: 400,
        deviceHeight: 200
      },
      view: new DataView(new ArrayBuffer(80)),
      records: []
    }
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      drawImageParallelogram(image, points, sourceRect) {
        calls.push(['drawImageParallelogram', image.width, image.height, points, sourceRect])
      }
    }
    parsed.view.setInt32(4, 0, true)
    parsed.view.setFloat32(8, 158, true)
    parsed.view.setFloat32(12, 128, true)
    parsed.view.setFloat32(16, 165, true)
    parsed.view.setFloat32(20, 97, true)
    parsed.view.setUint32(24, 3, true)
    parsed.view.setFloat32(28, 10, true)
    parsed.view.setFloat32(32, 20, true)
    parsed.view.setFloat32(36, 340, true)
    parsed.view.setFloat32(40, 20, true)
    parsed.view.setFloat32(44, 10, true)
    parsed.view.setFloat32(48, 214, true)

    const runtime = createPlaybackRuntime(parsed, backend)
    const hints = []
    runtime.objects.set(7, {
      kind: 'image',
      format: 'wmf',
      sourceBounds: { x: 158, y: 128, width: 165, height: 97 }
    })
    runtime.ensureImageSurface = (image, hint) => {
      hints.push(hint)
      return {
        ...image,
        canvas: { width: Math.ceil(hint.displayedWidth), height: Math.ceil(hint.displayedHeight) },
        width: Math.ceil(hint.displayedWidth),
        height: Math.ceil(hint.displayedHeight)
      }
    }

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawImagePoints,
      flags: 7,
      dataOffset: 0,
      dataSize: 52
    })

    expect(handled).toBe(true)
    expect(hints).toEqual([
      {
        displayedWidth: 330,
        displayedHeight: 194,
        sourceRect: { x: 158, y: 128, width: 165, height: 97 }
      }
    ])
    expect(calls).toEqual([
      [
        'drawImageParallelogram',
        330,
        194,
        [
          { x: 10, y: 20 },
          { x: 340, y: 20 },
          { x: 10, y: 214 }
        ],
        { x: 0, y: 0, width: 330, height: 194 }
      ]
    ])
  })

  test('routes FillClosedCurve and DrawClosedCurve through shared closed-spline geometry', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    const view = new DataView(new ArrayBuffer(64))
    view.setUint32(0, 1, true)
    view.setFloat32(4, 0.5, true)
    view.setUint32(8, 4, true)
    view.setInt16(12, 0, true)
    view.setInt16(14, 0, true)
    view.setInt16(16, 10, true)
    view.setInt16(18, 0, true)
    view.setInt16(20, 10, true)
    view.setInt16(22, 10, true)
    view.setInt16(24, 0, true)
    view.setInt16(26, 10, true)
    view.setFloat32(32, 0.5, true)
    view.setUint32(36, 4, true)
    view.setInt16(40, 0, true)
    view.setInt16(42, 0, true)
    view.setInt16(44, 10, true)
    view.setInt16(46, 0, true)
    view.setInt16(48, 10, true)
    view.setInt16(50, 10, true)
    view.setInt16(52, 0, true)
    view.setInt16(54, 10, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(1, {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(1, 2, 3, 1)'
    })
    runtime.objects.set(2, {
      kind: 'pen',
      width: 2,
      color: 'rgba(4, 5, 6, 1)'
    })

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.FillClosedCurve,
        flags: 0x4000,
        dataOffset: 0,
        dataSize: 28
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.DrawClosedCurve,
        flags: 0x4000 | 2,
        dataOffset: 32,
        dataSize: 24
      })
    ]

    expect(handled).toEqual([true, true])
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][1].figures[0].closed).toBe(true)
    expect(calls[0][1].figures[0].segments).toHaveLength(4)
    expect(calls[0][2]).toBe(runtime.objects.get(1))
    expect(calls[1][0]).toBe('strokePath')
    expect(calls[1][1].figures[0].closed).toBe(true)
    expect(calls[1][1].figures[0].segments).toHaveLength(4)
    expect(calls[1][2]).toBe(runtime.objects.get(2))
  })

  test('uses winding fill mode when FillClosedCurve sets the W flag', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      }
    }
    const view = new DataView(new ArrayBuffer(32))
    view.setUint32(0, 1, true)
    view.setFloat32(4, 0.5, true)
    view.setUint32(8, 3, true)
    view.setInt16(12, 0, true)
    view.setInt16(14, 0, true)
    view.setInt16(16, 10, true)
    view.setInt16(18, 0, true)
    view.setInt16(20, 10, true)
    view.setInt16(22, 10, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(1, {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(1, 2, 3, 1)'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.FillClosedCurve,
      flags: 0x6000,
      dataOffset: 0,
      dataSize: 24
    })

    expect(handled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][2]).toBe(runtime.objects.get(1))
    expect(calls[0][3]).toEqual({ fillMode: 'winding' })
  })

  test('routes DrawCurve through shared open-spline geometry with offset and segment count', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    const view = new DataView(new ArrayBuffer(48))
    view.setFloat32(0, 0.5, true)
    view.setUint32(4, 1, true)
    view.setUint32(8, 2, true)
    view.setUint32(12, 4, true)
    view.setInt16(16, 0, true)
    view.setInt16(18, 0, true)
    view.setInt16(20, 10, true)
    view.setInt16(22, 0, true)
    view.setInt16(24, 10, true)
    view.setInt16(26, 10, true)
    view.setInt16(28, 20, true)
    view.setInt16(30, 10, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(2, {
      kind: 'pen',
      width: 2,
      color: 'rgba(4, 5, 6, 1)'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawCurve,
      flags: 0x4000 | 2,
      dataOffset: 0,
      dataSize: 32
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'strokePath',
        {
          figures: [
            {
              closed: false,
              points: [
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 20, y: 10 }
              ],
              segments: [
                {
                  type: 'bezier',
                  control1: { x: 10.833333333333334, y: 0.8333333333333334 },
                  control2: { x: 9.166666666666666, y: 9.166666666666666 },
                  point: { x: 10, y: 10 }
                },
                {
                  type: 'bezier',
                  control1: { x: 10.833333333333334, y: 10.833333333333334 },
                  control2: { x: 19.166666666666668, y: 10 },
                  point: { x: 20, y: 10 }
                }
              ]
            }
          ]
        },
        runtime.objects.get(2)
      ]
    ])
  })

  test('degrades non-spec DrawCurve field ordering to a decode diagnostic instead of guessing alternate layouts', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    const view = new DataView(new ArrayBuffer(32))
    view.setFloat32(0, 0.5, true)
    view.setUint32(4, 4, true)
    view.setUint32(8, 1, true)
    view.setUint32(12, 1, true)
    view.setInt16(16, 0, true)
    view.setInt16(18, 0, true)
    view.setInt16(20, 10, true)
    view.setInt16(22, 0, true)
    view.setInt16(24, 10, true)
    view.setInt16(26, 10, true)
    view.setInt16(28, 20, true)
    view.setInt16(30, 10, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(2, {
      kind: 'pen',
      width: 2,
      color: 'rgba(4, 5, 6, 1)'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawCurve,
      flags: 0x4000 | 2,
      dataOffset: 0,
      dataSize: 32
    })

    // Recognized record whose payload fails the spec layout check: degrade to a
    // decode diagnostic and handle it (do not draw, do not count unsupported).
    expect(handled).toBe(true)
    expect(calls).toEqual([])
    expect(runtime.unsupported).toEqual([])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'record-decode-failed' })
    )
  })

  test('uses spec-correct EMF+ drawing record ids for FillRegion, DrawImage, and DrawString', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      fillGeometry(geometry, brush, options) {
        calls.push(['fillGeometry', geometry, brush, options])
      },
      drawImageRect(image, destinationRect, sourceRect, imageAttributes) {
        calls.push(['drawImageRect', image, destinationRect, sourceRect, imageAttributes])
      },
      drawText(text, layoutRect, font, brush, format) {
        calls.push(['drawText', text, layoutRect, font, brush, format])
      }
    }
    const view = new DataView(new ArrayBuffer(112))
    view.setUint32(0, 2, true)
    view.setUint32(4, 7, true)
    view.setInt32(8, 0, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 0, true)
    view.setFloat32(20, 16, true)
    view.setFloat32(24, 12, true)
    view.setFloat32(28, 2, true)
    view.setFloat32(32, 3, true)
    view.setFloat32(36, 40, true)
    view.setFloat32(40, 20, true)
    view.setUint32(44, 2, true)
    view.setUint32(48, 6, true)
    view.setUint32(52, 5, true)
    view.setFloat32(56, 10, true)
    view.setFloat32(60, 20, true)
    view.setFloat32(64, 100, true)
    view.setFloat32(68, 30, true)
    view.setUint16(72, 'H'.charCodeAt(0), true)
    view.setUint16(74, 'e'.charCodeAt(0), true)
    view.setUint16(76, 'l'.charCodeAt(0), true)
    view.setUint16(78, 'l'.charCodeAt(0), true)
    view.setUint16(80, 'o'.charCodeAt(0), true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 160, bottom: 120 },
        deviceWidth: 160,
        deviceHeight: 120
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(2, {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(1, 2, 3, 1)'
    })
    runtime.objects.set(3, {
      kind: 'region',
      type: 'rect',
      rect: { x: 6, y: 7, width: 8, height: 9 }
    })
    runtime.objects.set(4, {
      kind: 'image',
      format: 'bitmap',
      width: 16,
      height: 12,
      canvas: { width: 16, height: 12 }
    })
    runtime.objects.set(5, {
      kind: 'font',
      emSize: 18,
      sizeUnit: 2,
      familyName: 'Arial',
      cssFont: '18px Arial'
    })
    runtime.objects.set(6, {
      kind: 'stringFormat',
      stringAlignment: 1,
      lineAlign: 2,
      tracking: 1.5,
      textAlign: 'center',
      textBaseline: 'bottom'
    })
    runtime.objects.set(7, {
      kind: 'imageAttributes',
      wrapMode: 'tileFlipXY'
    })
    runtime.ensureImageSurface = (image) => image

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_FILL_REGION,
        flags: 3,
        dataOffset: 0,
        dataSize: 4
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_IMAGE,
        flags: 4,
        dataOffset: 4,
        dataSize: 40
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_STRING,
        flags: 5,
        dataOffset: 44,
        dataSize: 38
      })
    ]

    expect(handled).toEqual([true, true, true])
    expect(calls).toEqual([
      [
        'fillGeometry',
        [
          [
            [
              [6, 7],
              [14, 7],
              [14, 16],
              [6, 16],
              [6, 7]
            ]
          ]
        ],
        runtime.objects.get(2),
        { fillMode: 'alternate' }
      ],
      [
        'drawImageRect',
        runtime.objects.get(4),
        { x: 2, y: 3, width: 40, height: 20 },
        { x: 0, y: 0, width: 16, height: 12 },
        runtime.objects.get(7)
      ],
      [
        'drawText',
        'Hello',
        { x: 10, y: 20, width: 100, height: 30 },
        runtime.objects.get(5),
        runtime.objects.get(2),
        expect.objectContaining({
          tracking: 1.5,
          textAlign: 'center',
          textBaseline: 'bottom'
        })
      ]
    ])
  })

  test('routes DrawDriverString through the backend with decoded glyph positions', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      drawDriverString(text, positions, font, brush, options, transform) {
        calls.push(['drawDriverString', text, positions, font, brush, options, transform])
      }
    }
    const view = new DataView(new ArrayBuffer(48))
    view.setUint32(0, 2, true)
    view.setUint32(4, 0x00000001, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, 2, true)
    view.setUint16(16, 'H'.charCodeAt(0), true)
    view.setUint16(18, 'i'.charCodeAt(0), true)
    view.setFloat32(20, 10, true)
    view.setFloat32(24, 20, true)
    view.setFloat32(28, 30, true)
    view.setFloat32(32, 40, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(2, {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(1, 2, 3, 1)'
    })
    runtime.objects.set(5, {
      kind: 'font',
      emSize: 18,
      sizeUnit: 2,
      familyName: 'Arial',
      cssFont: '18px Arial'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_DRAW_DRIVER_STRING,
      flags: 5,
      dataOffset: 0,
      dataSize: 36
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'drawDriverString',
        'Hi',
        [
          { x: 10, y: 20 },
          { x: 30, y: 40 }
        ],
        runtime.objects.get(5),
        runtime.objects.get(2),
        {
          cmapLookup: true,
          glyphSource: 'unicode',
          glyphs: [72, 105],
          realizedAdvance: false,
          vertical: false
        },
        null
      ]
    ])
  })

  test('requires explicit source metadata instead of inferring EMF+ format from type range', () => {
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view: new DataView(new ArrayBuffer(32)),
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {}
    })

    const handled = dispatchRecord(parsed, runtime, null, {
      type: EmfPlusRecordType.Object,
      flags: (3 << 8) | 5,
      dataOffset: 0,
      dataSize: 12
    })

    expect(handled).toBe(false)
    expect(runtime.objects.get(5)).toBeUndefined()
  })

  test('routes compressed DrawLines through shared stroke geometry', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      }
    }
    const view = new DataView(new ArrayBuffer(16))
    view.setUint32(0, 2, true)
    view.setInt16(4, 61, true)
    view.setInt16(6, 236, true)
    view.setInt16(8, 184, true)
    view.setInt16(10, 113, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(3, {
      kind: 'pen',
      width: 2,
      color: 'rgba(10, 20, 30, 1)'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_DRAW_LINES,
      flags: 0x4000 | 3,
      dataOffset: 0,
      dataSize: 12
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([
      [
        'strokePath',
        {
          figures: [
            {
              closed: false,
              points: [
                { x: 61, y: 236 },
                { x: 184, y: 113 }
              ]
            }
          ]
        },
        runtime.objects.get(3)
      ]
    ])
  })

  test('routes EMF+ pen drawing warnings into runtime diagnostics', () => {
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokeRect(rect, pen) {
        pen.addWarning('Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics', {
          code: 'emfplus-pen-transform-non-uniform'
        })
      }
    }
    const view = new DataView(new ArrayBuffer(20))
    view.setUint32(0, 1, true)
    view.setFloat32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 10, true)
    view.setFloat32(16, 8, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(3, {
      kind: 'pen',
      width: 2,
      color: 'rgba(10, 20, 30, 1)',
      transform: [2, 0, 0, 3, 0, 0]
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_DRAW_RECTS,
      flags: 3,
      dataOffset: 0,
      dataSize: 20
    })

    expect(handled).toBe(true)
    expect(runtime.warnings).toEqual([
      'Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics'
    ])
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'emfplus-pen-transform-non-uniform',
        message: 'Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics',
        source: 'emfplus',
        recordType: EMFPLUS_DRAW_RECTS,
        recordOffset: -12,
        objectId: 3
      })
    ])
  })

  test('routes EMF+ dash-cap drawing warnings into runtime diagnostics', () => {
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {},
      strokeRect(rect, pen) {
        pen.addWarning('Canvas backend cannot render EMF+ DashCapTriangle; drawing dashed stroke with butt dash caps', {
          code: 'emfplus-dash-cap-triangle-unsupported'
        })
      }
    }
    const view = new DataView(new ArrayBuffer(20))
    view.setUint32(0, 1, true)
    view.setFloat32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 10, true)
    view.setFloat32(16, 8, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 40, bottom: 30 },
        deviceWidth: 40,
        deviceHeight: 30
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(3, {
      kind: 'pen',
      width: 2,
      color: 'rgba(10, 20, 30, 1)',
      dashPattern: [3, 1],
      dashPatternUnit: 'penWidth',
      dashCap: 'triangle'
    })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_DRAW_RECTS,
      flags: 3,
      dataOffset: 0,
      dataSize: 20
    })

    expect(handled).toBe(true)
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'emfplus-dash-cap-triangle-unsupported',
        message: 'Canvas backend cannot render EMF+ DashCapTriangle; drawing dashed stroke with butt dash caps',
        source: 'emfplus',
        recordType: EMFPLUS_DRAW_RECTS,
        recordOffset: -12,
        objectId: 3
      })
    ])
  })

  test('fills direct-color rect batches and accepts rendering-origin state records', () => {
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
    const view = new DataView(new ArrayBuffer(32))
    view.setUint32(0, 0xff5b9bd5, true)
    view.setUint32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 1.999998688697815, true)
    view.setFloat32(16, 51.326969146728516, true)
    view.setFloat32(20, 25.87898826599121, true)
    view.setInt32(24, 2, true)
    view.setInt32(28, 42, true)

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

    const fillHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_RECTS,
      flags: 0x8000,
      dataOffset: 0,
      dataSize: 24
    })
    const originHandled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_SET_RENDERING_ORIGIN,
      flags: 0,
      dataOffset: 24,
      dataSize: 8
    })

    expect(fillHandled).toBe(true)
    expect(originHandled).toBe(true)
    expect(calls).toEqual([
      [
        'fillRect',
        {
          left: 2,
          top: 1.999998688697815,
          right: 53.326969146728516,
          bottom: 27.878986954689026
        },
        {
          kind: 'brush',
          type: 'solid',
          color: 'rgba(91, 155, 213, 1)'
        }
      ]
    ])
  })

  test('decodes EMF+ pen widths from object payloads instead of collapsing them to denormals', () => {
    const bytes = new Uint8Array([
      2, 16, 192, 219,
      0, 0, 0, 0,
      198, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 64, 64,
      2, 0, 0, 0,
      2, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      2, 16, 192, 219,
      0, 0, 0, 0,
      170, 170, 170, 255
    ])
    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 100, bottom: 80 },
        deviceWidth: 100,
        deviceHeight: 80
      },
      view: new DataView(bytes.buffer),
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {}
    })

    const handled = dispatchRecord(parsed, runtime, null, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags: (2 << 8) | 2,
      dataOffset: 0,
      dataSize: 48
    })

    expect(handled).toBe(true)
    expect(runtime.objects.get(2)).toMatchObject({
      kind: 'pen',
      width: 3,
      color: 'rgba(170, 170, 170, 1)'
    })
  })

  test('decodes EMF+ clip combine modes from the high byte and applies translate/scale/rotate transforms', () => {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform(matrix) {
        calls.push(['setTransform', matrix])
      },
      save() {},
      restore() {},
      clipRect(rect, mode) {
        calls.push(['clipRect', rect, mode])
      }
    }
    const view = new DataView(new ArrayBuffer(56))
    view.setFloat32(0, 5, true)
    view.setFloat32(4, 6, true)
    view.setFloat32(8, 70, true)
    view.setFloat32(12, 80, true)
    view.setFloat32(16, 5, true)
    view.setFloat32(20, 7, true)
    view.setFloat32(24, 2, true)
    view.setFloat32(28, 3, true)
    view.setFloat32(32, 2, true)
    view.setFloat32(36, 3, true)
    view.setFloat32(40, 180, true)

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
    calls.length = 0

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.SetClipRect,
        flags: 0x0200,
        dataOffset: 0,
        dataSize: 16
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_OFFSET_CLIP,
        flags: 0,
        dataOffset: 16,
        dataSize: 8
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_TRANSLATE_WORLD_TRANSFORM,
        flags: 0,
        dataOffset: 24,
        dataSize: 8
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_SCALE_WORLD_TRANSFORM,
        flags: 0,
        dataOffset: 32,
        dataSize: 8
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.ResetWorldTransform,
        flags: 0,
        dataOffset: 0,
        dataSize: 0
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_ROTATE_WORLD_TRANSFORM,
        flags: 0,
        dataOffset: 40,
        dataSize: 4
      })
    ]

    expect(handled).toEqual([true, true, true, true, true, true])
    expect(calls[0]).toEqual(['clipRect', { x: 5, y: 6, width: 70, height: 80 }, 'intersect'])
    expect(calls[1]).toEqual(['clipRect', { x: 10, y: 13, width: 70, height: 80 }, 'replace'])
    expect(calls[2]).toEqual(['setTransform', [1, 0, 0, 1, 2, 3]])
    // Scale(2,3) with the default Prepend order applies the scale to points
    // BEFORE the existing translate(2,3), so the translate is not scaled ->
    // [2,0,0,3,2,3]. (The buggy append-as-prepend produced [2,0,0,3,4,9].)
    expect(calls[3]).toEqual(['setTransform', [2, 0, 0, 3, 2, 3]])
    expect(calls[4]).toEqual(['setTransform', [1, 0, 0, 1, 0, 0]])
    expect(calls[5][0]).toBe('setTransform')
    expect(calls[5][1][0]).toBeCloseTo(-1)
    expect(calls[5][1][1]).toBeCloseTo(0)
    expect(calls[5][1][2]).toBeCloseTo(0)
    expect(calls[5][1][3]).toBeCloseTo(-1)
    expect(calls[5][1][4]).toBeCloseTo(0)
    expect(calls[5][1][5]).toBeCloseTo(0)
  })

  test('routes generic EMF+ drawing records through shared rectangle, path, ellipse, pie, and image playback', () => {
    const calls = []
    const backend = {
      resize() {},
      clear(fill) {
        calls.push(['clear', fill])
      },
      setTransform() {},
      save() {},
      restore() {},
      strokeRect(rect, pen) {
        calls.push(['strokeRect', rect, pen])
      },
      fillPath(path, brush, options) {
        calls.push(['fillPath', path, brush, options])
      },
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      },
      fillEllipse(rect, brush) {
        calls.push(['fillEllipse', rect, brush])
      },
      strokeEllipse(rect, pen) {
        calls.push(['strokeEllipse', rect, pen])
      },
      drawImageRect(image, destinationRect, sourceRect) {
        calls.push(['drawImageRect', image, destinationRect, sourceRect])
      }
    }
    const view = new DataView(new ArrayBuffer(256))
    view.setUint32(0, 0xff112233, true)

    view.setUint32(4, 1, true)
    view.setInt16(8, 1, true)
    view.setInt16(10, 2, true)
    view.setInt16(12, 30, true)
    view.setInt16(14, 40, true)

    view.setUint32(16, 3, true)
    new Uint8Array(view.buffer).set([10, 10, 10, 0, 0, 20], 20)

    view.setUint32(28, 4, true)
    view.setInt16(32, 0, true)
    view.setInt16(34, 0, true)
    view.setInt16(36, 10, true)
    view.setInt16(38, 0, true)
    view.setInt16(40, 10, true)
    view.setInt16(42, 20, true)
    view.setInt16(44, 20, true)
    view.setInt16(46, 20, true)

    view.setInt16(48, 3, true)
    view.setInt16(50, 4, true)
    view.setInt16(52, 5, true)
    view.setInt16(54, 6, true)

    view.setInt16(56, 30, true)
    view.setInt16(58, 40, true)
    view.setInt16(60, 10, true)
    view.setInt16(62, 20, true)

    view.setFloat32(64, 0, true)
    view.setFloat32(68, 90, true)
    view.setFloat32(72, 50, true)
    view.setFloat32(76, 60, true)
    view.setFloat32(80, 20, true)
    view.setFloat32(84, 10, true)

    view.setFloat32(88, 180, true)
    view.setFloat32(92, 90, true)
    view.setFloat32(96, 60, true)
    view.setFloat32(100, 70, true)
    view.setFloat32(104, 20, true)
    view.setFloat32(108, 10, true)

    view.setFloat32(112, 270, true)
    view.setFloat32(116, -90, true)
    view.setFloat32(120, 70, true)
    view.setFloat32(124, 80, true)
    view.setFloat32(128, 20, true)
    view.setFloat32(132, 10, true)

    view.setInt32(136, 0, true)
    view.setInt32(140, 2, true)
    view.setFloat32(144, 1, true)
    view.setFloat32(148, 2, true)
    view.setFloat32(152, 30, true)
    view.setFloat32(156, 40, true)
    view.setInt16(160, 100, true)
    view.setInt16(162, 110, true)
    view.setInt16(164, 60, true)
    view.setInt16(166, 80, true)

    // Fill records carry the BrushId as the first data field (not in the flags),
    // followed by their geometry. Lay them out past the draw records above.
    view.setUint32(168, 4, true)
    view.setUint32(172, 3, true)
    view.setFloat32(176, 10, true)
    view.setFloat32(180, 10, true)
    view.setFloat32(184, 20, true)
    view.setFloat32(188, 10, true)
    view.setFloat32(192, 20, true)
    view.setFloat32(196, 30, true)

    view.setUint32(200, 4, true)
    view.setInt16(204, 3, true)
    view.setInt16(206, 4, true)
    view.setInt16(208, 5, true)
    view.setInt16(210, 6, true)

    view.setUint32(212, 4, true)
    view.setFloat32(216, 270, true)
    view.setFloat32(220, -90, true)
    view.setFloat32(224, 70, true)
    view.setFloat32(228, 80, true)
    view.setFloat32(232, 20, true)
    view.setFloat32(236, 10, true)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 200, bottom: 160 },
        deviceWidth: 200,
        deviceHeight: 160
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)
    calls.length = 0
    runtime.objects.set(2, {
      kind: 'pen',
      width: 2,
      color: 'rgba(200, 100, 50, 1)'
    })
    runtime.objects.set(3, {
      kind: 'image',
      format: 'bitmap',
      width: 30,
      height: 40,
      canvas: { width: 30, height: 40 }
    })
    runtime.objects.set(4, {
      kind: 'brush',
      type: 'solid',
      color: 'rgba(20, 40, 60, 1)'
    })
    runtime.ensureImageSurface = (image) => image

    const handled = [
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_CLEAR,
        flags: 0,
        dataOffset: 0,
        dataSize: 4
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_RECTS,
        flags: 0x4000 | 2,
        dataOffset: 4,
        dataSize: 12
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_FILL_POLYGON,
        flags: 0,
        dataOffset: 168,
        dataSize: 32
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_BEZIERS,
        flags: 0x4000 | 2,
        dataOffset: 28,
        dataSize: 20
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_FILL_ELLIPSE,
        flags: 0x4000,
        dataOffset: 200,
        dataSize: 12
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_ELLIPSE,
        flags: 0x4000 | 2,
        dataOffset: 56,
        dataSize: 8
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_ARC,
        flags: 2,
        dataOffset: 64,
        dataSize: 24
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_PIE,
        flags: 2,
        dataOffset: 88,
        dataSize: 24
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_FILL_PIE,
        flags: 0,
        dataOffset: 212,
        dataSize: 28
      }),
      dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EMFPLUS_DRAW_IMAGE,
        flags: 0x4000 | 3,
        dataOffset: 136,
        dataSize: 32
      })
    ]

    expect(handled).toEqual([true, true, true, true, true, true, true, true, true, true])
    expect(calls[0]).toEqual(['clear', { color: 'rgba(17, 34, 51, 1)' }])
    expect(calls[1]).toEqual([
      'strokeRect',
      { left: 1, top: 2, right: 31, bottom: 42 },
      runtime.objects.get(2)
    ])
    expect(calls[2][0]).toBe('fillPath')
    expect(calls[2][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 30 }
          ]
        }
      ]
    })
    expect(calls[2][2]).toBe(runtime.objects.get(4))
    expect(calls[2][3]).toEqual({ fillMode: 'alternate' })
    expect(calls[3][0]).toBe('strokePath')
    expect(calls[3][1].figures[0].segments).toEqual([
      {
        type: 'bezier',
        control1: { x: 10, y: 0 },
        control2: { x: 10, y: 20 },
        point: { x: 20, y: 20 }
      }
    ])
    expect(calls[4]).toEqual([
      'fillEllipse',
      { left: 3, top: 4, right: 8, bottom: 10 },
      runtime.objects.get(4)
    ])
    expect(calls[5]).toEqual([
      'strokeEllipse',
      { left: 30, top: 40, right: 40, bottom: 60 },
      runtime.objects.get(2)
    ])
    expect(calls[6][0]).toBe('strokePath')
    expect(calls[6][1].figures[0].segments.at(-1)?.type).toBe('arc')
    expect(calls[6][2]).toBe(runtime.objects.get(2))
    expect(calls[7][0]).toBe('strokePath')
    expect(calls[7][1].figures[0].closed).toBe(true)
    expect(calls[7][1].figures[0].segments.at(-1)?.type).toBe('arc')
    expect(calls[8][0]).toBe('fillPath')
    expect(calls[8][1].figures[0].closed).toBe(true)
    expect(calls[8][1].figures[0].segments.at(-1)?.type).toBe('arc')
    expect(calls[8][2]).toBe(runtime.objects.get(4))
    expect(calls[9]).toEqual([
      'drawImageRect',
      runtime.objects.get(3),
      { x: 100, y: 110, width: 60, height: 80 },
      { x: 1.5, y: 2.5, width: 30, height: 40 }
    ])
  })
})

describe('dispatchRecord EMF+ fill records', () => {
  // EMF+ fill records carry the BrushId as their first 4-byte data field
  // (an ARGB color when the inline-color flag 0x8000 is set, otherwise an
  // object index), with the geometry following it. The brush index is NOT in
  // the record flags the way pen-based draw records encode their ObjectId.
  function createFillFixture(view, backendMethods) {
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      setTransform() {},
      save() {},
      restore() {}
    }

    for (const name of backendMethods) {
      backend[name] = (...args) => {
        calls.push([name, ...args])
      }
    }

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        deviceWidth: 100,
        deviceHeight: 100
      },
      view,
      records: []
    }
    const runtime = createPlaybackRuntime(parsed, backend)

    return { parsed, runtime, backend, calls }
  }

  test('FillRects resolves a by-index brush from the BrushId data field', () => {
    const view = new DataView(new ArrayBuffer(24))
    view.setUint32(0, 7, true)
    view.setUint32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 3, true)
    view.setFloat32(16, 10, true)
    view.setFloat32(20, 20, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillRect'])
    const brush = { kind: 'brush', type: 'solid', color: 'rgba(1, 2, 3, 1)' }
    runtime.objects.set(7, brush)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_RECTS,
      flags: 0,
      dataOffset: 0,
      dataSize: 24
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([['fillRect', { left: 2, top: 3, right: 12, bottom: 23 }, brush]])
  })

  test('FillRects resolves an inline ARGB brush color', () => {
    const view = new DataView(new ArrayBuffer(24))
    view.setUint32(0, 0xff204060, true)
    view.setUint32(4, 1, true)
    view.setFloat32(8, 2, true)
    view.setFloat32(12, 3, true)
    view.setFloat32(16, 10, true)
    view.setFloat32(20, 20, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillRect'])

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_RECTS,
      flags: 0x8000,
      dataOffset: 0,
      dataSize: 24
    })

    expect(handled).toBe(true)
    expect(calls[0][0]).toBe('fillRect')
    expect(calls[0][1]).toEqual({ left: 2, top: 3, right: 12, bottom: 23 })
    expect(calls[0][2]).toEqual({ kind: 'brush', type: 'solid', color: 'rgba(32, 64, 96, 1)' })
  })

  test('FillPolygon decodes an inline ARGB brush without misreading the color as the point count', () => {
    const view = new DataView(new ArrayBuffer(32))
    view.setUint32(0, 0xff808080, true)
    view.setUint32(4, 3, true)
    view.setFloat32(8, 0, true)
    view.setFloat32(12, 0, true)
    view.setFloat32(16, 10, true)
    view.setFloat32(20, 0, true)
    view.setFloat32(24, 10, true)
    view.setFloat32(28, 10, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillPath'])

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_POLYGON,
      flags: 0x8000,
      dataOffset: 0,
      dataSize: 32
    })

    expect(handled).toBe(true)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][1]).toEqual({
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
          ]
        }
      ]
    })
    expect(calls[0][2]).toEqual({ kind: 'brush', type: 'solid', color: 'rgba(128, 128, 128, 1)' })
    expect(calls[0][3]).toEqual({ fillMode: 'alternate' })
  })

  test('FillPolygon resolves a by-index brush from the BrushId data field', () => {
    const view = new DataView(new ArrayBuffer(32))
    view.setUint32(0, 8, true)
    view.setUint32(4, 3, true)
    view.setFloat32(8, 1, true)
    view.setFloat32(12, 1, true)
    view.setFloat32(16, 5, true)
    view.setFloat32(20, 1, true)
    view.setFloat32(24, 5, true)
    view.setFloat32(28, 5, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillPath'])
    const brush = { kind: 'brush', type: 'solid', color: 'rgba(9, 9, 9, 1)' }
    runtime.objects.set(8, brush)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_POLYGON,
      flags: 0,
      dataOffset: 0,
      dataSize: 32
    })

    expect(handled).toBe(true)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][1].figures[0].points).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 }
    ])
    expect(calls[0][2]).toBe(brush)
  })

  test('FillEllipse reads the rect after the BrushId data field', () => {
    const view = new DataView(new ArrayBuffer(20))
    view.setUint32(0, 9, true)
    view.setFloat32(4, 5, true)
    view.setFloat32(8, 6, true)
    view.setFloat32(12, 7, true)
    view.setFloat32(16, 8, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillEllipse'])
    const brush = { kind: 'brush', type: 'solid', color: 'rgba(4, 5, 6, 1)' }
    runtime.objects.set(9, brush)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_ELLIPSE,
      flags: 0,
      dataOffset: 0,
      dataSize: 20
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([['fillEllipse', { left: 5, top: 6, right: 12, bottom: 14 }, brush]])
  })

  test('FillPie reads the angles and rect after the BrushId data field', () => {
    const view = new DataView(new ArrayBuffer(28))
    view.setUint32(0, 10, true)
    view.setFloat32(4, 0, true)
    view.setFloat32(8, 90, true)
    view.setFloat32(12, 5, true)
    view.setFloat32(16, 6, true)
    view.setFloat32(20, 20, true)
    view.setFloat32(24, 20, true)

    const { parsed, runtime, backend, calls } = createFillFixture(view, ['fillPath'])
    const brush = { kind: 'brush', type: 'solid', color: 'rgba(7, 8, 9, 1)' }
    runtime.objects.set(10, brush)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EMFPLUS_FILL_PIE,
      flags: 0,
      dataOffset: 0,
      dataSize: 28
    })

    expect(handled).toBe(true)
    expect(calls[0][0]).toBe('fillPath')
    expect(calls[0][1].figures[0].closed).toBe(true)
    expect(calls[0][1].figures[0].segments.at(-1)?.type).toBe('arc')
    expect(calls[0][2]).toBe(brush)
  })
})

describe('dispatchRecord EMF+ continued objects', () => {
  test('assembles a multi-record continued image object before decoding', () => {
    // A 40-byte EmfPlusImage(metafile): 16-byte header + 24 bytes of EMF payload.
    const objectData = new Uint8Array(40)
    const odv = new DataView(objectData.buffer)
    odv.setUint32(0, 1, true) // Version
    odv.setUint32(4, 2, true) // Type = metafile
    odv.setUint32(8, 1, true) // MetafileType = emf
    odv.setUint32(12, 24, true) // MetafileDataSize
    odv.setUint32(16, 0x00000001, true) // payload (not the WMF magic -> 'emf')
    for (let i = 20; i < 40; i += 1) {
      objectData[i] = i
    }

    // Two continued Object records, each laid out as [TotalObjectSize][20-byte chunk].
    const view = new DataView(new ArrayBuffer(48))
    const bytes = new Uint8Array(view.buffer)
    view.setUint32(0, 40, true)
    bytes.set(objectData.subarray(0, 20), 4)
    view.setUint32(24, 40, true)
    bytes.set(objectData.subarray(20, 40), 28)

    const parsed = {
      header: {
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        deviceWidth: 100,
        deviceHeight: 100
      },
      view,
      records: []
    }
    const backend = { resize() {}, clear() {}, setTransform() {}, save() {}, restore() {} }
    const runtime = createPlaybackRuntime(parsed, backend)
    // continuation flag (0x8000) | ObjectType Image (5 << 8) | ObjectId 3
    const flags = 0x8000 | (5 << 8) | 3

    const first = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags,
      dataOffset: 0,
      dataSize: 24
    })

    expect(first).toBe(true)
    expect(runtime.objects.get(3)).toBeUndefined()

    const second = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.Object,
      flags,
      dataOffset: 24,
      dataSize: 24
    })

    expect(second).toBe(true)
    const object = runtime.objects.get(3)
    expect(object).toMatchObject({ kind: 'image', format: 'emf' })
    expect(object.buffer.byteLength).toBe(24)
  })
})

describe('EMF+ dispatch return contract', () => {
  function makeParsed(view, bounds = { left: 0, top: 0, right: 40, bottom: 30 }) {
    return {
      header: { bounds, deviceWidth: bounds.right, deviceHeight: bounds.bottom },
      view,
      records: []
    }
  }

  function lastWarningDiagnostics(runtime) {
    return runtime.diagnostics.filter((entry) => entry.level === 'warning')
  }

  test('object-unresolved: FillPath with a missing path degrades (handled, diagnostic, fallback armed)', () => {
    const calls = []
    const backend = {
      resize() {}, clear() {}, setTransform() {}, save() {}, restore() {},
      fillPath(...args) { calls.push(['fillPath', ...args]) }
    }
    const view = new DataView(new ArrayBuffer(8))
    view.setUint32(0, 0xff112233, true) // inline brush color (flags carry INLINE_COLOR)
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.FillPath,
      flags: 0x8000 | 5, // INLINE_COLOR + object id 5 (path 5 never created)
      dataOffset: 0,
      dataSize: 4
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([])
    expect(runtime.unsupported).toEqual([])
    expect(lastWarningDiagnostics(runtime)).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'emfplus-object-unresolved' })
    )
    // The prior `return false` armed the block's classic fallback; preserve it.
    expect(runtime.currentEmfPlusBlockNeedsFallback).toBe(true)
  })

  test('degenerate-geometry: DrawLines with a single point degrades without drawing', () => {
    const calls = []
    const backend = {
      resize() {}, clear() {}, setTransform() {}, save() {}, restore() {},
      strokePath(...args) { calls.push(['strokePath', ...args]) }
    }
    const view = new DataView(new ArrayBuffer(12))
    view.setUint32(0, 1, true) // count = 1 (degenerate: needs >= 2)
    view.setFloat32(4, 10, true)
    view.setFloat32(8, 20, true)
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(2, { kind: 'pen', width: 1, color: 'rgba(0, 0, 0, 1)' })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.DrawLines,
      flags: 2, // pen object id 2
      dataOffset: 0,
      dataSize: 12
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([])
    expect(runtime.unsupported).toEqual([])
    expect(lastWarningDiagnostics(runtime)).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'degenerate-geometry' })
    )
  })

  test('record-decode-failed: SetTSGraphics shorter than its fixed payload degrades', () => {
    const backend = { resize() {}, clear() {}, setTransform() {}, save() {}, restore() {} }
    const view = new DataView(new ArrayBuffer(8))
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetTSGraphics,
      flags: 0,
      dataOffset: 0,
      dataSize: 8 // < 36 required bytes
    })

    expect(handled).toBe(true)
    expect(runtime.unsupported).toEqual([])
    expect(lastWarningDiagnostics(runtime)).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'record-decode-failed' })
    )
  })

  test('capability-unavailable: FillPath on a backend without fillPath degrades instead of throwing', () => {
    const backend = { resize() {}, clear() {}, setTransform() {}, save() {}, restore() {} } // no fillPath
    const view = new DataView(new ArrayBuffer(8))
    view.setUint32(0, 0xff112233, true) // inline brush color
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(5, { kind: 'path', figures: [{ closed: true, points: [{ x: 0, y: 0 }] }] })

    let handled
    expect(() => {
      handled = dispatchRecord(parsed, runtime, backend, {
        source: 'emfplus',
        type: EmfPlusRecordType.FillPath,
        flags: 0x8000 | 5,
        dataOffset: 0,
        dataSize: 4
      })
    }).not.toThrow()

    expect(handled).toBe(true)
    expect(runtime.unsupported).toEqual([])
    expect(lastWarningDiagnostics(runtime)).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'capability-unavailable', capability: 'fillPath' })
    )
  })

  test('clip object-unresolved: SetClipPath with a missing path degrades, not unsupported', () => {
    const calls = []
    const backend = {
      resize() {}, clear() {}, setTransform() {}, save() {}, restore() {},
      setClip(clip) { calls.push(['setClip', clip]) }
    }
    const view = new DataView(new ArrayBuffer(8))
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.SetClipPath,
      flags: 0x0107, // mode replace + object id 7 (path 7 never created)
      dataOffset: 0,
      dataSize: 0
    })

    expect(handled).toBe(true)
    expect(calls).toEqual([])
    expect(runtime.unsupported).toEqual([])
    expect(lastWarningDiagnostics(runtime)).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'emfplus-object-unresolved' })
    )
    expect(runtime.currentEmfPlusBlockNeedsFallback).toBe(true)
  })

  test('successful draws stay clean: no downgrade diagnostics and not unsupported', () => {
    const calls = []
    const backend = {
      resize() {}, clear() {}, setTransform() {}, save() {}, restore() {},
      fillPath(...args) { calls.push(['fillPath', ...args]) }
    }
    const view = new DataView(new ArrayBuffer(8))
    view.setUint32(0, 0xff112233, true)
    const parsed = makeParsed(view)
    const runtime = createPlaybackRuntime(parsed, backend)
    runtime.objects.set(5, { kind: 'path', figures: [{ closed: true, points: [{ x: 0, y: 0 }] }] })

    const handled = dispatchRecord(parsed, runtime, backend, {
      source: 'emfplus',
      type: EmfPlusRecordType.FillPath,
      flags: 0x8000 | 5,
      dataOffset: 0,
      dataSize: 4
    })

    expect(handled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(runtime.unsupported).toEqual([])
    expect(runtime.diagnostics).toEqual([])
    expect(runtime.currentEmfPlusBlockNeedsFallback).toBe(false)
  })
})
