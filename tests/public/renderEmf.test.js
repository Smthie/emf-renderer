import { describe, expect, test } from 'vitest'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'
import { renderEmf, renderEmfToBlob, renderWmf } from '../../src/index.js'
import * as renderModule from '../../src/index.js'
import { measureOpaqueBounds } from '../../src/render-emf.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'
import { decodeEmfPlusObject } from '../../src/emfplus/object-decoders/index.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

function extractNestedWmfBuffer(name = 'original/image5.emf') {
  const parsed = parseEmf(readFixtureArrayBuffer(name))

  for (const record of parsed.records) {
    for (const subrecord of record.emfPlusRecords ?? []) {
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

function createSyntheticPixels(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4)

  if (width < 3 || height < 3) {
    return pixels
  }

  for (let y = 1; y <= Math.min(2, height - 1); y += 1) {
    for (let x = 1; x <= Math.min(2, width - 1); x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = 255
      pixels[offset + 3] = 255
    }
  }

  return pixels
}

function createImageData(width, height, opaquePixels = []) {
  const data = new Uint8ClampedArray(width * height * 4)

  for (const [x, y, alpha] of opaquePixels) {
    data[(y * width + x) * 4 + 3] = alpha
  }

  return { width, height, data }
}

function createFakeContext(state, calls) {
  return {
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
    getImageData(x, y, width, height) {
      if (state.pixels.length !== state.width * state.height * 4) {
        state.pixels = createSyntheticPixels(state.width, state.height)
      }

      const data = new Uint8ClampedArray(width * height * 4)

      for (let row = 0; row < height; row += 1) {
        const start = ((y + row) * state.width + x) * 4
        const end = start + width * 4
        data.set(state.pixels.slice(start, end), row * width * 4)
      }

      return {
        width,
        height,
        data
      }
    },
    putImageData(imageData) {
      state.pixels = new Uint8ClampedArray(imageData.data)
    }
  }
}

class FakeOffscreenCanvas {
  static instances = []

  constructor(width, height) {
    this.calls = []
    this.state = {
      width,
      height,
      pixels: createSyntheticPixels(width, height)
    }
    this.context = createFakeContext(this.state, this.calls)
    FakeOffscreenCanvas.instances.push(this)
  }

  get width() {
    return this.state.width
  }

  set width(value) {
    this.state.width = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  get height() {
    return this.state.height
  }

  set height(value) {
    this.state.height = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  getContext() {
    return this.context
  }

  toDataURL(type = 'image/png') {
    this.calls.push(['toDataURL', type])
    return 'data:image/png;base64,ZmFrZQ=='
  }
}

class FakeBlobOnlyOffscreenCanvas {
  static instances = []

  constructor(width, height) {
    this.calls = []
    this.state = {
      width,
      height,
      pixels: createSyntheticPixels(width, height)
    }
    this.context = createFakeContext(this.state, this.calls)
    FakeBlobOnlyOffscreenCanvas.instances.push(this)
  }

  get width() {
    return this.state.width
  }

  set width(value) {
    this.state.width = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  get height() {
    return this.state.height
  }

  set height(value) {
    this.state.height = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  getContext() {
    return this.context
  }

  convertToBlob(type = 'image/png') {
    this.calls.push(['convertToBlob', type])
    return Promise.resolve(
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])], {
        type: 'image/png'
      })
    )
  }
}

class FakeHtmlCanvas {
  static instances = []

  constructor(width = 1, height = 1) {
    this.calls = []
    this.state = {
      width,
      height,
      pixels: createSyntheticPixels(width, height)
    }
    this.context = createFakeContext(this.state, this.calls)
    FakeHtmlCanvas.instances.push(this)
  }

  get width() {
    return this.state.width
  }

  set width(value) {
    this.state.width = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  get height() {
    return this.state.height
  }

  set height(value) {
    this.state.height = value
    this.state.pixels = createSyntheticPixels(this.state.width, this.state.height)
  }

  getContext() {
    return this.context
  }

  toBlob(callback, type = 'image/png') {
    this.calls.push(['toBlob', type])
    callback(
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])], {
        type: 'image/png'
      })
    )
  }
}

function installFakeOffscreenCanvas(CanvasCtor = FakeOffscreenCanvas) {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas

  if (CanvasCtor) {
    CanvasCtor.instances = []
    globalThis.OffscreenCanvas = CanvasCtor
  } else {
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
  }

  return () => {
    if (originalOffscreenCanvas) {
      globalThis.OffscreenCanvas = originalOffscreenCanvas
    } else {
      Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
    }
  }
}

function installFakeDocumentCanvas(CanvasCtor = FakeHtmlCanvas) {
  const originalDocument = globalThis.document

  CanvasCtor.instances = []
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected element requested: ${tagName}`)
      }

      return new CanvasCtor(1, 1)
    }
  }

  return () => {
    if (originalDocument) {
      globalThis.document = originalDocument
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
}

describe('public renderEmf module', () => {
  test('measures tight opaque bounds from a small ImageData sample', () => {
    const imageData = createImageData(5, 4, [
      [0, 0, 20],
      [1, 1, 21],
      [3, 2, 255]
    ])

    expect(measureOpaqueBounds(imageData, 5, 4)).toEqual({
      left: 1,
      top: 1,
      width: 3,
      height: 2
    })
  })

  test('returns null for fully transparent data and finds a single center pixel', () => {
    expect(measureOpaqueBounds(createImageData(4, 4), 4, 4)).toBeNull()
    expect(measureOpaqueBounds(createImageData(5, 5, [[2, 3, 255]]), 5, 5)).toEqual({
      left: 2,
      top: 3,
      width: 1,
      height: 1
    })
  })

  test('only exposes named renderEmf and renderWmf APIs from the root entry', () => {
    expect(Object.keys(renderModule).sort()).toEqual([
      'renderEmf',
      'renderEmfToBlob',
      'renderEmfToDataUrl',
      'renderWmf',
      'renderWmfToBlob',
      'renderWmfToDataUrl'
    ])
    expect(typeof renderModule.renderEmf).toBe('function')
    expect(typeof renderModule.renderEmfToBlob).toBe('function')
    expect(typeof renderModule.renderEmfToDataUrl).toBe('function')
    expect(typeof renderModule.renderWmf).toBe('function')
    expect(typeof renderModule.renderWmfToBlob).toBe('function')
    expect(typeof renderModule.renderWmfToDataUrl).toBe('function')
  })

  fixtureTest('original/image5.emf')('renders a WMF buffer to a canvas with png export helpers', async () => {
    const restore = installFakeOffscreenCanvas()

    try {
      const result = await renderWmf(extractNestedWmfBuffer())

      expect(result.canvas).toBeInstanceOf(FakeOffscreenCanvas)
      expect(result.width).toBeGreaterThan(0)
      expect(result.height).toBeGreaterThan(0)
      expect(result.meta).toEqual(
        expect.objectContaining({
          hasEmfPlus: false,
          records: expect.any(Array),
          warnings: expect.any(Array),
          unsupported: expect.any(Array),
          diagnostics: expect.any(Array)
        })
      )
      expect(result.meta.records.length).toBeGreaterThan(0)
      await expect(result.toDataUrl()).resolves.toMatch(/^data:image\/png;base64,/)
    } finally {
      restore()
    }
  })

  fixtureTest('original/image1.emf')('trims transparent bounds and returns lazy png export helpers', async () => {
    const restore = installFakeOffscreenCanvas()

    try {
      const result = await renderEmf(readFixtureArrayBuffer('original/image1.emf'), {
        trimTransparentBounds: true
      })

      expect(result.canvas).toBeInstanceOf(FakeOffscreenCanvas)
      expect(result.width).toBe(2)
      expect(result.height).toBe(2)
      expect(result.meta).toEqual(
        expect.objectContaining({
          hasEmfPlus: expect.any(Boolean),
          records: expect.any(Array),
          warnings: expect.any(Array),
          unsupported: expect.any(Array),
          diagnostics: expect.any(Array)
        })
      )
      expect(typeof result.toBlob).toBe('function')
      expect(typeof result.toDataUrl).toBe('function')
      await expect(result.toDataUrl()).resolves.toMatch(/^data:image\/png;base64,/)
    } finally {
      restore()
    }
  })

  fixtureTest('original/image1.emf')('uses OffscreenCanvas.convertToBlob for data url export and caches the conversion', async () => {
    const restore = installFakeOffscreenCanvas(FakeBlobOnlyOffscreenCanvas)

    try {
      const result = await renderEmf(readFixtureArrayBuffer('original/image1.emf'))
      const canvas = result.canvas
      const firstDataUrl = await result.toDataUrl()
      const secondDataUrl = await result.toDataUrl()

      expect(canvas).toBeInstanceOf(FakeBlobOnlyOffscreenCanvas)
      expect(firstDataUrl).toMatch(/^data:image\/png;base64,/)
      expect(secondDataUrl).toBe(firstDataUrl)
      expect(canvas.calls.filter((call) => call[0] === 'convertToBlob')).toHaveLength(1)
    } finally {
      restore()
    }
  })

  fixtureTest('original/image1.emf')('uses HTMLCanvasElement.toBlob path and memoizes blob/data url exports', async () => {
    const restoreOffscreenCanvas = installFakeOffscreenCanvas(null)
    const restoreDocument = installFakeDocumentCanvas(FakeHtmlCanvas)

    try {
      const directBlob = await renderEmfToBlob(readFixtureArrayBuffer('original/image1.emf'))
      const directBytes = await directBlob.arrayBuffer()

      expect(directBytes.byteLength).toBeGreaterThan(0)

      const result = await renderEmf(readFixtureArrayBuffer('original/image1.emf'))
      const canvas = result.canvas
      const firstBlob = await result.toBlob()
      const secondBlob = await result.toBlob()
      const firstDataUrl = await result.toDataUrl()
      const secondDataUrl = await result.toDataUrl()

      expect(canvas).toBeInstanceOf(FakeHtmlCanvas)
      expect(firstBlob).toBe(secondBlob)
      expect(firstDataUrl).toBe(secondDataUrl)
      expect(firstDataUrl).toMatch(/^data:image\/png;base64,/)
      expect(canvas.calls.filter((call) => call[0] === 'toBlob')).toHaveLength(1)
    } finally {
      restoreDocument()
      restoreOffscreenCanvas()
    }
  })
})
