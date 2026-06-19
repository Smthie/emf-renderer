import { describe, expect, test } from 'vitest'
import {
  EMR_ALPHABLEND,
  EMR_BITBLT,
  EMR_SETDIBITSTODEVICE,
  EMR_STRETCHBLT,
  EMR_STRETCHDIBITS,
  EMR_TRANSPARENTBLT
} from '../../src/emf/constants.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { decodeEmfPlusObject } from '../../src/emfplus/object-decoders/index.js'
import { ensureImageSurface, readClassicRasterOperation } from '../../src/runtime/image-surface.js'
import { prefetchCompressedImages } from '../../src/runtime/playback.js'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

const EMFPLUS_OBJECT_TYPE_IMAGE = 5
const EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED = 0x00030803
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB555 = 0x00021005
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB565 = 0x00021006
const EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555 = 0x00061007
const EMFPLUS_PIXEL_FORMAT_32BPP_RGB = 0x00022009
const EMFPLUS_PIXEL_FORMAT_32BPP_ARGB = 0x0026200a
const EMFPLUS_PIXEL_FORMAT_32BPP_PARGB = 0x000e200b
const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_JPEG = 4
const BI_PNG = 5

function createSurfaceContext() {
  return {
    lastImageData: null,
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    ellipse() {},
    rect() {},
    clip() {},
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }
    },
    putImageData(imageData) {
      this.lastImageData = imageData
    }
  }
}

function createSurface(width = 1, height = 1) {
  const context = createSurfaceContext()

  return {
    width,
    height,
    context,
    getContext(kind) {
      return kind === '2d' ? context : null
    }
  }
}

function writeStretchDibitsRecord() {
  const buffer = new ArrayBuffer(136)
  const view = new DataView(buffer)
  const recordOffset = 0
  const dataOffset = 8
  const bmiOffset = 80
  const bitsOffset = 128

  view.setInt32(dataOffset + 16, 10, true)
  view.setInt32(dataOffset + 20, 20, true)
  view.setInt32(dataOffset + 24, 0, true)
  view.setInt32(dataOffset + 28, 0, true)
  view.setInt32(dataOffset + 32, 2, true)
  view.setInt32(dataOffset + 36, 2, true)
  view.setUint32(dataOffset + 40, bmiOffset, true)
  view.setUint32(dataOffset + 44, 48, true)
  view.setUint32(dataOffset + 48, bitsOffset, true)
  view.setUint32(dataOffset + 52, 8, true)
  view.setUint32(dataOffset + 56, 0, true)
  view.setUint32(dataOffset + 60, 0x00cc0020, true)
  view.setInt32(dataOffset + 64, 2, true)
  view.setInt32(dataOffset + 68, 2, true)

  view.setUint32(recordOffset + bmiOffset, 40, true)
  view.setInt32(recordOffset + bmiOffset + 4, 2, true)
  view.setInt32(recordOffset + bmiOffset + 8, 2, true)
  view.setUint16(recordOffset + bmiOffset + 12, 1, true)
  view.setUint16(recordOffset + bmiOffset + 14, 1, true)
  view.setUint32(recordOffset + bmiOffset + 16, 0, true)
  view.setUint32(recordOffset + bmiOffset + 20, 0, true)
  view.setUint32(recordOffset + bmiOffset + 32, 0, true)
  view.setUint32(recordOffset + bmiOffset + 36, 0, true)

  view.setUint8(recordOffset + bmiOffset + 40, 0)
  view.setUint8(recordOffset + bmiOffset + 41, 0)
  view.setUint8(recordOffset + bmiOffset + 42, 0)
  view.setUint8(recordOffset + bmiOffset + 43, 0)
  view.setUint8(recordOffset + bmiOffset + 44, 255)
  view.setUint8(recordOffset + bmiOffset + 45, 255)
  view.setUint8(recordOffset + bmiOffset + 46, 255)
  view.setUint8(recordOffset + bmiOffset + 47, 0)

  view.setUint8(recordOffset + bitsOffset, 0b10000000)
  view.setUint8(recordOffset + bitsOffset + 4, 0b01000000)

  return {
    parsed: {
      view,
      header: {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        deviceWidth: 2,
        deviceHeight: 2
      },
      records: []
    },
    record: {
      type: EMR_STRETCHDIBITS,
      size: 136,
      offset: recordOffset,
      dataOffset,
      dataSize: 128
    }
  }
}

function writeStretchSourceRasterRecord(type) {
  const buffer = new ArrayBuffer(168)
  const view = new DataView(buffer)
  const recordOffset = 0
  const dataOffset = 8
  const bmiOffset = type === EMR_STRETCHBLT ? 112 : 120
  const bitsOffset = type === EMR_STRETCHBLT ? 152 : 160

  view.setInt32(dataOffset + 16, 10, true)
  view.setInt32(dataOffset + 20, 20, true)
  view.setInt32(dataOffset + 24, 1, true)
  view.setInt32(dataOffset + 28, 2, true)
  view.setInt32(dataOffset + 32, 3, true)
  view.setInt32(dataOffset + 36, 4, true)
  view.setInt32(dataOffset + 44, 30, true)
  view.setInt32(dataOffset + 48, 40, true)

  if (type === EMR_STRETCHBLT) {
    view.setUint32(dataOffset + 76, 0x00cc0020, true)
    view.setUint32(dataOffset + 80, 0, true)
    view.setUint32(dataOffset + 84, bmiOffset, true)
    view.setUint32(dataOffset + 88, 40, true)
    view.setUint32(dataOffset + 92, bitsOffset, true)
    view.setUint32(dataOffset + 96, 8, true)
  } else {
    view.setUint32(dataOffset + 64, (128 << 16), true)
    view.setUint32(dataOffset + 80, 0x00030201, true)
    view.setUint32(dataOffset + 88, 0, true)
    view.setUint32(dataOffset + 92, bmiOffset, true)
    view.setUint32(dataOffset + 96, 40, true)
    view.setUint32(dataOffset + 100, bitsOffset, true)
    view.setUint32(dataOffset + 104, 8, true)
  }

  view.setUint32(recordOffset + bmiOffset, 40, true)
  view.setInt32(recordOffset + bmiOffset + 4, 2, true)
  view.setInt32(recordOffset + bmiOffset + 8, 2, true)
  view.setUint16(recordOffset + bmiOffset + 12, 1, true)
  view.setUint16(recordOffset + bmiOffset + 14, 1, true)
  view.setUint32(recordOffset + bmiOffset + 16, 0, true)
  view.setUint32(recordOffset + bmiOffset + 32, 0, true)
  view.setUint8(recordOffset + bitsOffset, 0b10000000)
  view.setUint8(recordOffset + bitsOffset + 4, 0b01000000)

  return {
    parsed: {
      view,
      header: {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        deviceWidth: 2,
        deviceHeight: 2
      },
      records: []
    },
    record: {
      type,
      size: 168,
      offset: recordOffset,
      dataOffset,
      dataSize: 160
    }
  }
}

function writeAlphaBlendRecord({ sourceAlpha = false, sourceConstantAlpha = 128 } = {}) {
  const result = writeStretchSourceRasterRecord(EMR_ALPHABLEND)
  const { parsed, record } = result
  const blendFunctionValue = (sourceConstantAlpha << 16) | (sourceAlpha ? (1 << 24) : 0)

  parsed.view.setUint32(record.dataOffset + 64, blendFunctionValue, true)
  return result
}

function writeSetDibitsToDeviceRecord() {
  const { parsed, record } = writeStretchDibitsRecord()

  record.type = EMR_SETDIBITSTODEVICE
  parsed.view.setInt32(record.dataOffset + 16, 5, true)
  parsed.view.setInt32(record.dataOffset + 20, 6, true)
  parsed.view.setInt32(record.dataOffset + 24, 1, true)
  parsed.view.setInt32(record.dataOffset + 28, 1, true)
  parsed.view.setInt32(record.dataOffset + 32, 2, true)
  parsed.view.setInt32(record.dataOffset + 36, 2, true)
  parsed.view.setUint32(record.dataOffset + 60, 0, true)
  parsed.view.setUint32(record.dataOffset + 64, 2, true)
  parsed.view.setUint32(record.dataOffset + 68, 0, true)

  return { parsed, record }
}

function createWarnings() {
  const warnings = []

  return {
    warnings,
    addWarning(message) {
      warnings.push(message)
    }
  }
}

function renderBitmapPixels(image, options = {}) {
  const surface = createSurface()
  const { warnings, addWarning } = createWarnings()
  const rendered = ensureImageSurface(image, {
    addWarning,
    createSurface(width, height) {
      expect(width).toBe(image.width)
      expect(height).toBe(image.height)
      return surface
    },
    ...options
  })

  return {
    rendered,
    surface,
    warnings
  }
}

function createBitmapImage({ width, height, stride, pixelFormat, bytes, palette = null }) {
  return {
    kind: 'image',
    format: 'bitmap',
    width,
    height,
    stride,
    pixelFormat,
    bitmapDataType: 0,
    bytes: Uint8Array.from(bytes),
    palette
  }
}

function createDibImage({ width, height, bitCount, compression = BI_RGB, bmiBytes, bitsBytes, sourceAlpha = false }) {
  const bmi = bmiBytes ?? new Uint8Array(40)
  const view = new DataView(bmi.buffer, bmi.byteOffset, bmi.byteLength)

  view.setUint32(0, view.getUint32(0, true) || 40, true)
  view.setInt32(4, width, true)
  view.setInt32(8, height, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, bitCount, true)
  view.setUint32(16, compression, true)

  return {
    kind: 'image',
    format: 'dib',
    width: Math.abs(width),
    height: Math.abs(height),
    sourceAlpha,
    bmiBytes: bmi,
    bitsBytes: Uint8Array.from(bitsBytes)
  }
}

function createIndexedBmiBytes(colorEntries) {
  const bmiBytes = new Uint8Array(40 + colorEntries.length * 4)
  const view = new DataView(bmiBytes.buffer)

  view.setUint32(32, colorEntries.length, true)

  colorEntries.forEach(([red, green, blue, alpha = 255], index) => {
    const offset = 40 + index * 4
    bmiBytes[offset] = blue
    bmiBytes[offset + 1] = green
    bmiBytes[offset + 2] = red
    bmiBytes[offset + 3] = alpha
  })

  return bmiBytes
}

function createTestPalette() {
  return createIndexedBmiBytes([
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255]
  ])
}

function findFirstEmfPlusObjectRecord(parsed, objectType) {
  for (const record of parsed.records) {
    if (!record.emfPlusRecords) {
      continue
    }

    for (const subrecord of record.emfPlusRecords) {
      if (subrecord.type === 0x4008 && ((subrecord.flags >> 8) & 0x7f) === objectType) {
        return subrecord
      }
    }
  }

  throw new Error(`EMF+ object type ${objectType} not found`)
}

function createCompressedBitmapParsed(bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb])) {
  const buffer = new ArrayBuffer(28 + bytes.byteLength)
  const view = new DataView(buffer)

  view.setUint32(0, 0xdbc01002, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, 1, true)
  view.setUint32(12, 1, true)
  view.setInt32(16, bytes.byteLength, true)
  view.setUint32(20, 32 << 8, true)
  view.setUint32(24, 1, true)
  new Uint8Array(buffer, 28).set(bytes)

  const imageRecord = {
    type: EmfPlusRecordType.Object,
    flags: (EMFPLUS_OBJECT_TYPE_IMAGE << 8) | 1,
    dataOffset: 0,
    dataSize: buffer.byteLength
  }

  return {
    bytes,
    imageRecord,
    parsed: {
      view,
      header: {
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        deviceWidth: 1,
        deviceHeight: 1
      },
      records: [
        {
          emfPlusRecords: [imageRecord]
        }
      ]
    }
  }
}

function installBrowserCompressedBitmapDecodeStub({ reject = false } = {}) {
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalOffscreenCanvas = globalThis.OffscreenCanvas
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 128
  ])
  const createImageBitmapCalls = []
  const canvases = []

  class FakeDecodeCanvas {
    constructor(width, height) {
      this.width = width
      this.height = height
      this.drawnImage = null
      canvases.push(this)
    }

    getContext(kind) {
      if (kind !== '2d') {
        return null
      }

      return {
        clearRect() {},
        drawImage: (image) => {
          this.drawnImage = image
        },
        getImageData: (x, y, width, height) => ({
          x,
          y,
          width,
          height,
          data: pixels.slice(0, width * height * 4)
        })
      }
    }
  }

  globalThis.createImageBitmap = (blob) => {
    createImageBitmapCalls.push(blob)

    if (reject) {
      return Promise.reject(new Error('native decode failed'))
    }

    return Promise.resolve({
      width: 2,
      height: 1,
      closed: false,
      close() {
        this.closed = true
      }
    })
  }
  globalThis.OffscreenCanvas = FakeDecodeCanvas

  return {
    canvases,
    createImageBitmapCalls,
    pixels,
    restore() {
      if (originalCreateImageBitmap) {
        globalThis.createImageBitmap = originalCreateImageBitmap
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap')
      }

      if (originalOffscreenCanvas) {
        globalThis.OffscreenCanvas = originalOffscreenCanvas
      } else {
        Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
      }
    }
  }
}

describe('image surface helpers', () => {
  test('memoizes nested metafile image rendering behind ensureImageSurface', () => {
    const image = {
      kind: 'image',
      format: 'emf',
      buffer: new ArrayBuffer(4)
    }
    const calls = []
    const surface = createSurface()

    const rendered = ensureImageSurface(image, {
      createSurface(width, height) {
        calls.push(['createSurface', width, height])
        return surface
      },
      createBackend(target) {
        calls.push(['createBackend', target === surface])
        return { resize() {}, clear() {}, setTransform() {} }
      },
      parseEmf(buffer) {
        calls.push(['parseEmf', buffer.byteLength])
        return { parsed: 'emf' }
      },
      playEmf(parsed, backend, renderOptions) {
        calls.push(['playEmf', parsed, backend !== null, renderOptions])
      }
    })

    const replayed = ensureImageSurface(image, {
      createSurface() {
        throw new Error('memoized surface should be reused')
      }
    })

    expect(rendered.canvas).toBe(surface)
    expect(replayed.canvas).toBe(surface)
    expect(calls).toEqual([
      ['parseEmf', 4],
      ['createSurface', 1, 1],
      ['createBackend', true],
      ['playEmf', { parsed: 'emf' }, true, { width: 1, height: 1 }]
    ])
  })

  test('extracts StretchDIBits payloads and decodes indexed pixels through the shared surface path', () => {
    const { parsed, record } = writeStretchDibitsRecord()
    const operation = readClassicRasterOperation(parsed, record)
    const surface = createSurface()

    const image = ensureImageSurface(operation.image, {
      createSurface(width, height) {
        expect(width).toBe(2)
        expect(height).toBe(2)
        return surface
      }
    })

    expect(operation.destinationRect).toEqual({ x: 10, y: 20, width: 2, height: 2 })
    expect(operation.sourceRect).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    expect(image.canvas).toBe(surface)
    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255
    ])
  })

  test('extracts StretchBlt payloads through the shared DIB raster reader', () => {
    const { parsed, record } = writeStretchSourceRasterRecord(EMR_STRETCHBLT)
    const { warnings, addWarning } = createWarnings()

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(warnings).toEqual([])
    expect(operation).toMatchObject({
      kind: 'image',
      rasterOp: 0x00cc0020,
      destinationRect: { x: 10, y: 20, width: 30, height: 40 },
      sourceRect: { x: 1, y: 2, width: 3, height: 4 }
    })
    expect(operation.image).toMatchObject({
      format: 'dib',
      width: 2,
      height: 2
    })
  })

  test('extracts SetDIBitsToDevice payloads with scan metadata', () => {
    const { parsed, record } = writeSetDibitsToDeviceRecord()
    const { warnings, addWarning } = createWarnings()

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(warnings).toEqual([])
    expect(operation).toMatchObject({
      kind: 'image',
      rasterOp: 0x00cc0020,
      destinationRect: { x: 5, y: 6, width: 2, height: 2 },
      sourceRect: { x: 1, y: 1, width: 2, height: 2 },
      startScan: 0,
      scanLines: 2
    })
  })

  test('extracts AlphaBlend and TransparentBlt raster options', () => {
    const alpha = writeAlphaBlendRecord()
    const transparent = writeStretchSourceRasterRecord(EMR_TRANSPARENTBLT)

    const alphaOperation = readClassicRasterOperation(alpha.parsed, alpha.record)
    const transparentOperation = readClassicRasterOperation(transparent.parsed, transparent.record)

    expect(alphaOperation).toMatchObject({
      kind: 'image',
      rasterOp: 0x00cc0020,
      sourceConstantAlpha: 128 / 255,
      sourceAlpha: false,
      blendFunction: {
        operation: 0,
        flags: 0,
        sourceConstantAlpha: 128,
        alphaFormat: 0
      }
    })
    expect(transparentOperation).toMatchObject({
      kind: 'image',
      rasterOp: 0x00cc0020,
      transparentColor: { red: 1, green: 2, blue: 3 }
    })
  })

  test('propagates EMR_ALPHABLEND AC_SRC_ALPHA into classic DIB surface decode', () => {
    const alpha = writeAlphaBlendRecord({ sourceAlpha: true, sourceConstantAlpha: 200 })
    const operation = readClassicRasterOperation(alpha.parsed, alpha.record)

    expect(operation.sourceAlpha).toBe(true)
    expect(operation.image.sourceAlpha).toBe(true)
    expect(operation.blendFunction).toMatchObject({
      operation: 0,
      flags: 0,
      sourceConstantAlpha: 200,
      alphaFormat: 1
    })
  })

  test('decodes classic DIB 4bpp indexed pixels', () => {
    const bmiBytes = new Uint8Array(48)
    const view = new DataView(bmiBytes.buffer)

    view.setUint32(32, 2, true)
    bmiBytes.set([0, 0, 0, 0], 40)
    bmiBytes.set([255, 255, 255, 0], 44)

    const { surface } = renderBitmapPixels(
      createDibImage({
        width: 2,
        height: -1,
        bitCount: 4,
        bmiBytes,
        bitsBytes: [0x10, 0, 0, 0]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255
    ])
  })

  test('decodes classic DIB RLE8 encoded, absolute, delta, and bottom-up rows', () => {
    const { surface } = renderBitmapPixels(
      createDibImage({
        width: 5,
        height: 3,
        bitCount: 8,
        compression: BI_RLE8,
        bmiBytes: createTestPalette(),
        bitsBytes: [
          3, 1,
          1, 2,
          1, 3,
          0, 0,
          2, 4,
          0, 2, 1, 0,
          2, 5,
          0, 0,
          0, 5, 6, 5, 4, 3, 2, 0,
          0, 1
        ]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      0, 255, 255, 255,
      255, 255, 0, 255,
      255, 255, 255, 255,
      0, 0, 255, 255,
      0, 255, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 0, 255,
      255, 255, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255
    ])
  })

  test('decodes classic DIB RLE4 nibbles, absolute mode, delta, and bottom-up rows', () => {
    const { surface } = renderBitmapPixels(
      createDibImage({
        width: 6,
        height: 2,
        bitCount: 4,
        compression: BI_RLE4,
        bmiBytes: createTestPalette(),
        bitsBytes: [
          3, 0x12,
          0, 3, 0x34, 0x50,
          0, 0,
          2, 0x67,
          0, 2, 1, 0,
          3, 0x12,
          0, 1
        ]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      0, 255, 255, 255,
      255, 0, 255, 255,
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
      255, 255, 0, 255
    ])
  })

  test('warns clearly when classic DIB RLE uses top-down orientation', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 2,
        height: -1,
        bitCount: 8,
        compression: BI_RLE8,
        bmiBytes: createTestPalette(),
        bitsBytes: [2, 1, 0, 1]
      }),
      { addWarning }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'unsupported-dib-rle-top-down',
      capability: 'classic-dib-decode',
      reason: 'BI_RLE8'
    })
    expect(warnings).toEqual(['Unsupported top-down DIB RLE compression: BI_RLE8'])
  })

  test('warns clearly when classic DIB RLE streams omit end-of-bitmap', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 2,
        height: 1,
        bitCount: 8,
        compression: BI_RLE8,
        bmiBytes: createTestPalette(),
        bitsBytes: [2, 1]
      }),
      { addWarning }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'dib-rle-decode-failed',
      capability: 'classic-dib-decode',
      reason: 'missing RLE end-of-bitmap marker'
    })
    expect(warnings).toEqual(['DIB RLE payload is truncated: missing RLE end-of-bitmap marker'])
  })

  test('warns clearly when classic DIB RLE payloads are truncated', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 4,
        height: 1,
        bitCount: 8,
        compression: BI_RLE8,
        bmiBytes: createTestPalette(),
        bitsBytes: [0, 4, 1, 2]
      }),
      { addWarning }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'dib-rle-decode-failed',
      capability: 'classic-dib-decode',
      reason: 'missing RLE8 absolute bytes'
    })
    expect(warnings).toEqual(['DIB RLE payload is truncated: missing RLE8 absolute bytes'])
  })

  test('warns clearly when classic DIB RLE absolute padding is truncated', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 4,
        height: 1,
        bitCount: 4,
        compression: BI_RLE4,
        bmiBytes: createTestPalette(),
        bitsBytes: [0, 5, 0x12, 0x34, 0x50]
      }),
      { addWarning }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'dib-rle-decode-failed',
      capability: 'classic-dib-decode',
      reason: 'missing RLE4 absolute padding byte'
    })
    expect(warnings).toEqual(['DIB RLE payload is truncated: missing RLE4 absolute padding byte'])
  })

  test('decodes classic DIB 16bpp bitfields pixels', () => {
    const bmiBytes = new Uint8Array(52)
    const view = new DataView(bmiBytes.buffer)

    view.setUint32(40, 0xf800, true)
    view.setUint32(44, 0x07e0, true)
    view.setUint32(48, 0x001f, true)

    const { surface } = renderBitmapPixels(
      createDibImage({
        width: 3,
        height: -1,
        bitCount: 16,
        compression: BI_BITFIELDS,
        bmiBytes,
        bitsBytes: [0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0, 0]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255
    ])
  })

  test('decodes classic DIB 32bpp BI_RGB pixels as opaque unless source alpha is enabled', () => {
    const opaque = renderBitmapPixels(
      createDibImage({
        width: 2,
        height: -1,
        bitCount: 32,
        bitsBytes: [1, 2, 3, 0, 4, 5, 6, 128]
      })
    )
    const withSourceAlpha = renderBitmapPixels(
      createDibImage({
        width: 2,
        height: -1,
        bitCount: 32,
        sourceAlpha: true,
        bitsBytes: [1, 2, 3, 0, 4, 5, 6, 128]
      })
    )

    expect(Array.from(opaque.surface.context.lastImageData.data)).toEqual([
      3, 2, 1, 255,
      6, 5, 4, 255
    ])
    expect(Array.from(withSourceAlpha.surface.context.lastImageData.data)).toEqual([
      3, 2, 1, 0,
      6, 5, 4, 128
    ])
  })

  test('decodes classic DIB 32bpp bitfields alpha masks', () => {
    const bmiBytes = new Uint8Array(56)
    const view = new DataView(bmiBytes.buffer)

    view.setUint32(40, 0x00ff0000, true)
    view.setUint32(44, 0x0000ff00, true)
    view.setUint32(48, 0x000000ff, true)
    view.setUint32(52, 0xff000000, true)

    const { surface } = renderBitmapPixels(
      createDibImage({
        width: 2,
        height: -1,
        bitCount: 32,
        compression: BI_BITFIELDS,
        bmiBytes,
        bitsBytes: [0x33, 0x22, 0x11, 0x80, 0xaa, 0x00, 0xff, 0x40]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      17, 34, 51, 128,
      255, 0, 170, 64
    ])
  })

  test('warns instead of rendering unsupported compressed classic DIB payloads as black pixels', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 1,
        height: -1,
        bitCount: 32,
        compression: BI_PNG,
        bitsBytes: [0, 0, 0, 0]
      }),
      {
        addWarning,
        createSurface() {
          throw new Error('unsupported compressed DIB should not allocate a surface')
        }
      }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(warnings).toEqual(['Unsupported DIB compression: BI_PNG'])
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'unsupported-dib-compression',
      capability: 'classic-dib-decode',
      reason: 'BI_PNG'
    })
  })

  test('warns clearly for classic DIB JPEG native-decode boundaries', () => {
    const { warnings, addWarning } = createWarnings()
    const rendered = ensureImageSurface(
      createDibImage({
        width: 1,
        height: -1,
        bitCount: 24,
        compression: BI_JPEG,
        bitsBytes: [0xff, 0xd8, 0xff, 0xd9]
      }),
      { addWarning }
    )

    expect(rendered.canvas).toBeUndefined()
    expect(rendered.surfaceFailure).toMatchObject({
      code: 'unsupported-dib-compression',
      capability: 'classic-dib-decode',
      reason: 'BI_JPEG'
    })
    expect(warnings).toEqual(['Unsupported DIB compression: BI_JPEG'])
  })

  test('returns null and warns when StretchDIBits bmiOffset points outside the record', () => {
    const { parsed, record } = writeStretchDibitsRecord()
    const { warnings, addWarning } = createWarnings()

    record.size = 96
    record.dataSize = 88

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('EMR_STRETCHDIBITS bmi')
    ]))
  })

  test('returns null and warns when StretchDIBits bitsOffset points outside the record', () => {
    const { parsed, record } = writeStretchDibitsRecord()
    const { warnings, addWarning } = createWarnings()

    record.size = 132
    record.dataSize = 124

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('EMR_STRETCHDIBITS')])
  })

  test('returns null and warns when dib metadata is truncated', () => {
    const { parsed, record } = writeStretchDibitsRecord()
    const { warnings, addWarning } = createWarnings()

    parsed.view.setUint32(record.dataOffset + 44, 16, true)

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('DIB metadata')])
  })

  test('returns null and warns when StretchDIBits fixed header is truncated', () => {
    const parsed = {
      view: new DataView(new ArrayBuffer(48)),
      header: {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        deviceWidth: 2,
        deviceHeight: 2
      },
      records: []
    }
    const record = {
      type: EMR_STRETCHDIBITS,
      offset: 0,
      size: 48,
      dataOffset: 8,
      dataSize: 40
    }
    const { warnings, addWarning } = createWarnings()

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('header is truncated')])
  })

  test('returns null and warns when BitBlt fixed header is truncated', () => {
    const parsed = {
      view: new DataView(new ArrayBuffer(88)),
      header: {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        deviceWidth: 2,
        deviceHeight: 2
      },
      records: []
    }
    const record = {
      type: EMR_BITBLT,
      offset: 0,
      size: 88,
      dataOffset: 8,
      dataSize: 80
    }
    const { warnings, addWarning } = createWarnings()

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('header is truncated')])
  })

  test('warns clearly when source-DC raster records omit DIB payloads', () => {
    const parsed = {
      view: new DataView(new ArrayBuffer(120)),
      header: {
        bounds: { left: 0, top: 0, right: 2, bottom: 2 },
        deviceWidth: 2,
        deviceHeight: 2
      },
      records: []
    }
    const record = {
      type: EMR_STRETCHBLT,
      offset: 0,
      size: 108,
      dataOffset: 8,
      dataSize: 100
    }
    const { warnings, addWarning } = createWarnings()

    const operation = readClassicRasterOperation(parsed, record, { addWarning })

    expect(operation).toBeNull()
    expect(warnings).toEqual([
      'EMR_STRETCHBLT depends on a source DC but does not include a DIB payload'
    ])
  })

  test('warns when nested metafile surface creation fails', () => {
    const image = {
      kind: 'image',
      format: 'emf',
      buffer: new ArrayBuffer(4)
    }
    const { warnings, addWarning } = createWarnings()

    const rendered = ensureImageSurface(image, {
      addWarning,
      createSurface() {
        return null
      }
    })

    expect(rendered.canvas).toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('surface')])
  })

  fixtureTest('original/image6.emf')('decodes compressed EMF+ bitmap image objects into reusable canvas surfaces', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image6.emf'))
    const imageRecord = findFirstEmfPlusObjectRecord(parsed, 5)
    const image = decodeEmfPlusObject(imageRecord, parsed)
    const surface = createSurface()

    expect(image.compression).toBe('png')

    const rendered = ensureImageSurface(image, {
      createSurface(width, height) {
        expect(width).toBeGreaterThan(0)
        expect(height).toBeGreaterThan(0)
        return surface
      }
    })

    expect(rendered.canvas).toBe(surface)
    expect(rendered.width).toBeGreaterThan(0)
    expect(rendered.height).toBeGreaterThan(0)
    expect(surface.context.lastImageData).not.toBeNull()
  })

  test('decodes EMF+ raw 16bpp bitmap pixel formats', () => {
    const rgb565 = renderBitmapPixels(
      createBitmapImage({
        width: 3,
        height: 1,
        stride: 6,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_16BPP_RGB565,
        bytes: [0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00]
      })
    )

    expect(Array.from(rgb565.surface.context.lastImageData.data)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255
    ])

    const argb1555 = renderBitmapPixels(
      createBitmapImage({
        width: 2,
        height: 1,
        stride: 4,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555,
        bytes: [0x00, 0xfc, 0x1f, 0x00]
      })
    )

    expect(Array.from(argb1555.surface.context.lastImageData.data)).toEqual([
      255, 0, 0, 255,
      0, 0, 255, 0
    ])

    const rgb555 = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 2,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_16BPP_RGB555,
        bytes: [0xe0, 0x03]
      })
    )

    expect(Array.from(rgb555.surface.context.lastImageData.data)).toEqual([0, 255, 0, 255])
  })

  test('decodes EMF+ raw 32bpp RGB, ARGB, and premultiplied ARGB pixel formats', () => {
    const rgb = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 4,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_32BPP_RGB,
        bytes: [1, 2, 3, 77]
      })
    )
    const argb = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 4,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_32BPP_ARGB,
        bytes: [4, 5, 6, 128]
      })
    )
    const pargb = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 4,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_32BPP_PARGB,
        bytes: [0, 0, 128, 128]
      })
    )

    expect(Array.from(rgb.surface.context.lastImageData.data)).toEqual([3, 2, 1, 255])
    expect(Array.from(argb.surface.context.lastImageData.data)).toEqual([6, 5, 4, 128])
    expect(Array.from(pargb.surface.context.lastImageData.data)).toEqual([255, 0, 0, 128])
  })

  test('warns instead of rendering unsupported EMF+ raw pixel formats by bpp alone', () => {
    const unsupported16 = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 2,
        pixelFormat: 0x00021004,
        bytes: [0xff, 0xff]
      })
    )
    const unsupported32 = renderBitmapPixels(
      createBitmapImage({
        width: 1,
        height: 1,
        stride: 4,
        pixelFormat: 0x0002200c,
        bytes: [1, 2, 3, 4]
      })
    )

    expect(unsupported16.rendered.canvas).toBeUndefined()
    expect(unsupported16.warnings).toEqual(['Unsupported EMF+ bitmap pixel format: 135172'])
    expect(unsupported32.rendered.canvas).toBeUndefined()
    expect(unsupported32.warnings).toEqual(['Unsupported EMF+ bitmap pixel format: 139276'])
  })

  test('decodes EMF+ raw 8bpp indexed bitmaps with palettes and negative stride', () => {
    const { surface } = renderBitmapPixels(
      createBitmapImage({
        width: 2,
        height: 2,
        stride: -2,
        pixelFormat: EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED,
        palette: {
          flags: 0,
          entries: [
            { red: 10, green: 20, blue: 30, alpha: 255 },
            { red: 100, green: 110, blue: 120, alpha: 128 }
          ]
        },
        bytes: [0, 1, 1, 0]
      })
    )

    expect(Array.from(surface.context.lastImageData.data)).toEqual([
      100, 110, 120, 128,
      10, 20, 30, 255,
      10, 20, 30, 255,
      100, 110, 120, 128
    ])
  })

  test.each([
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), 'jpeg', 'image/jpeg'],
    ['GIF', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'gif', 'image/gif'],
    ['BMP', new Uint8Array([0x42, 0x4d, 0, 0]), 'bmp', 'image/bmp']
  ])('prefetches %s compressed EMF+ bitmaps with browser-native ImageBitmap APIs', async (name, payload, compression, mimeType) => {
    const { parsed, imageRecord, bytes } = createCompressedBitmapParsed(payload)
    const stub = installBrowserCompressedBitmapDecodeStub()
    const prefetchWarnings = []

    try {
      const count = await prefetchCompressedImages(parsed, prefetchWarnings)
      const image = imageRecord.prefetchedObject
      const surface = createSurface()
      const { warnings, addWarning } = createWarnings()

      const rendered = ensureImageSurface(image, {
        addWarning,
        createSurface(width, height) {
          expect(width).toBe(2)
          expect(height).toBe(1)
          return surface
        }
      })

      expect(count).toBe(1)
      expect(image).toMatchObject({
        kind: 'image',
        format: 'bitmap',
        compression,
        width: 2,
        height: 1,
        surface: null
      })
      expect(Array.from(image.compressedBytes)).toEqual(Array.from(bytes))
      expect(Array.from(image.pixels)).toEqual(Array.from(stub.pixels))
      expect(stub.createImageBitmapCalls).toHaveLength(1)
      expect(stub.createImageBitmapCalls[0].type).toBe(mimeType)
      expect(stub.canvases[0]).toMatchObject({ width: 2, height: 1 })
      expect(rendered.canvas).toBe(surface)
      expect(Array.from(surface.context.lastImageData.data)).toEqual(Array.from(stub.pixels))
      expect(prefetchWarnings).toEqual([])
      expect(warnings).toEqual([])
    } finally {
      stub.restore()
    }
  })

  test('warns and leaves JPEG compressed EMF+ bitmaps transparent when browser decode rejects', async () => {
    const { parsed, imageRecord } = createCompressedBitmapParsed()
    const stub = installBrowserCompressedBitmapDecodeStub({ reject: true })
    const { warnings, addWarning } = createWarnings()

    try {
      const count = await prefetchCompressedImages(parsed, warnings)
      const image = imageRecord.prefetchedObject
      const rendered = ensureImageSurface(image, { addWarning })

      expect(count).toBe(1)
      expect(image.pixels).toBeUndefined()
      expect(rendered.canvas).toBeUndefined()
      expect(rendered.element).toBeUndefined()
      expect(warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('Failed to decode compressed EMF+ jpeg bitmap'),
        expect.stringContaining('requires browser-native decode')
      ]))
      expect(image.surfaceFailure).toMatchObject({
        code: 'compressed-bitmap-native-decode-unavailable',
        capability: 'compressed-bitmap-decode',
        reason: 'jpeg'
      })
    } finally {
      stub.restore()
    }
  })

  test('marks nested metafile surfaces incomplete when nested playback reports unsupported records', () => {
    const image = {
      kind: 'image',
      format: 'emf',
      buffer: new ArrayBuffer(4)
    }
    const surface = createSurface()
    const { warnings, addWarning } = createWarnings()

    const rendered = ensureImageSurface(image, {
      addWarning,
      createSurface() {
        return surface
      },
      createBackend() {
        return { resize() {}, clear() {}, setTransform() {} }
      },
      parseEmf() {
        return {
          header: {
            bounds: { left: 10, top: 20, right: 30, bottom: 50 }
          }
        }
      },
      playEmf() {
        return {
          warnings: ['child warning'],
          unsupported: ['emfplus:0x400d'],
          diagnostics: [
            { code: 'runtime-warning' },
            { code: 'unsupported-record' }
          ]
        }
      }
    })

    expect(rendered.canvas).toBe(surface)
    expect(rendered.sourceBounds).toEqual({ x: 10, y: 20, width: 20, height: 30 })
    expect(rendered.surfaceIncomplete).toBe(true)
    expect(rendered.surfaceDiagnostics).toEqual({
      warningCount: 1,
      unsupportedCount: 1,
      diagnosticCodes: {
        'runtime-warning': 1,
        'unsupported-record': 1
      },
      warnings: ['child warning'],
      unsupported: ['emfplus:0x400d'],
      reason: '1 warning, 1 unsupported record, 2 diagnostics'
    })
    expect(warnings).toEqual([
      'Nested EMF image surface replay reported 1 warning, 1 unsupported record, 2 diagnostics'
    ])
  })

  test('rerenders nested metafile images when a larger destination resolution is requested', () => {
    const image = {
      kind: 'image',
      format: 'wmf',
      buffer: new ArrayBuffer(4)
    }
    const renderOptions = []

    function createResizableSurface(width = 1, height = 1) {
      const surface = createSurface(width, height)
      return {
        ...surface,
        width,
        height
      }
    }

    function createBackend(target) {
      return {
        resize(width, height) {
          target.width = width
          target.height = height
        },
        clear() {},
        save() {},
        restore() {},
        setTransform() {}
      }
    }

    const first = ensureImageSurface(
      image,
      {
        createSurface(width, height) {
          return createResizableSurface(width, height)
        },
        createBackend,
        parseWmf() {
          return {
            header: {
              bounds: { left: 158, top: 128, right: 323, bottom: 225 }
            }
          }
        },
        playWmf(parsed, backend, options) {
          renderOptions.push(options)
          backend.resize(options.width, options.height)
          return {
            warnings: [],
            unsupported: []
          }
        }
      },
      {
        displayedWidth: 660,
        displayedHeight: 388,
        sourceRect: { x: 158, y: 128, width: 165, height: 97 }
      }
    )
    const firstSurface = first.canvas

    const replayed = ensureImageSurface(
      image,
      {
        createSurface() {
          throw new Error('existing larger metafile surface should be reused')
        }
      },
      {
        displayedWidth: 330,
        displayedHeight: 194,
        sourceRect: { x: 158, y: 128, width: 165, height: 97 }
      }
    )
    const replayedSurface = replayed.canvas

    const rerendered = ensureImageSurface(
      image,
      {
        createSurface(width, height) {
          return createResizableSurface(width, height)
        },
        createBackend,
        parseWmf() {
          throw new Error('parsed metafile should be reused')
        },
        playWmf(parsed, backend, options) {
          renderOptions.push(options)
          backend.resize(options.width, options.height)
          return {
            warnings: [],
            unsupported: []
          }
        }
      },
      {
        displayedWidth: 1320,
        displayedHeight: 776,
        sourceRect: { x: 158, y: 128, width: 165, height: 97 }
      }
    )

    expect(firstSurface.width).toBe(660)
    expect(firstSurface.height).toBe(388)
    expect(replayedSurface).toBe(firstSurface)
    expect(rerendered.width).toBe(1320)
    expect(rerendered.height).toBe(776)
    expect(renderOptions).toEqual([
      { width: 660, height: 388 },
      { width: 1320, height: 776 }
    ])
  })

})
