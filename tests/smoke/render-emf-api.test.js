import fs from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  collectFixtureSampleNames,
  fixtureSampleExists,
  hasLocalSampleDir,
  isParseGapSample,
  isRenderableSample,
  isRenderGapSample,
  readFixtureArrayBuffer,
  samplesRoot
} from '../helpers/read-fixture.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))
import { parseEmf } from '../../src/emf/parse-emf.js'
import { renderEmf } from '../../src/index.js'

const allSamples = collectFixtureSampleNames()
const samples = allSamples.filter(isRenderableSample)
const parseGapSamples = allSamples.filter(isParseGapSample)
const renderGapSamples = allSamples.filter(isRenderGapSample)
const EXPECTED_PARSE_ERRORS = new Map([
  ['real/parse-gap/real-apache-poi-slideshow-crash-7b60e9fe.emf', 'Invalid EMF record size 23552 at offset 152'],
  ['real/parse-gap/real-apache-poi-spreadsheet-61294.emf', 'Invalid EMF record size 4294902055 at offset 2384'],
  ['real/parse-gap/real-libemf2svg-corrupted-bad-corrupted-2014-12-02-215338.emf', 'Invalid EMF header size 59296 at offset 0'],
  ['real/parse-gap/real-libreoffice-tdf93750.emf', 'Invalid EMF+ trailing bytes']
])
const EXPECTED_RENDER_GAP_SAMPLES = [
  'real/render-gap/real-libemf2svg-fixture-test-libuemf-p-ref.emf',
  'real/render-gap/real-libreoffice-test-emfplus-draw-beziers.emf',
  'real/render-gap/real-libreoffice-test-emfplus-draw-curve.emf',
  'real/render-gap/real-libreoffice-test-emfplus-draw-image-points-with-metafile.emf',
  'real/render-gap/real-libreoffice-test-emfplus-get-dc.emf',
  'real/render-gap/real-libreoffice-test-emfplus-get-dc2.emf'
]
const EXPECTED_UNSUPPORTED = new Map([
  ['real/render/real-apache-poi-nested-wmf.emf', ['emf:0x5d']],
  ['real/render/real-aspose-imaging-update-sample.emf', ['emf:0x64']],
  // NOTE: draw-image-points-type-bitmap is intentionally absent: in a headless
  // host its EMF+ DrawImagePoints degrades to an image-surface-unavailable
  // diagnostic, which must NOT also be counted as an unsupported record.
  // NOTE: emfplus-save is intentionally absent: its unmatched EmfPlusRestore
  // degrades to a restore-dc-unmatched warning (GDI+ no-ops an unknown state
  // token), which must NOT be counted as an unsupported record.
  ['real/render/real-libreoffice-test-small-text-out.emf', ['emf:0x6c']],
  ['real/render/real-libreoffice-test-small-text-out-ansi.emf', ['emf:0x6c']],
  [
    'real/render/real-libemf2svg-fixture-test-libuemf-ref.emf',
    ['emf:0x6c', 'emf:0x5d', 'emf:0x48', 'emf:0x49']
  ],
  [
    'real/render/real-libemf2svg-fixture-test-libuemf-ref30.emf',
    ['emf:0x6c', 'emf:0x5d', 'emf:0x48', 'emf:0x49']
  ]
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectedErrorPattern(message) {
  return new RegExp(escapeRegExp(message ?? ''))
}

const LIFECYCLE_RECORDS = [
  // Classic EMF framing/lifecycle records.
  'emf:0x1', // EMR_HEADER
  'emf:0xe', // EMR_EOF
  'emf:0x46', // EMR_COMMENT (wraps EMF+ payloads)
  'emf:0x21', // EMR_SAVEDC
  'emf:0x22', // EMR_RESTOREDC
  // EMF+ framing/lifecycle records.
  'emfplus:0x4001', // EmfPlusHeader
  'emfplus:0x4002', // EmfPlusEndOfFile
  'emfplus:0x4004', // EmfPlusGetDC
  'emfplus:0x4025', // EmfPlusSave
  'emfplus:0x4026' // EmfPlusRestore
]

function createFakeContext(calls) {
  return {
    calls,
    save() {
      calls.push(['save'])
    },
    restore() {
      calls.push(['restore'])
    },
    setTransform(...args) {
      calls.push(['setTransform', ...args])
    },
    clearRect(...args) {
      calls.push(['clearRect', ...args])
    },
    fillRect(...args) {
      calls.push(['fillRect', ...args])
    },
    strokeRect(...args) {
      calls.push(['strokeRect', ...args])
    },
    beginPath() {
      calls.push(['beginPath'])
    },
    moveTo(...args) {
      calls.push(['moveTo', ...args])
    },
    lineTo(...args) {
      calls.push(['lineTo', ...args])
    },
    closePath() {
      calls.push(['closePath'])
    },
    fill(...args) {
      calls.push(['fill', ...args])
    },
    stroke(...args) {
      calls.push(['stroke', ...args])
    },
    ellipse(...args) {
      calls.push(['ellipse', ...args])
    },
    rect(...args) {
      calls.push(['rect', ...args])
    },
    clip(...args) {
      calls.push(['clip', ...args])
    },
    drawImage(...args) {
      calls.push(['drawImage', ...args])
    },
    fillText(...args) {
      calls.push(['fillText', ...args])
    },
    strokeText(...args) {
      calls.push(['strokeText', ...args])
    },
    createLinearGradient(...args) {
      calls.push(['createLinearGradient', ...args])
      return {
        addColorStop(offset, color) {
          calls.push(['addColorStop', offset, color])
        }
      }
    },
    createRadialGradient(...args) {
      calls.push(['createRadialGradient', ...args])
      return {
        addColorStop(offset, color) {
          calls.push(['addColorStop', offset, color])
        }
      }
    },
    createPattern(...args) {
      calls.push(['createPattern', ...args])
      return {
        setTransform(transform) {
          calls.push(['patternSetTransform', transform])
        }
      }
    },
    measureText(text) {
      calls.push(['measureText', text])
      return { width: text.length * 10 }
    },
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }
    },
    putImageData(...args) {
      calls.push(['putImageData', ...args])
    }
  }
}

class FakeOffscreenCanvas {
  static instances = []

  constructor(width, height) {
    this.width = width
    this.height = height
    this.calls = []
    this.context = createFakeContext(this.calls)
    FakeOffscreenCanvas.instances.push(this)
  }

  getContext() {
    return this.context
  }

  toDataURL(type = 'image/png') {
    this.calls.push(['toDataURL', type])
    return 'data:image/png;base64,ZmFrZQ=='
  }
}

function installFakeOffscreenCanvas() {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas
  FakeOffscreenCanvas.instances = []
  globalThis.OffscreenCanvas = FakeOffscreenCanvas

  return () => {
    if (originalOffscreenCanvas) {
      globalThis.OffscreenCanvas = originalOffscreenCanvas
    } else {
      Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
    }
  }
}

describe('renderEmf', () => {
  test('keeps samples classified by directory instead of a manifest', () => {
    const rootSamples = fs
      .readdirSync(samplesRoot)
      .filter((name) => name.toLowerCase().endsWith('.emf'))

    expect(rootSamples).toEqual([])
    expect(fs.existsSync(new URL('samples.manifest.json', samplesRoot))).toBe(false)
    expect(allSamples.length).toBeGreaterThanOrEqual(hasLocalSampleDir('real') ? 80 : 24)
    expect(samples.length + parseGapSamples.length + renderGapSamples.length).toBe(allSamples.length)
    expect(parseGapSamples.sort()).toEqual([...EXPECTED_PARSE_ERRORS.keys()].filter(fixtureSampleExists).sort())
    // The real/ tree is local-only; clones without it discover no render-gap
    // samples, so compare against the locally present subset of the
    // expectation (a no-op filter when the fixtures are checked out).
    expect(renderGapSamples.sort()).toEqual(EXPECTED_RENDER_GAP_SAMPLES.filter(fixtureSampleExists).sort())
  })

  test('parses every sample except documented parser gaps', () => {
    for (const sample of allSamples.filter((entry) => !isParseGapSample(entry))) {
      expect(() => parseEmf(readFixtureArrayBuffer(sample)), sample).not.toThrow()
    }
  })

  for (const sample of parseGapSamples) {
    test(`documents parser gap for ${sample}`, () => {
      expect(() => parseEmf(readFixtureArrayBuffer(sample))).toThrow(expectedErrorPattern(EXPECTED_PARSE_ERRORS.get(sample)))
    })
  }

  test('exports a callable function', () => {
    expect(typeof renderEmf).toBe('function')
  })

  test('rejects non-ArrayBuffer and non-Uint8Array inputs with TypeError', async () => {
    await expect(renderEmf('not-a-buffer')).rejects.toThrow(TypeError)
  })

  for (const name of samples) {
    test(`returns the rendered png contract for a parsed ${name} buffer`, async () => {
      const buffer = readFixtureArrayBuffer(name)
      const parsed = parseEmf(buffer)
      const restore = installFakeOffscreenCanvas()
      const expectedWidth = parsed.header.bounds.right - parsed.header.bounds.left
      const expectedHeight = parsed.header.bounds.bottom - parsed.header.bounds.top
      const expectedTranslateX = parsed.header.bounds.left === 0 ? 0 : -parsed.header.bounds.left
      const expectedTranslateY = parsed.header.bounds.top === 0 ? 0 : -parsed.header.bounds.top

      try {
        const canvasOffset = FakeOffscreenCanvas.instances.length
        const result = await renderEmf(buffer)
        const target = FakeOffscreenCanvas.instances[canvasOffset] ?? null
        const dataUrl = await result.toDataUrl()

        expect(target).toBeInstanceOf(FakeOffscreenCanvas)
        expect(target.width).toBe(expectedWidth)
        expect(target.height).toBe(expectedHeight)
        expect(target.calls).toContainEqual(['setTransform', 1, 0, 0, 1, expectedTranslateX, expectedTranslateY])
        expect(result).toMatchObject({
          canvas: target,
          width: target.width,
          height: target.height,
          meta: {
            hasEmfPlus: parsed.hasEmfPlus,
            records: parsed.records.map((record) => record.type)
          }
        })
        expect(dataUrl).toMatch(/^data:image\/png;base64,/)
        expect(Array.isArray(result.meta.warnings)).toBe(true)
        expect(result.meta.warnings.every((warning) => typeof warning === 'string')).toBe(true)
        expect(Array.isArray(result.meta.unsupported)).toBe(true)
        expect(Array.isArray(result.meta.diagnostics)).toBe(true)
        expect(
          result.meta.diagnostics.every(
            (diagnostic) =>
              diagnostic &&
              typeof diagnostic.level === 'string' &&
              typeof diagnostic.code === 'string' &&
              typeof diagnostic.message === 'string'
          )
        ).toBe(true)
        const expectedUnsupported = EXPECTED_UNSUPPORTED.get(name) ?? []

        if (expectedUnsupported.length > 0) {
          expect(result.meta.unsupported).toEqual(expect.arrayContaining(expectedUnsupported))
          expect(result.meta.diagnostics).toEqual(
            expect.arrayContaining(
              expectedUnsupported.map((message) =>
                expect.objectContaining({
                  level: 'unsupported',
                  message
                })
              )
            )
          )
        }
      } finally {
        restore()
      }
    })
  }

  for (const sample of renderGapSamples) {
    test(`reports recoverable playback diagnostics for ${sample}`, async () => {
      const buffer = readFixtureArrayBuffer(sample)
      const restore = installFakeOffscreenCanvas()

      try {
        // render-gap fixtures are negative coverage: parsing must succeed and
        // playback must never hard-crash. They are not required to emit a
        // recoverable warning — as decode bugs get fixed, individual samples
        // render clean while staying in this set until promoted to the visual
        // suite. Whatever recoverable playback diagnostics they do emit must
        // stay fully located (source/recordType/recordOffset).
        expect(() => parseEmf(buffer)).not.toThrow()
        const result = await renderEmf(buffer)
        expect(Array.isArray(result.meta.diagnostics)).toBe(true)
        const playbackDiagnostics = result.meta.diagnostics.filter(
          (diagnostic) => diagnostic.capability === 'record-playback'
        )

        expect(
          playbackDiagnostics.every(
            (diagnostic) =>
              diagnostic.source !== undefined &&
              diagnostic.recordType !== undefined &&
              diagnostic.recordOffset !== undefined
          )
        ).toBe(true)
      } finally {
        restore()
      }
    })
  }

  fixtureTest('original/image1.emf')('creates an internal canvas target and exports a png data url when one is not provided', async () => {
    const buffer = readFixtureArrayBuffer('original/image1.emf')
    const parsed = parseEmf(buffer)
    const restore = installFakeOffscreenCanvas()

    try {
      const canvasOffset = FakeOffscreenCanvas.instances.length
      const result = await renderEmf(buffer)
      const expectedWidth = parsed.header.bounds.right - parsed.header.bounds.left
      const expectedHeight = parsed.header.bounds.bottom - parsed.header.bounds.top
      const target = FakeOffscreenCanvas.instances[canvasOffset] ?? null
      const dataUrl = await result.toDataUrl()

      expect(target).toBeInstanceOf(FakeOffscreenCanvas)
      expect(result.canvas).toBe(target)
      expect(dataUrl).toBe('data:image/png;base64,ZmFrZQ==')
      expect(result.width).toBe(expectedWidth)
      expect(result.height).toBe(expectedHeight)
      expect(target.width).toBe(expectedWidth)
      expect(target.height).toBe(expectedHeight)
    } finally {
      restore()
    }
  })

  fixtureTest('original/image1.emf')('applies explicit width and height overrides', async () => {
    const buffer = readFixtureArrayBuffer('original/image1.emf')
    const restore = installFakeOffscreenCanvas()

    try {
      const canvasOffset = FakeOffscreenCanvas.instances.length
      const result = await renderEmf(buffer, {
        width: 320,
        height: 200
      })
      const target = FakeOffscreenCanvas.instances[canvasOffset] ?? null

      expect(target.width).toBe(320)
      expect(target.height).toBe(200)
      expect(result.width).toBe(320)
      expect(result.height).toBe(200)
    } finally {
      restore()
    }
  })

  fixtureTest('original/image6.emf')('keeps raster-heavy samples off the unsupported list once image surfaces are enabled', async () => {
    const restore = installFakeOffscreenCanvas()

    try {
      for (const name of ['original/image6.emf', 'original/image9.emf', 'original/image11.emf']) {
        const canvasOffset = FakeOffscreenCanvas.instances.length
        const result = await renderEmf(readFixtureArrayBuffer(name))
        const target = FakeOffscreenCanvas.instances[canvasOffset] ?? null

        expect(result.meta.unsupported).not.toContain('emf:0x1')
        expect(result.meta.unsupported).not.toContain('emf:0xe')
        expect(result.meta.unsupported).not.toContain('emf:0x46')
        expect(result.meta.unsupported).not.toContain('emfplus:0x4001')
        expect(result.meta.unsupported).not.toContain('emfplus:0x4004')
        expect(result.meta.unsupported).not.toContain('emfplus:0x4002')
        expect(result.meta.unsupported).not.toContain('emf:0x15')
        expect(result.meta.unsupported).not.toContain('emf:0x4c')
        expect(result.meta.unsupported).not.toContain('emf:0x51')
        expect(target.calls.some((call) => call[0] === 'drawImage')).toBe(true)
      }
    } finally {
      restore()
    }
  })

  test('does not report lifecycle records as unsupported across the sample suite', async () => {
    const restore = installFakeOffscreenCanvas()
    try {
      for (const name of samples) {
        const result = await renderEmf(readFixtureArrayBuffer(name))
        const expectedUnsupported = EXPECTED_UNSUPPORTED.get(name) ?? []

        for (const record of LIFECYCLE_RECORDS) {
          if (expectedUnsupported.includes(record)) {
            continue
          }

          expect(result.meta.unsupported).not.toContain(record)
        }
      }
    } finally {
      restore()
    }
  }, 30000)
})
