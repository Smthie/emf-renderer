import { describe, expect, test } from 'vitest'
import { fixtureSampleExists, readFixtureArrayBuffer } from '../helpers/read-fixture.js'
import { parseEmf } from '../../src/emf/parse-emf.js'
import { playParsedMetafile } from '../../src/runtime/playback.js'
import { decodeEmfPlusObject } from '../../src/emfplus/object-decoders/index.js'
import { EmfPlusRecordType } from '../../src/emfplus/constants.js'

// The real/ and original/ fixture trees are local-only; skip fixture-driven
// tests when they are absent (fresh clones, CI).
const fixtureTest = (name) => test.skipIf(!fixtureSampleExists(name))

function findFirstEmfPlusImageObject(parsed, format = null) {
  for (const record of parsed.records) {
    if (!record.emfPlusRecords) {
      continue
    }

    for (const subrecord of record.emfPlusRecords) {
      if (subrecord.type !== EmfPlusRecordType.Object) {
        continue
      }

      const object = decodeEmfPlusObject(subrecord, parsed)

      if (object?.kind === 'image' && (format === null || object.format === format)) {
        return object
      }
    }
  }

  throw new Error(`EMF+ image object${format ? ` (${format})` : ''} not found`)
}

describe('EMF+ drawing playback', () => {
  fixtureTest('original/image10.emf')('replays image10.emf path and image content through the backend', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image10.emf'))
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
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
              drawImage() {},
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
      fillPath(path, brush) {
        calls.push([
          'fillPath',
          path.kind,
          path.figures.length,
          path.figures[0]?.closed ?? null,
          path.figures[0]?.points.length ?? 0,
          brush.kind
        ])
      },
      strokePath(path, pen) {
        calls.push([
          'strokePath',
          path.kind,
          path.figures.length,
          path.figures[0]?.closed ?? null,
          path.figures[0]?.points.length ?? 0,
          pen.kind
        ])
      },
      drawImageParallelogram(image, points) {
        calls.push(['drawImageParallelogram', image.kind, points.length])
      }
    }

    const runtime = playParsedMetafile(parsed, backend)

    expect(calls).toContainEqual(['fillPath', 'path', 1, true, 3, 'brush'])
    expect(calls).toContainEqual(['strokePath', 'path', 1, true, 3, 'pen'])
    expect(calls).toContainEqual(['drawImageParallelogram', 'image', 3])
    expect(runtime.unsupported).not.toContain('emfplus:0x4014')
    expect(runtime.unsupported).not.toContain('emfplus:0x4015')
    expect(runtime.unsupported).not.toContain('emfplus:0x401b')
  })

  fixtureTest('original/image3.emf')('warns but does not mark DrawImagePoints unsupported when image surfaces cannot be created', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image3.emf'))
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillPath() {},
      strokePath() {},
      drawImageParallelogram(image, points) {
        calls.push(['drawImageParallelogram', image.kind, points.length])
      }
    }

    const runtime = playParsedMetafile(parsed, backend)

    expect(calls).toEqual([])
    // The record is recognized and decoded; it only degraded because the headless
    // backend cannot create an image surface. That must surface as a single
    // image-surface-unavailable diagnostic, NOT as an unsupported record too.
    expect(runtime.warnings.some((warning) => warning.includes('surface'))).toBe(true)
    expect(runtime.unsupported).not.toContain('emfplus:0x401b')
  })

  fixtureTest('original/image6.emf')('decodes compressed DrawImagePoints coordinates for bitmap-backed image6.emf', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image6.emf'))
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillPath() {},
      strokePath() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              save() {},
              restore() {},
              setTransform() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              bezierCurveTo() {},
              closePath() {},
              fill() {},
              stroke() {},
              ellipse() {},
              rect() {},
              clip() {},
              drawImage() {},
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
      drawImageParallelogram(image, points) {
        calls.push(['drawImageParallelogram', image.kind, points])
      }
    }

    const runtime = playParsedMetafile(parsed, backend)

    expect(calls).toContainEqual([
      'drawImageParallelogram',
      'image',
      [
        { x: 0, y: 0 },
        { x: 266, y: 0 },
        { x: 0, y: 382 }
      ]
    ])
    expect(runtime.unsupported).not.toContain('emfplus:0x401b')
  })

  fixtureTest('original/image10.emf')('passes the DrawImagePoints source rectangle through to the backend for complete nested EMF images', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image10.emf'))
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillPath() {},
      strokePath() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              save() {},
              restore() {},
              setTransform() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              bezierCurveTo() {},
              closePath() {},
              fill() {},
              stroke() {},
              ellipse() {},
              rect() {},
              clip() {},
              drawImage() {},
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
      drawImageParallelogram(image, points, sourceRect) {
        calls.push(['drawImageParallelogram', image.kind, points, sourceRect])
      }
    }

    const runtime = playParsedMetafile(parsed, backend)
    const imageCall = calls.find((call) => call[0] === 'drawImageParallelogram')

    expect(imageCall?.[1]).toBe('image')
    expect(imageCall?.[2]).toEqual([
      { x: 550.9861450195312, y: -611.0030517578125 },
      { x: 601.0043334960938, y: -611.0030517578125 },
      { x: 550.9861450195312, y: -559 }
    ])
    expect(imageCall?.[3]).toEqual({
      x: -0.020493825276692707,
      y: -1.4534015266262754,
      width: 73.98523712158203,
      height: 75.35136071029974
    })
    expect(runtime.unsupported).not.toContain('emfplus:0x401b')
  })

  fixtureTest('original/image10.emf')('supports nested EMF container records instead of leaving them unsupported', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image10.emf'))
    const nestedImage = findFirstEmfPlusImageObject(parsed, 'emf')
    const nestedParsed = parseEmf(nestedImage.buffer)
    const runtime = playParsedMetafile(nestedParsed, {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillRect() {},
      strokeRect() {},
      fillEllipse() {},
      strokeEllipse() {},
      drawLine() {},
      fillPath() {},
      strokePath() {},
      drawImageRect() {},
      drawImageParallelogram() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              save() {},
              restore() {},
              setTransform() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              bezierCurveTo() {},
              closePath() {},
              fill() {},
              stroke() {},
              ellipse() {},
              rect() {},
              clip() {},
              drawImage() {},
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
      }
    })

    expect(runtime.unsupported).not.toContain('emfplus:0x4028')
    expect(runtime.unsupported).not.toContain('emfplus:0x4029')
  })

  fixtureTest('original/image9.emf')('does not replay classic raster fallback records for dual image9.emf outside GetDC', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image9.emf'))
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillPath() {},
      strokePath() {},
      drawImageRect(image, destinationRect, sourceRect) {
        calls.push(['drawImageRect', image.kind, destinationRect, sourceRect])
      },
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              save() {},
              restore() {},
              setTransform() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              bezierCurveTo() {},
              closePath() {},
              fill() {},
              stroke() {},
              ellipse() {},
              rect() {},
              clip() {},
              drawImage() {},
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
      drawImageParallelogram(image, points, sourceRect) {
        calls.push(['drawImageParallelogram', image.kind, points, sourceRect])
      }
    }

    playParsedMetafile(parsed, backend)

    expect(calls.filter((call) => call[0] === 'drawImageParallelogram')).toHaveLength(1)
    expect(calls.filter((call) => call[0] === 'drawImageRect')).toEqual([])
  })

  fixtureTest('original/image1.emf')('replays nested image1.emf DrawLines records instead of leaving them unsupported', () => {
    const parsed = parseEmf(readFixtureArrayBuffer('original/image1.emf'))
    const nestedImage = findFirstEmfPlusImageObject(parsed, 'emf')
    const nestedParsed = parseEmf(nestedImage.buffer)
    const calls = []
    const backend = {
      resize() {},
      clear() {},
      save() {},
      restore() {},
      setTransform() {},
      clipRect() {},
      fillRect() {},
      strokeRect() {},
      fillEllipse() {},
      strokeEllipse() {},
      drawLine() {},
      fillPath() {},
      strokePath(path, pen) {
        calls.push(['strokePath', path, pen])
      },
      drawImageRect() {},
      drawImageParallelogram() {},
      createSurface(width, height) {
        return {
          width,
          height,
          getContext() {
            return {
              clearRect() {},
              save() {},
              restore() {},
              setTransform() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              bezierCurveTo() {},
              closePath() {},
              fill() {},
              stroke() {},
              ellipse() {},
              rect() {},
              clip() {},
              drawImage() {},
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
      }
    }

    const runtime = playParsedMetafile(nestedParsed, backend)

    expect(runtime.unsupported).not.toContain('emfplus:0x400d')
    expect(
      calls.some(
        (call) =>
          call[0] === 'strokePath' &&
          call[1]?.figures?.some((figure) => figure.closed === false && figure.points?.length === 2)
      )
    ).toBe(true)
  })
})
