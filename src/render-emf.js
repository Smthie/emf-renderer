import { parseEmf } from './emf/parse-emf.js'
import { parseWmf } from './wmf/parse-wmf.js'
import { CanvasBackend } from './backends/canvas-backend.js'
import { playParsedMetafile, prefetchCompressedImages } from './runtime/playback.js'
import { playParsedWmf } from './wmf/playback.js'

function createCanvasTarget() {
  if (typeof document !== 'undefined') {
    return document.createElement('canvas')
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1)
  }

  throw new Error('A canvas implementation is required outside the browser')
}

/**
 * Alpha cutoff used while trimming transparent canvas bounds.
 *
 * Units are integer alpha values in the 0-255 range. 21 is roughly 8% alpha.
 * This is intentionally not 0: antialiasing or feathered edges may leave
 * low-alpha halos, and a zero cutoff would retain visually invisible ghost
 * columns that make the trim box larger than expected. The value is empirical,
 * not defined by the EMF or EMF+ protocols.
 */
const TRIM_ALPHA_THRESHOLD = 21

const UINT32_ALPHA_MASK = 0xff000000

/**
 * Compute the bounding box of pixels at or above the trim alpha threshold.
 *
 * Internal: exported only so the trim logic can be unit-tested directly. It is
 * NOT part of the public API — `index.js` re-exports only the render functions,
 * so `import ... from 'emf-renderer'` never sees it. (It remains visible in the
 * deep-path `dist/types/render-emf.d.ts`; tsc's `stripInternal` does not strip
 * `@internal` JSDoc from `allowJs` sources, so this tag documents intent only.)
 * @internal
 */
export function measureOpaqueBounds(imageData, width, height) {
  const pixels = new Uint32Array(imageData.data.buffer, imageData.data.byteOffset, width * height)
  let top = -1

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width

    for (let x = 0; x < width; x += 1) {
      const alpha = (pixels[rowOffset + x] & UINT32_ALPHA_MASK) >>> 24

      if (alpha >= TRIM_ALPHA_THRESHOLD) {
        top = y
        break
      }
    }

    if (top !== -1) {
      break
    }
  }

  if (top === -1) {
    return null
  }

  let bottom = top

  for (let y = height - 1; y >= top; y -= 1) {
    const rowOffset = y * width
    let found = false

    for (let x = 0; x < width; x += 1) {
      const alpha = (pixels[rowOffset + x] & UINT32_ALPHA_MASK) >>> 24

      if (alpha >= TRIM_ALPHA_THRESHOLD) {
        bottom = y
        found = true
        break
      }
    }

    if (found) {
      break
    }
  }

  let left = 0

  for (let x = 0; x < width; x += 1) {
    let found = false

    for (let y = top; y <= bottom; y += 1) {
      const alpha = (pixels[y * width + x] & UINT32_ALPHA_MASK) >>> 24

      if (alpha >= TRIM_ALPHA_THRESHOLD) {
        left = x
        found = true
        break
      }
    }

    if (found) {
      break
    }
  }

  let right = left

  for (let x = width - 1; x >= left; x -= 1) {
    let found = false

    for (let y = top; y <= bottom; y += 1) {
      const alpha = (pixels[y * width + x] & UINT32_ALPHA_MASK) >>> 24

      if (alpha >= TRIM_ALPHA_THRESHOLD) {
        right = x
        found = true
        break
      }
    }

    if (found) {
      break
    }
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  }
}

function trimCanvasTransparentBounds(canvas) {
  const context = canvas?.getContext?.('2d')

  if (!context || typeof context.getImageData !== 'function') {
    return null
  }

  const width = canvas.width
  const height = canvas.height

  if (!width || !height) {
    return null
  }

  const sourceImage = context.getImageData(0, 0, width, height)
  const bounds = measureOpaqueBounds(sourceImage, width, height)

  if (
    !bounds ||
    (bounds.left === 0 && bounds.top === 0 && bounds.width === width && bounds.height === height)
  ) {
    return bounds
  }

  const croppedImage = context.getImageData(bounds.left, bounds.top, bounds.width, bounds.height)
  canvas.width = bounds.width
  canvas.height = bounds.height

  const resizedContext = canvas.getContext?.('2d')

  if (!resizedContext || typeof resizedContext.putImageData !== 'function') {
    return null
  }

  resizedContext.putImageData(croppedImage, 0, 0)

  return bounds
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  if (typeof btoa !== 'function') {
    throw new Error('Base64 encoding is unavailable in this environment')
  }

  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return btoa(binary)
}

async function exportCanvasAsPngBlob(target) {
  if (typeof target?.convertToBlob === 'function') {
    return target.convertToBlob({ type: 'image/png' })
  }

  if (typeof target?.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      target.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
            return
          }

          reject(new Error('Canvas target failed to export PNG blob'))
        },
        'image/png'
      )
    })
  }

  throw new Error(
    'Canvas target does not support PNG blob export; expected OffscreenCanvas.convertToBlob or HTMLCanvasElement.toBlob'
  )
}

async function exportCanvasAsPngDataUrl(target, getBlob) {
  if (typeof target?.toDataURL === 'function') {
    return target.toDataURL('image/png')
  }

  const blob = getBlob ? await getBlob() : await exportCanvasAsPngBlob(target)
  const buffer = await blob.arrayBuffer()
  return `data:image/png;base64,${arrayBufferToBase64(buffer)}`
}

/**
 * @typedef {HTMLCanvasElement | OffscreenCanvas} RenderCanvas
 */

/**
 * @typedef {Object} RenderOptions
 * @property {number} [width] Output width override, in device pixels.
 * @property {number} [height] Output height override, in device pixels.
 * @property {boolean} [trimTransparentBounds] Crop fully transparent margins from the output canvas.
 */

/**
 * @typedef {Object} RenderDiagnostic
 * @property {string} level Severity, e.g. "warning" or "unsupported".
 * @property {string} code Stable diagnostic code.
 * @property {string} message Human-readable description.
 * @property {string} [source] Originating record source, e.g. "emf" or "emfplus".
 * @property {number} [recordType] Record type code the diagnostic refers to.
 * @property {number} [recordOffset] Byte offset of the originating record.
 * @property {number} [objectId] Object id the diagnostic refers to, when applicable.
 * @property {string} [capability] Capability area the diagnostic belongs to.
 */

/**
 * @typedef {Object} RenderMeta
 * @property {boolean} hasEmfPlus Whether the source contained EMF+ records (always false for WMF).
 * @property {number[]} records Record type codes encountered, in playback order.
 * @property {string[]} warnings Human-readable warning messages.
 * @property {string[]} unsupported Unsupported record identifiers, e.g. "emf:0x76".
 * @property {RenderDiagnostic[]} diagnostics Structured per-record diagnostics.
 */

/**
 * @typedef {Object} RenderResult
 * @property {RenderCanvas} canvas The rendered canvas target.
 * @property {number} width Output width in pixels, after optional trimming.
 * @property {number} height Output height in pixels, after optional trimming.
 * @property {RenderMeta} meta Rendering metadata and diagnostics.
 * @property {() => Promise<Blob>} toBlob Lazily export the canvas as a PNG Blob.
 * @property {() => Promise<string>} toDataUrl Lazily export the canvas as a PNG data URL.
 */

/**
 * @param {RenderCanvas} target
 * @param {RenderMeta} meta
 * @param {RenderOptions} options
 * @returns {RenderResult}
 */
function buildRenderResult(target, meta, options) {
  if (options.trimTransparentBounds) {
    trimCanvasTransparentBounds(target)
  }

  let blobPromise = null
  let dataUrlPromise = null

  const result = {
    canvas: target,
    width: target.width,
    height: target.height,
    meta,
    toBlob() {
      if (!blobPromise) {
        blobPromise = exportCanvasAsPngBlob(target)
      }

      return blobPromise
    },
    toDataUrl() {
      if (!dataUrlPromise) {
        dataUrlPromise = exportCanvasAsPngDataUrl(target, () => result.toBlob())
      }

      return dataUrlPromise
    }
  }

  return result
}

/**
 * Render an EMF / EMF+ buffer to a canvas.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<RenderResult>}
 */
export async function renderEmf(buffer, options = {}) {
  if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError('renderEmf expects an ArrayBuffer or Uint8Array')
  }

  const parsed = parseEmf(buffer)
  const prefetchWarnings = []

  await prefetchCompressedImages(parsed, prefetchWarnings)

  const target = createCanvasTarget()
  const backend = new CanvasBackend(target)
  const runtime = playParsedMetafile(parsed, backend, {
    width: options.width,
    height: options.height
  })
  runtime.warnings.unshift(...prefetchWarnings)
  runtime.diagnostics.unshift(
    ...prefetchWarnings.map((message) => ({
      level: 'warning',
      code: 'prefetch-warning',
      message,
      source: 'prefetch',
      capability: 'compressed-bitmap-decode'
    }))
  )

  return buildRenderResult(
    target,
    {
      hasEmfPlus: parsed.hasEmfPlus,
      records: parsed.records.map((record) => record.type),
      warnings: runtime.warnings,
      unsupported: runtime.unsupported,
      diagnostics: runtime.diagnostics
    },
    options
  )
}

/**
 * Render an EMF / EMF+ buffer directly to a PNG Blob.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<Blob>}
 */
export async function renderEmfToBlob(buffer, options) {
  const result = await renderEmf(buffer, options)
  return result.toBlob()
}

/**
 * Render an EMF / EMF+ buffer directly to a PNG data URL.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<string>}
 */
export async function renderEmfToDataUrl(buffer, options) {
  const result = await renderEmf(buffer, options)
  return result.toDataUrl()
}

/**
 * Render a WMF (Windows Metafile) buffer to a canvas.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<RenderResult>}
 */
export async function renderWmf(buffer, options = {}) {
  if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError('renderWmf expects an ArrayBuffer or Uint8Array')
  }

  const parsed = parseWmf(buffer)
  const target = createCanvasTarget()
  const backend = new CanvasBackend(target)
  const runtime = playParsedWmf(parsed, backend, {
    width: options.width,
    height: options.height
  })

  return buildRenderResult(
    target,
    {
      hasEmfPlus: false,
      records: parsed.records.map((record) => record.type),
      warnings: runtime.warnings,
      unsupported: runtime.unsupported,
      diagnostics: runtime.diagnostics ?? []
    },
    options
  )
}

/**
 * Render a WMF buffer directly to a PNG Blob.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<Blob>}
 */
export async function renderWmfToBlob(buffer, options) {
  const result = await renderWmf(buffer, options)
  return result.toBlob()
}

/**
 * Render a WMF buffer directly to a PNG data URL.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {RenderOptions} [options]
 * @returns {Promise<string>}
 */
export async function renderWmfToDataUrl(buffer, options) {
  const result = await renderWmf(buffer, options)
  return result.toDataUrl()
}
