import { describe, expect, test } from 'vitest'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { decodeEmfPlusObject } from '../../src/emfplus/object-decoders/index.js'
import { parseWmf } from '../../src/wmf/parse-wmf.js'
import { playParsedWmf } from '../../src/wmf/playback.js'
import { META_RESTOREDC, META_SAVEDC, META_SETWINDOWORG } from '../../src/wmf/constants.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

function extractNestedWmfBuffer(name = 'original/image5.emf') {
  const parsed = parseEmf(readFixtureArrayBuffer(name))

  for (const record of parsed.records) {
    if (!record.emfPlusRecords) {
      continue
    }

    for (const subrecord of record.emfPlusRecords) {
      if (subrecord.type === EmfPlusRecordType.Object && ((subrecord.flags >> 8) & 0x7f) === 5) {
        const object = decodeEmfPlusObject(subrecord, parsed)

        if (object?.format === 'wmf') {
          return object.buffer
        }
      }
    }
  }

  throw new Error(`WMF image object not found in ${name}`)
}

describe('parseWmf', () => {
  fixtureTest('original/image5.emf')('parses the nested placeable WMF payload embedded in image5.emf', () => {
    const parsed = parseWmf(extractNestedWmfBuffer())
    const recordTypes = new Set(parsed.records.map((record) => record.type))

    expect(parsed.header.bounds).toEqual({
      left: 158,
      top: 128,
      right: 323,
      bottom: 225
    })
    expect(parsed.header.inch).toBe(72)

    for (const type of [0x020b, 0x020c, 0x02fc, 0x02fa, 0x0324, 0x0418, 0x0416, 0x0214, 0x0213]) {
      expect(recordTypes.has(type)).toBe(true)
    }
  })

  test('reads record params as signed 16-bit values', () => {
    const view = new DataView(new ArrayBuffer(32))
    view.setUint16(0, 1, true) // memory metafile
    view.setUint16(2, 9, true) // header size in words
    view.setUint16(4, 0x0300, true) // version
    view.setUint32(6, 16, true) // file size in words
    view.setUint16(10, 0, true) // object count
    view.setUint32(12, 4, true) // max record size in words
    view.setUint16(16, 0, true) // parameter count
    view.setUint32(18, 4, true) // META_RESTOREDC size in words
    view.setUint16(22, META_RESTOREDC, true)
    view.setUint16(24, 0xfffe, true) // nSavedDC -2 as raw unsigned bytes
    view.setUint32(26, 3, true) // META_EOF size in words
    view.setUint16(30, 0, true)

    const parsed = parseWmf(view.buffer)

    expect(parsed.records[0]).toMatchObject({ type: META_RESTOREDC, params: [-2] })
  })
})

describe('playParsedWmf', () => {
  fixtureTest('original/image5.emf')('decodes WMF pen colors and styles from META_CREATEPENINDIRECT records', () => {
    const parsed = parseWmf(extractNestedWmfBuffer())
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillEllipse() {},
      strokeEllipse(rect, pen) {
        calls.push(['strokeEllipse', rect, pen])
      },
      fillPath() {},
      strokePath() {},
      drawLine() {},
      clipRect() {}
    }

    playParsedWmf(parsed, backend)

    expect(calls[0]).toEqual([
      'strokeEllipse',
      { left: 158, top: 168, right: 323, bottom: 225 },
      {
        kind: 'pen',
        style: 6,
        width: 1,
        color: 'rgb(170, 230, 255)'
      }
    ])
  })

  fixtureTest('original/image5.emf')('converts WMF polygons into shared path geometry for backend playback', () => {
    const parsed = parseWmf(extractNestedWmfBuffer())
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      fillEllipse() {},
      strokeEllipse() {},
      fillPath(path, brush) {
        calls.push(['fillPath', path, brush])
      },
      strokePath() {},
      drawLine() {},
      clipRect() {}
    }

    playParsedWmf(parsed, backend)

    expect(calls[0]).toEqual([
      'fillPath',
      {
        kind: 'path',
        figures: [
          {
            closed: true,
            points: [
              { x: 158, y: 157 },
              { x: 158, y: 197 },
              { x: 322, y: 197 },
              { x: 322, y: 157 },
              { x: 158, y: 157 }
            ]
          }
        ]
      },
      {
        kind: 'brush',
        style: 0,
        color: 'rgb(0, 120, 170)'
      }
    ])
  })

  // Shared harness for the META_RESTOREDC stack-depth tests below (twin of the
  // EMR_RESTOREDC suite in tests/runtime/playback-emf.test.js, minus the EMF+
  // interleaving cases — the WMF stack has no EMF+ frames): synthetic records
  // change the window origin between SaveDC frames, and the backend tracks its
  // save/restore depth plus every transform it receives.
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
    const setWindowOrg = (x, y) => ({ type: META_SETWINDOWORG, params: [y, x], dataSize: 4 })
    const saveDc = () => ({ type: META_SAVEDC, params: [], dataSize: 0 })
    const restoreDc = (savedDc) => ({ type: META_RESTOREDC, params: [savedDc], dataSize: 2 })
    const play = (records) =>
      playParsedWmf(
        {
          header: {
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
            objectCount: 0
          },
          records
        },
        backend
      )

    return { state, play, setWindowOrg, saveDc, restoreDc }
  }

  test('unwinds every frame covered by a relative RestoreDC(-2)', () => {
    const { state, play, setWindowOrg, saveDc, restoreDc } = createSaveRestoreHarness()

    const runtime = play([
      setWindowOrg(10, 20),
      saveDc(),
      setWindowOrg(30, 40),
      saveDc(),
      setWindowOrg(50, 60),
      restoreDc(-2)
    ])

    expect(runtime.windowOrigin).toEqual({ x: 10, y: 20 })
    expect(runtime.frames).toEqual([])
    expect(state.backendDepth).toBe(0)
    expect(state.transforms.at(-1)).toEqual([1, 0, 0, 1, -10, -20])
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('restores a mid-stack DC by absolute level and keeps the frames below it', () => {
    const { state, play, setWindowOrg, saveDc, restoreDc } = createSaveRestoreHarness()

    const runtime = play([
      setWindowOrg(10, 20),
      saveDc(),
      setWindowOrg(30, 40),
      saveDc(),
      setWindowOrg(50, 60),
      saveDc(),
      setWindowOrg(70, 80),
      restoreDc(2)
    ])

    expect(runtime.windowOrigin).toEqual({ x: 30, y: 40 })
    expect(runtime.frames).toHaveLength(1)
    expect(state.backendDepth).toBe(1)
    expect(state.transforms.at(-1)).toEqual([1, 0, 0, 1, -30, -40])
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test('reuses freed SaveDC levels so absolute restores target the newest frame', () => {
    const { state, play, setWindowOrg, saveDc, restoreDc } = createSaveRestoreHarness()

    const runtime = play([
      setWindowOrg(10, 20),
      saveDc(),
      setWindowOrg(30, 40),
      saveDc(),
      restoreDc(-1),
      setWindowOrg(50, 60),
      saveDc(),
      setWindowOrg(70, 80),
      restoreDc(2)
    ])

    expect(runtime.windowOrigin).toEqual({ x: 50, y: 60 })
    expect(runtime.frames).toHaveLength(1)
    expect(state.backendDepth).toBe(1)
    expect(state.transforms.at(-1)).toEqual([1, 0, 0, 1, -50, -60])
    expect(runtime.warnings).toEqual([])
    expect(runtime.unsupported).toEqual([])
  })

  test.each([
    ['zero', 0],
    ['a relative depth beyond the stack', -3],
    ['an unmatched absolute level', 7]
  ])('leaves the DC unchanged and warns when RestoreDC targets %s', (_label, savedDc) => {
    const { state, play, setWindowOrg, saveDc, restoreDc } = createSaveRestoreHarness()

    const runtime = play([
      setWindowOrg(10, 20),
      saveDc(),
      setWindowOrg(30, 40),
      saveDc(),
      setWindowOrg(50, 60),
      restoreDc(savedDc)
    ])

    expect(runtime.windowOrigin).toEqual({ x: 50, y: 60 })
    expect(runtime.frames).toHaveLength(2)
    expect(state.backendDepth).toBe(2)
    expect(runtime.warnings).toEqual([
      `RestoreDC ${savedDc} has no matching SaveDC frame (stack depth 2); DC state left unchanged`
    ])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'restore-dc-unmatched', recordType: META_RESTOREDC })
    )
    expect(runtime.unsupported).toEqual([])
  })

  test('degrades a truncated RestoreDC record to a warning without touching the stack', () => {
    const { state, play, setWindowOrg, saveDc } = createSaveRestoreHarness()

    const runtime = play([
      setWindowOrg(10, 20),
      saveDc(),
      { type: META_RESTOREDC, params: [], dataSize: 0 }
    ])

    expect(runtime.windowOrigin).toEqual({ x: 10, y: 20 })
    expect(runtime.frames).toHaveLength(1)
    expect(state.backendDepth).toBe(1)
    expect(runtime.warnings).toEqual(['RestoreDC record is truncated (dataSize=0); DC state left unchanged'])
    expect(runtime.diagnostics).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'record-decode-failed', recordType: META_RESTOREDC })
    )
    expect(runtime.unsupported).toEqual([])
  })
})
