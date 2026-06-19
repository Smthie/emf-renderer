import { describe, expect, test } from 'vitest'
import { CanvasBackend } from '../../src/backends/canvas-backend.js'

function createFakeTarget() {
  const calls = []
  let stackDepth = 0
  const stateStack = []
  const context = {
    calls,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    direction: 'inherit',
    save() {
      stackDepth += 1
      stateStack.push({
        globalCompositeOperation: this.globalCompositeOperation,
        imageSmoothingEnabled: this.imageSmoothingEnabled,
        imageSmoothingQuality: this.imageSmoothingQuality,
        direction: this.direction,
        lineWidth: this.lineWidth,
        lineCap: this.lineCap,
        lineJoin: this.lineJoin,
        lineDashOffset: this.lineDashOffset,
        miterLimit: this.miterLimit
      })
      calls.push(['save'])
    },
    restore() {
      stackDepth -= 1

      if (stackDepth < 0) {
        throw new Error('restore called without matching save')
      }

      Object.assign(this, stateStack.pop())
      calls.push(['restore'])
    },
    setTransform(...args) {
      calls.push(['setTransform', ...args])
    },
    translate(...args) {
      calls.push(['translate', ...args])
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
    ellipse(...args) {
      calls.push(['ellipse', ...args])
    },
    closePath() {
      calls.push(['closePath'])
    },
    fill(rule) {
      calls.push(['fill', rule])
    },
    stroke() {
      calls.push(['stroke'])
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
    measureText(text) {
      calls.push(['measureText', text])
      return {
        width: text.length * 12,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3
      }
    },
    setLineDash(...args) {
      calls.push(['setLineDash', ...args])
    },
    createLinearGradient(...args) {
      calls.push(['createLinearGradient', ...args])

      return {
        addColorStop(offset, color) {
          calls.push(['gradient.addColorStop', offset, color])
        }
      }
    },
    createRadialGradient(...args) {
      calls.push(['createRadialGradient', ...args])

      return {
        addColorStop(offset, color) {
          calls.push(['radialGradient.addColorStop', offset, color])
        }
      }
    },
    createPattern(...args) {
      calls.push(['createPattern', ...args])

      return {
        setTransform(transform) {
          calls.push(['pattern.setTransform', transform])
        }
      }
    }
  }

  return {
    width: 0,
    height: 0,
    calls,
    get stackDepth() {
      return stackDepth
    },
    getContext() {
      return context
    }
  }
}

function createPixelTarget(width = 2, height = 2, pixels = null) {
  const calls = []
  const target = {
    width,
    height,
    pixels: pixels
      ? new Uint8ClampedArray(pixels)
      : new Uint8ClampedArray(width * height * 4),
    calls,
    getContext() {
      return {
        calls,
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'low',
        save() {
          calls.push(['save'])
        },
        restore() {
          calls.push(['restore'])
        },
        setTransform(...args) {
          calls.push(['setTransform', ...args])
        },
        drawImage(image, sx = 0, sy = 0, sw = image.width, sh = image.height, dx = 0, dy = 0, dw = sw, dh = sh) {
          calls.push(['drawImage', image, sx, sy, sw, sh, dx, dy, dw, dh])

          for (let y = 0; y < dh; y += 1) {
            for (let x = 0; x < dw; x += 1) {
              const sourceX = Math.min(image.width - 1, sx + Math.floor((x * sw) / dw))
              const sourceY = Math.min(image.height - 1, sy + Math.floor((y * sh) / dh))
              const targetX = dx + x
              const targetY = dy + y

              if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) {
                continue
              }

              const sourceOffset = (sourceY * image.width + sourceX) * 4
              const targetOffset = (targetY * width + targetX) * 4
              target.pixels.set(image.pixels.slice(sourceOffset, sourceOffset + 4), targetOffset)
            }
          }
        },
        fillRect(x, y, w, h) {
          calls.push(['fillRect', x, y, w, h, this.fillStyle])
          const match = String(this.fillStyle).match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
          const color = match
            ? [Number(match[1]), Number(match[2]), Number(match[3]), 255]
            : [0, 0, 0, 255]

          for (let yy = y; yy < y + h; yy += 1) {
            for (let xx = x; xx < x + w; xx += 1) {
              target.pixels.set(color, (yy * width + xx) * 4)
            }
          }
        },
        getImageData(x, y, w, h) {
          calls.push(['getImageData', x, y, w, h])
          const data = new Uint8ClampedArray(w * h * 4)

          for (let yy = 0; yy < h; yy += 1) {
            for (let xx = 0; xx < w; xx += 1) {
              const sourceOffset = ((y + yy) * width + (x + xx)) * 4
              const targetOffset = (yy * w + xx) * 4
              data.set(target.pixels.slice(sourceOffset, sourceOffset + 4), targetOffset)
            }
          }

          return { width: w, height: h, data }
        },
        putImageData(imageData, x, y) {
          calls.push(['putImageData', x, y])

          for (let yy = 0; yy < imageData.height; yy += 1) {
            for (let xx = 0; xx < imageData.width; xx += 1) {
              const sourceOffset = (yy * imageData.width + xx) * 4
              const targetOffset = ((y + yy) * width + (x + xx)) * 4
              target.pixels.set(imageData.data.slice(sourceOffset, sourceOffset + 4), targetOffset)
            }
          }
        }
      }
    }
  }

  return target
}

describe('CanvasBackend', () => {
  test('throws when the target does not expose a 2d context', () => {
    expect(
      () =>
        new CanvasBackend({
          getContext() {
            return null
          }
        })
    ).toThrow('CanvasBackend requires a 2d context')
  })

  test('resizes the target and forwards drawing state calls', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.resize(320, 200)
    backend.clear()
    backend.save()
    backend.restore()
    backend.setTransform([1, 0, 0, 1, 12, 24])

    expect(target.width).toBe(320)
    expect(target.height).toBe(200)
    expect(target.calls).toContainEqual(['clearRect', 0, 0, 320, 200])
    expect(target.calls).toContainEqual(['save'])
    expect(target.calls).toContainEqual(['restore'])
    expect(target.calls).toContainEqual(['setTransform', 1, 0, 0, 1, 12, 24])
  })

  test('applies compositing and interpolation graphics state to the canvas context', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.applyGraphicsState({
      compositingMode: 'sourceCopy',
      interpolationMode: 7,
      pixelOffsetMode: 4,
      smoothingMode: 'default',
      textRenderingHint: 'system'
    })

    expect(backend.ctx.globalCompositeOperation).toBe('copy')
    expect(backend.ctx.imageSmoothingEnabled).toBe(true)
    expect(backend.ctx.imageSmoothingQuality).toBe('high')

    const source = { width: 2, height: 2 }
    backend.drawImageRect(
      { kind: 'image', canvas: source, width: 2, height: 2 },
      { x: 10, y: 20, width: 30, height: 40 },
      null
    )

    expect(target.calls).toContainEqual(['drawImage', source, 10.5, 20.5, 30, 40])

    backend.applyGraphicsState({
      compositingMode: 'sourceOver',
      interpolationMode: 5,
      pixelOffsetMode: 3,
      smoothingMode: 'default',
      textRenderingHint: 'system'
    })

    expect(backend.ctx.globalCompositeOperation).toBe('source-over')
    expect(backend.ctx.imageSmoothingEnabled).toBe(false)
  })

  test('maps supported classic ROP2 stroke modes without affecting fills', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 1, top: 2, right: 11, bottom: 12 },
      { color: 'rgb(10, 20, 30)', width: 2, rop2: 4 }
    )

    expect(backend.ctx.strokeStyle).toBe('rgba(245, 235, 225, 1)')

    backend.fillRect({ left: 0, top: 0, right: 4, bottom: 4 }, { color: 'rgb(1, 2, 3)' })
    expect(backend.ctx.globalCompositeOperation).not.toBe('xor')

    backend.strokeRect(
      { left: 3, top: 4, right: 13, bottom: 14 },
      { color: 'rgb(1, 2, 3)', width: 1, rop2: 7 }
    )

    expect(target.calls).toContainEqual(['save'])
    expect(target.calls).toContainEqual(['strokeRect', 3, 4, 10, 10])
    expect(target.calls).toContainEqual(['restore'])
    expect(backend.ctx.globalCompositeOperation).not.toBe('xor')
  })

  test('applies common classic ROP3 image operations with pixel readback', () => {
    const cases = [
      {
        name: 'SRCAND',
        rasterOp: 0x008800c6,
        expected: [0x0f & 0xf0, 0xf0 & 0x0f, 0xff & 0x33, 255]
      },
      {
        name: 'SRCPAINT',
        rasterOp: 0x00ee0086,
        expected: [0x0f | 0xf0, 0xf0 | 0x0f, 0xff | 0x33, 255]
      },
      {
        name: 'SRCINVERT',
        rasterOp: 0x00660046,
        expected: [0x0f ^ 0xf0, 0xf0 ^ 0x0f, 0xff ^ 0x33, 255]
      }
    ]

    for (const entry of cases) {
      const target = createPixelTarget(1, 1, [0x0f, 0xf0, 0xff, 255])
      const backend = new CanvasBackend(target)
      const source = createPixelTarget(1, 1, [0xf0, 0x0f, 0x33, 255])

      backend.createSurface = () => createPixelTarget(1, 1)
      backend.drawImageRect(
        { canvas: source, width: 1, height: 1 },
        { x: 0, y: 0, width: 1, height: 1 },
        null,
        { rasterOp: entry.rasterOp }
      )

      expect(Array.from(target.pixels), entry.name).toEqual(entry.expected)
    }
  })

  test('applies SRCCOPY and solid raster operations through canvas primitives', () => {
    const source = createPixelTarget(1, 1, [1, 2, 3, 255])
    const copyTarget = createPixelTarget(1, 1, [0, 0, 0, 255])
    const copyBackend = new CanvasBackend(copyTarget)

    copyBackend.drawImageRect(
      { canvas: source, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      { rasterOp: 0x00cc0020 }
    )

    expect(Array.from(copyTarget.pixels)).toEqual([1, 2, 3, 255])

    const blackTarget = createPixelTarget(1, 1, [10, 20, 30, 255])
    new CanvasBackend(blackTarget).drawImageRect(
      { canvas: source, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      { rasterOp: 0x00000042 }
    )
    expect(Array.from(blackTarget.pixels)).toEqual([0, 0, 0, 255])

    const whiteTarget = createPixelTarget(1, 1, [10, 20, 30, 255])
    new CanvasBackend(whiteTarget).drawImageRect(
      { canvas: source, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      { rasterOp: 0x00ff0062 }
    )
    expect(Array.from(whiteTarget.pixels)).toEqual([255, 255, 255, 255])
  })

  test('applies PATCOPY with a supplied solid pattern color', () => {
    const target = createPixelTarget(1, 1, [0, 0, 0, 255])
    const backend = new CanvasBackend(target)

    backend.drawImageRect(
      { canvas: createPixelTarget(1, 1), width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      { rasterOp: 0x00f00021, patternColor: 'rgb(4, 5, 6)' }
    )

    expect(Array.from(target.pixels)).toEqual([4, 5, 6, 255])
  })

  test('applies TransparentBlt color-key transparency with pixel readback', () => {
    const target = createPixelTarget(2, 1, [
      10, 20, 30, 255,
      40, 50, 60, 255
    ])
    const source = createPixelTarget(2, 1, [
      1, 2, 3, 255,
      9, 8, 7, 255
    ])
    const backend = new CanvasBackend(target)

    backend.createSurface = () => createPixelTarget(2, 1)
    backend.drawImageRect(
      { canvas: source, width: 2, height: 1 },
      { x: 0, y: 0, width: 2, height: 1 },
      null,
      { rasterOp: 0x00cc0020, transparentColor: { red: 1, green: 2, blue: 3 } }
    )

    expect(Array.from(target.pixels)).toEqual([
      1, 2, 3, 0,
      9, 8, 7, 255
    ])
  })

  test('reports unsupported classic raster operations without drawing', () => {
    const target = createPixelTarget(1, 1, [10, 20, 30, 255])
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawImageRect(
      { canvas: createPixelTarget(1, 1, [1, 2, 3, 255]), width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      {
        rasterOp: 0x12345678,
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(Array.from(target.pixels)).toEqual([10, 20, 30, 255])
    expect(warnings).toEqual(['Unsupported classic raster operation: 0x12345678'])
  })

  test('fills the canvas in device space for colored clear operations', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.resize(320, 200)
    backend.setTransform([2, 0, 0, 3, 10, 20])
    target.calls.length = 0
    backend.clear({ color: 'rgba(17, 34, 51, 1)' })

    expect(target.calls).toEqual([
      ['save'],
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['fillRect', 0, 0, 320, 200],
      ['restore']
    ])
    expect(backend.ctx.fillStyle).toBe('rgba(17, 34, 51, 1)')
  })

  test('forwards rectangle drawing and clipping calls', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      { color: 'rgb(0, 255, 0)' }
    )
    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      { color: 'rgb(255, 0, 0)', width: 3, miterLimit: 6 }
    )
    backend.clipRect({ x: 5, y: 6, width: 70, height: 80 }, 'replace')

    expect(target.calls).toContainEqual(['fillRect', 10, 20, 100, 50])
    expect(target.calls).toContainEqual(['strokeRect', 10, 20, 100, 50])
    expect(target.calls).toContainEqual(['beginPath'])
    expect(target.calls).toContainEqual(['rect', 5, 6, 70, 80])
    expect(target.calls).toContainEqual(['clip'])
    expect(backend.ctx.fillStyle).toBe('rgb(0, 255, 0)')
    expect(backend.ctx.strokeStyle).toBe('rgb(255, 0, 0)')
    expect(backend.ctx.lineWidth).toBe(3)
    expect(backend.ctx.miterLimit).toBe(6)
    expect(backend.ctx.__clipMode).toBe('replace')
  })

  test('resolves linear gradient brushes before filling geometry', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'brush',
        type: 'linearGradient',
        rect: { x: 10, y: 20, width: 100, height: 50 },
        startColor: 'rgba(255, 0, 0, 1)',
        endColor: 'rgba(0, 0, 255, 1)'
      }
    )

    expect(target.calls).toContainEqual(['createLinearGradient', 10, 20, 110, 20])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 0, 'rgba(255, 0, 0, 1)'])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 1, 'rgba(0, 0, 255, 1)'])
    expect(target.calls).toContainEqual(['fillRect', 10, 20, 100, 50])
  })

  test('applies linear gradient transforms and blend factors to canvas stops', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'brush',
        type: 'linearGradient',
        rect: { x: 0, y: 0, width: 10, height: 0 },
        transform: [1, 0, 0, 1, 2, 3],
        startColor: 'rgba(0, 0, 0, 1)',
        endColor: 'rgba(255, 255, 255, 1)',
        blendPositions: [0, 0.5, 1],
        blendFactors: [0, 1, 0]
      }
    )

    expect(target.calls).toContainEqual(['createLinearGradient', 2, 3, 12, 3])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 0, 'rgba(255, 255, 255, 1)'])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 0.5, 'rgba(0, 0, 0, 1)'])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 1, 'rgba(255, 255, 255, 1)'])
  })

  test.each([
    ['tile', false],
    ['tileFlipY', false],
    ['tileFlipX', true],
    ['tileFlipXY', true]
  ])('repeats linear gradient stops for %s wrapping', (wrapMode, flipsAlongGradient) => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 0, top: 0, right: 30, bottom: 10 },
      {
        kind: 'brush',
        type: 'linearGradient',
        wrapMode,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        startColor: 'red',
        endColor: 'blue'
      }
    )

    expect(target.calls).toContainEqual(['createLinearGradient', 0, 0, 30, 0])
    const stops = target.calls.filter((call) => call[0] === 'gradient.addColorStop')

    expect(stops).toHaveLength(6)
    expect(stops.slice(0, 4)).toEqual(
      flipsAlongGradient
        ? [
            ['gradient.addColorStop', 0, 'red'],
            ['gradient.addColorStop', 1 / 3, 'blue'],
            ['gradient.addColorStop', 1 / 3, 'blue'],
            ['gradient.addColorStop', 2 / 3, 'red']
          ]
        : [
            ['gradient.addColorStop', 0, 'red'],
            ['gradient.addColorStop', 1 / 3, 'blue'],
            ['gradient.addColorStop', 1 / 3, 'red'],
            ['gradient.addColorStop', 2 / 3, 'blue']
          ]
    )
    expect(stops.at(-1)).toEqual(['gradient.addColorStop', 1, 'blue'])
  })

  test('shifts a wrapped linear gradient to a distant single tile', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 20, top: 0, right: 25, bottom: 10 },
      {
        kind: 'brush',
        type: 'linearGradient',
        wrapMode: 'tile',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        startColor: 'red',
        endColor: 'blue'
      }
    )

    expect(target.calls).toContainEqual(['createLinearGradient', 20, 0, 30, 0])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 0, 'red'])
    expect(target.calls).toContainEqual(['gradient.addColorStop', 1, 'blue'])
  })

  test('does not expand pathological wrapped linear gradients into excessive stops', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 0, top: 0, right: 100, bottom: 10 },
      {
        kind: 'brush',
        type: 'linearGradient',
        wrapMode: 'tile',
        rect: { x: 0, y: 0, width: 0.001, height: 1 },
        startColor: 'red',
        endColor: 'blue'
      }
    )

    expect(target.calls).toContainEqual(['createLinearGradient', 0, 0, 0.001, 0])
    expect(target.calls.filter((call) => call[0] === 'gradient.addColorStop')).toHaveLength(2)
  })

  test('resolves path gradient brushes before filling geometry', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'brush',
        type: 'pathGradient',
        centerColor: 'rgba(255, 0, 0, 1)',
        centerPoint: { x: 5, y: 5 },
        surroundingColors: ['rgba(0, 0, 255, 1)', 'rgba(0, 0, 255, 1)', 'rgba(0, 0, 255, 1)']
      }
    )

    const gradientCall = target.calls.find((entry) => entry[0] === 'createRadialGradient')

    expect(gradientCall.slice(1, 6)).toEqual([5, 5, 0, 5, 5])
    expect(gradientCall[6]).toBeCloseTo(Math.sqrt(50))
    expect(target.calls).toContainEqual(['radialGradient.addColorStop', 0, 'rgba(255, 0, 0, 1)'])
    expect(target.calls).toContainEqual(['radialGradient.addColorStop', 1, 'rgba(0, 0, 255, 1)'])
    expect(target.calls).toContainEqual(['fillRect', 0, 0, 10, 10])
  })

  test('applies path gradient transforms and isotropic focus scales to radial geometry', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'brush',
        type: 'pathGradient',
        transform: [1, 0, 0, 1, 10, 20],
        focusScale: { x: 0.5, y: 0.5 },
        centerColor: 'rgba(255, 0, 0, 1)',
        centerPoint: { x: 5, y: 5 },
        surroundingColors: ['rgba(0, 0, 255, 1)']
      }
    )

    const gradientCall = target.calls.find((entry) => entry[0] === 'createRadialGradient')

    expect(gradientCall.slice(1, 6)).toEqual([15, 25, Math.sqrt(50) / 2, 15, 25])
    expect(gradientCall[6]).toBeCloseTo(Math.sqrt(50))
  })

  test('resolves texture brushes into canvas patterns before filling geometry', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const imageSource = { width: 4, height: 5 }

    backend.fillRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'brush',
        type: 'texture',
        wrapMode: 'clamp',
        transform: [1, 0, 0, 1, 2, 3],
        image: { canvas: imageSource }
      }
    )

    expect(target.calls).toContainEqual(['createPattern', imageSource, 'no-repeat'])
    expect(target.calls).toContainEqual([
      'pattern.setTransform',
      { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }
    ])
    expect(target.calls).toContainEqual(['fillRect', 0, 0, 10, 10])
  })

  test('builds mirrored texture pattern surfaces for tileFlipXY brushes', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const imageSource = { width: 4, height: 3, __canvasBackendImageSource: true }
    const tileCalls = []
    let tiledSurface = null

    backend.createSurface = (width, height) => {
      tiledSurface = {
        width,
        height,
        __canvasBackendImageSource: true,
        getContext() {
          return {
            clearRect(...args) {
              tileCalls.push(['clearRect', ...args])
            },
            save() {
              tileCalls.push(['save'])
            },
            restore() {
              tileCalls.push(['restore'])
            },
            setTransform(...args) {
              tileCalls.push(['setTransform', ...args])
            },
            drawImage(...args) {
              tileCalls.push(['drawImage', ...args])
            }
          }
        }
      }

      return tiledSurface
    }

    backend.fillRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'brush',
        type: 'texture',
        wrapMode: 'tileFlipXY',
        image: { canvas: imageSource }
      }
    )

    expect(tiledSurface).not.toBeNull()
    expect(tiledSurface.width).toBe(8)
    expect(tiledSurface.height).toBe(6)
    expect(tileCalls).toEqual([
      ['clearRect', 0, 0, 8, 6],
      ['drawImage', imageSource, 0, 0],
      ['save'],
      ['setTransform', -1, 0, 0, 1, 8, 0],
      ['drawImage', imageSource, 0, 0],
      ['restore'],
      ['save'],
      ['setTransform', 1, 0, 0, -1, 0, 6],
      ['drawImage', imageSource, 0, 0],
      ['restore'],
      ['save'],
      ['setTransform', -1, 0, 0, -1, 8, 6],
      ['drawImage', imageSource, 0, 0],
      ['restore']
    ])
    expect(target.calls).toContainEqual(['createPattern', tiledSurface, 'repeat'])
    expect(target.calls).toContainEqual(['fillRect', 0, 0, 10, 10])
  })

  test('applies extended pen stroke state including caps, joins, and dash patterns', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 3,
        color: 'rgb(255, 0, 0)',
        lineCap: 'square',
        lineJoin: 'round',
        dashOffset: 1.25,
        dashPattern: [2, 1, 0.5],
        miterLimit: 9.5
      }
    )

    expect(target.calls).toContainEqual(['setLineDash', [2, 1, 0.5]])
    expect(target.calls).toContainEqual(['strokeRect', 10, 20, 100, 50])
    expect(backend.ctx.lineCap).toBe('square')
    expect(backend.ctx.lineJoin).toBe('round')
    expect(backend.ctx.lineDashOffset).toBe(1.25)
    expect(backend.ctx.miterLimit).toBe(9.5)
  })

  test('scales EMF+ custom dash patterns by pen width', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 4,
        color: 'rgb(255, 0, 0)',
        dashPattern: [4, 2, 1, 2],
        dashPatternUnit: 'penWidth'
      }
    )

    expect(target.calls).toContainEqual(['setLineDash', [16, 8, 4, 8]])

    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 0.5,
        color: 'rgb(255, 0, 0)',
        dashPattern: [4, 2],
        dashPatternUnit: 'penWidth'
      }
    )

    expect(target.calls).toContainEqual(['setLineDash', [2, 1]])
  })

  test('insets EMF+ aligned rectangle strokes', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 8,
        color: 'rgb(255, 0, 0)',
        alignment: 1
      }
    )

    expect(target.calls).toContainEqual(['strokeRect', 14, 24, 92, 42])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('insets EMF+ aligned ellipse strokes', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeEllipse(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 8,
        color: 'rgb(255, 0, 0)',
        alignment: 1
      }
    )

    expect(target.calls).toContainEqual(['ellipse', 60, 45, 46, 21, 0, 0, Math.PI * 2])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('approximates dashCap through Canvas lineCap for dashed strokes without explicit caps', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [3, 1],
        dashCap: 'round'
      }
    )

    expect(backend.ctx.lineCap).toBe('round')

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        lineCap: 'square',
        dashPattern: [3, 1],
        dashCap: 'round'
      }
    )

    expect(backend.ctx.lineCap).toBe('square')

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashStyle: 'custom',
        dashCap: 'round'
      }
    )

    expect(backend.ctx.lineCap).toBe('butt')
  })

  test('warns and falls back for EMF+ triangle dash caps', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [3, 1],
        dashCap: 'triangle',
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual([
      'Canvas backend cannot render EMF+ DashCapTriangle; drawing dashed stroke with butt dash caps'
    ])
    expect(backend.ctx.lineCap).toBe('butt')
    expect(target.calls).toContainEqual(['setLineDash', [3, 1]])
  })

  test('draws EMF+ triangle dash caps for simple lines', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [3, 1],
        dashCap: 'triangle',
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([
      ['moveTo', 0, 0],
      ['moveTo', 0, 0],
      ['moveTo', 3, 0],
      ['moveTo', 4, 0],
      ['moveTo', 4, 0],
      ['moveTo', 7, 0],
      ['moveTo', 8, 0],
      ['moveTo', 8, 0],
      ['moveTo', 10, 0]
    ])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 3, 0],
      ['lineTo', 2, -1],
      ['lineTo', 2, 1],
      ['lineTo', 1, 1],
      ['lineTo', 1, -1],
      ['lineTo', 7, 0],
      ['lineTo', 6, -1],
      ['lineTo', 6, 1],
      ['lineTo', 5, 1],
      ['lineTo', 5, -1],
      ['lineTo', 10, 0],
      ['lineTo', 10, -1],
      ['lineTo', 10, 1],
      ['lineTo', 8, 1],
      ['lineTo', 8, -1]
    ])
    expect(target.calls.filter((call) => call[0] === 'fill')).toEqual([
      ['fill', undefined],
      ['fill', undefined],
      ['fill', undefined],
      ['fill', undefined],
      ['fill', undefined],
      ['fill', undefined]
    ])
    expect(target.calls.filter((call) => call[0] === 'setLineDash')).toEqual([
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []]
    ])
  })

  test('does not fall back when triangle dash offsets leave no visible line dashes', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [3, 3],
        dashOffset: 4,
        dashCap: 'triangle',
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'fill')).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'setLineDash')).toEqual([])
  })

  test('applies uniform pen transforms once for triangle dash caps', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [2, 1],
        dashCap: 'triangle',
        transform: [2, 0, 0, 2, 0, 0],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([
      ['moveTo', 0, 0],
      ['moveTo', 0, 0],
      ['moveTo', 4, 0],
      ['moveTo', 6, 0],
      ['moveTo', 6, 0],
      ['moveTo', 10, 0]
    ])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 4, 0],
      ['lineTo', 4, -2],
      ['lineTo', 4, 2],
      ['lineTo', 0, 2],
      ['lineTo', 0, -2],
      ['lineTo', 10, 0],
      ['lineTo', 10, -2],
      ['lineTo', 10, 2],
      ['lineTo', 6, 2],
      ['lineTo', 6, -2]
    ])
    expect(backend.ctx.lineWidth).toBeUndefined()
  })

  test('draws EMF+ triangle dash caps for simple stroke paths', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      dashPattern: [3, 1],
      dashCap: 'triangle',
      addWarning(message) {
        warnings.push(message)
      }
    })

    expect(warnings).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'fill')).toHaveLength(6)
    expect(target.calls.filter((call) => call[0] === 'setLineDash')).toEqual([
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []],
      ['setLineDash', []]
    ])
  })

  test('applies uniform pen transforms to stroke width and dash metrics', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashOffset: 1.5,
        dashPattern: [3, 1],
        transform: [2, 0, 0, 2, 0, 0],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(backend.ctx.lineWidth).toBe(4)
    expect(backend.ctx.lineDashOffset).toBe(3)
    expect(target.calls).toContainEqual(['setLineDash', [6, 2]])
    expect(warnings).toEqual([])
  })

  test('applies pen transforms once to pen-width-relative EMF+ dash patterns', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        dashPattern: [3, 1],
        dashPatternUnit: 'penWidth',
        transform: [2, 0, 0, 2, 0, 0]
      }
    )

    expect(backend.ctx.lineWidth).toBe(4)
    expect(target.calls).toContainEqual(['setLineDash', [12, 4]])
  })

  test('warns once for non-uniform pen transforms while drawing with unscaled stroke metrics', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const pen = {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      dashPattern: [3, 1],
      transform: [2, 0, 0, 3, 0, 0],
      addWarning(message) {
        warnings.push(message)
      }
    }

    backend.strokeRect({ left: 0, top: 0, right: 10, bottom: 10 }, pen)
    backend.strokeRect({ left: 20, top: 0, right: 30, bottom: 10 }, pen)

    expect(backend.ctx.lineWidth).toBe(2)
    expect(target.calls).toContainEqual(['setLineDash', [3, 1]])
    expect(warnings).toEqual([
      'Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics'
    ])
  })

  test('warns for rotated or sheared pen transforms while keeping deterministic metrics', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.strokeRect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        kind: 'pen',
        width: 2,
        color: 'rgb(0, 0, 0)',
        transform: [0, 1, -1, 0, 0, 0],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(backend.ctx.lineWidth).toBe(2)
    expect(warnings).toEqual([
      'Canvas backend ignores rotated or sheared EMF+ pen transforms for stroke width and dash metrics'
    ])
  })

  test('expands EMF+ compound line strokes for rectangles', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.strokeRect(
      { left: 10, top: 20, right: 110, bottom: 70 },
      {
        kind: 'pen',
        width: 10,
        color: 'rgb(255, 0, 0)',
        compoundArray: [0, 0.25, 0.75, 1]
      }
    )

    expect(target.calls.filter((call) => call[0] === 'strokeRect')).toEqual([
      ['strokeRect', 6.25, 16.25, 107.5, 57.5],
      ['strokeRect', 13.75, 23.75, 92.5, 42.5]
    ])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
    expect(backend.ctx.lineWidth).toBeUndefined()
    expect(target.calls.filter((call) => call[0] === 'save')).toHaveLength(2)
    expect(target.calls.filter((call) => call[0] === 'restore')).toHaveLength(2)
  })

  test('expands EMF+ compound line strokes along the line normal', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      {
        kind: 'pen',
        width: 8,
        color: 'rgb(255, 0, 0)',
        compoundArray: [0, 0.5, 0.75, 1]
      }
    )

    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
    expect(backend.ctx.lineWidth).toBeUndefined()
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([
      ['moveTo', 2, 0],
      ['moveTo', -3, 0]
    ])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 2, 10],
      ['lineTo', -3, 10]
    ])
  })

  test('expands EMF+ compound line strokes for open polylines', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1]
    })

    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
    expect(backend.ctx.lineWidth).toBeUndefined()
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([
      ['moveTo', 0, -2],
      ['moveTo', 0, 3]
    ])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 12, -2],
      ['lineTo', 12, 10],
      ['lineTo', 7, 3],
      ['lineTo', 7, 10]
    ])
  })

  test('expands EMF+ compound line strokes for simple closed paths', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: true,
          points: [
            { x: 10, y: 0 },
            { x: 20, y: 10 },
            { x: 10, y: 20 },
            { x: 0, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1]
    })

    const moveToCalls = target.calls.filter((call) => call[0] === 'moveTo')
    const lineToCalls = target.calls.filter((call) => call[0] === 'lineTo')

    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke']])
    expect(target.calls.filter((call) => call[0] === 'closePath')).toEqual([['closePath'], ['closePath']])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
    expect(backend.ctx.lineWidth).toBeUndefined()
    expect(moveToCalls).toHaveLength(2)
    expect(lineToCalls).toHaveLength(6)

    expect(moveToCalls[0][1]).toBeCloseTo(10)
    expect(moveToCalls[0][2]).toBeCloseTo(-Math.SQRT2 * 2)
    expect(lineToCalls[0][1]).toBeCloseTo(20 + Math.SQRT2 * 2)
    expect(lineToCalls[0][2]).toBeCloseTo(10)
    expect(lineToCalls[1][1]).toBeCloseTo(10)
    expect(lineToCalls[1][2]).toBeCloseTo(20 + Math.SQRT2 * 2)
    expect(lineToCalls[2][1]).toBeCloseTo(-Math.SQRT2 * 2)
    expect(lineToCalls[2][2]).toBeCloseTo(10)

    expect(moveToCalls[1][1]).toBeCloseTo(10)
    expect(moveToCalls[1][2]).toBeCloseTo(Math.SQRT2 * 3)
    expect(lineToCalls[3][1]).toBeCloseTo(20 - Math.SQRT2 * 3)
    expect(lineToCalls[3][2]).toBeCloseTo(10)
    expect(lineToCalls[4][1]).toBeCloseTo(10)
    expect(lineToCalls[4][2]).toBeCloseTo(20 - Math.SQRT2 * 3)
    expect(lineToCalls[5][1]).toBeCloseTo(Math.SQRT2 * 3)
    expect(lineToCalls[5][2]).toBeCloseTo(10)
  })

  test('warns and falls back for reversing compound polylines', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 0 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1],
      addWarning(message) {
        warnings.push(message)
      }
    })

    expect(warnings).toEqual(['Canvas backend cannot offset complex EMF+ compound paths; drawing a single stroke'])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([['moveTo', 0, 0]])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 10, 0],
      ['lineTo', 0, 0]
    ])
  })

  test('keeps pen transform diagnostics for expanded compound strokes', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      {
        kind: 'pen',
        width: 8,
        color: 'rgb(255, 0, 0)',
        compoundArray: [0, 0.5, 0.75, 1],
        transform: [2, 0, 0, 3, 0, 0],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke'], ['stroke']])
    expect(warnings).toEqual([
      'Canvas backend ignores non-uniform EMF+ pen transforms for stroke width and dash metrics'
    ])
  })

  test('warns and falls back for compound strokes with custom caps', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1],
      addWarning(message) {
        warnings.push(message)
      },
      customEndCap: {
        kind: 'customLineCap',
        type: 'adjustableArrow',
        width: 4,
        height: 3,
        fillState: true
      }
    })

    expect(warnings).toEqual([
      'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
    ])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'fill')).toEqual([['fill', undefined]])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
  })

  test('warns and falls back for closed compound paths with custom caps', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 },
            { x: 0, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1],
      addWarning(message) {
        warnings.push(message)
      },
      customEndCap: {
        kind: 'customLineCap',
        type: 'adjustableArrow',
        width: 4,
        height: 3,
        fillState: true
      }
    })

    expect(warnings).toEqual([
      'Canvas backend cannot combine EMF+ compound lines with custom line caps; drawing a single custom-capped stroke'
    ])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'fill')).toEqual([])
    expect(target.calls.filter((call) => call[0] === 'translate')).toEqual([])
  })

  test('warns and falls back for complex compound paths', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 }
          ],
          segments: [
            {
              type: 'bezier',
              control1: { x: 4, y: 0 },
              control2: { x: 10, y: 6 },
              point: { x: 10, y: 10 }
            }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 8,
      color: 'rgb(255, 0, 0)',
      compoundArray: [0, 0.5, 0.75, 1],
      addWarning(message) {
        warnings.push(message)
      }
    })

    expect(warnings).toEqual(['Canvas backend cannot offset complex EMF+ compound paths; drawing a single stroke'])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([['moveTo', 0, 0]])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 10, 10]
    ])
  })

  test('warns and falls back for invalid compound arrays', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      {
        kind: 'pen',
        width: 8,
        color: 'rgb(255, 0, 0)',
        compoundArray: [0.7, 0.2],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual(['Canvas backend ignores invalid EMF+ compound line data'])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([
      ['moveTo', 0, 0]
    ])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([
      ['lineTo', 10, 0]
    ])
  })

  test('maps default custom line caps to the canvas lineCap state', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      customEndCap: {
        kind: 'customLineCap',
        type: 'default',
        baseCap: 2
      }
    })

    expect(backend.ctx.lineCap).toBe('round')
    expect(target.calls).toContainEqual(['stroke'])
  })

  test('draws default custom line cap fill and line paths at open figure endpoints', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }
    const cap = {
      kind: 'customLineCap',
      type: 'default',
      widthScale: 1,
      strokeEndCap: 0,
      strokeJoin: 2,
      strokeMiterLimit: 8,
      fillHotSpot: { x: 1, y: 0 },
      lineHotSpot: { x: 2, y: 0 },
      fillPath: {
        figures: [
          {
            closed: true,
            points: [
              { x: 1, y: 0 },
              { x: -1, y: -1 },
              { x: -1, y: 1 }
            ]
          }
        ]
      },
      linePath: {
        figures: [
          {
            closed: false,
            points: [
              { x: 2, y: 0 },
              { x: -1, y: 0 }
            ]
          }
        ]
      }
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      customEndCap: cap
    })

    const strokeIndex = target.calls.findIndex((entry) => entry[0] === 'stroke')

    expect(target.calls.slice(strokeIndex + 1)).toEqual([
      ['save'],
      ['beginPath'],
      ['moveTo', 10, 0],
      ['lineTo', 6, -2],
      ['lineTo', 6, 2],
      ['closePath'],
      ['fill', 'nonzero'],
      ['beginPath'],
      ['moveTo', 10, 0],
      ['lineTo', 4, 0],
      ['setLineDash', []],
      ['stroke'],
      ['restore']
    ])
  })

  test('applies default custom line cap base inset along the endpoint direction', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      customEndCap: {
        kind: 'customLineCap',
        type: 'default',
        widthScale: 1,
        baseInset: 1.5,
        fillPath: {
          figures: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: -1, y: -1 },
                { x: -1, y: 1 }
              ]
            }
          ]
        }
      }
    })

    const strokeIndex = target.calls.findIndex((entry) => entry[0] === 'stroke')

    expect(target.calls.slice(strokeIndex + 1)).toEqual([
      ['save'],
      ['beginPath'],
      ['moveTo', 13, 0],
      ['lineTo', 11, -2],
      ['lineTo', 11, 2],
      ['closePath'],
      ['fill', 'nonzero'],
      ['restore']
    ])
  })

  test('orients default custom line cap paths at vertical start points', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(0, 0, 0)',
      customStartCap: {
        kind: 'customLineCap',
        type: 'default',
        widthScale: 1,
        baseInset: 1,
        fillHotSpot: { x: 1, y: 0 },
        fillPath: {
          figures: [
            {
              closed: true,
              points: [
                { x: 1, y: 0 },
                { x: -1, y: -1 },
                { x: -1, y: 1 }
              ]
            }
          ]
        }
      }
    })

    const strokeIndex = target.calls.findIndex((entry) => entry[0] === 'stroke')

    expect(target.calls.slice(strokeIndex + 1)).toEqual([
      ['save'],
      ['beginPath'],
      ['moveTo', 0, -2],
      ['lineTo', -2, 2],
      ['lineTo', 2, 2],
      ['closePath'],
      ['fill', 'nonzero'],
      ['restore']
    ])
  })

  test('draws adjustable arrow custom caps after stroking open figures', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 }
          ]
        }
      ]
    }
    const arrowCap = {
      kind: 'customLineCap',
      type: 'adjustableArrow',
      width: 4,
      height: 3,
      middleInset: 1,
      fillState: true,
      lineJoin: 1,
      lineMiterLimit: 6,
      widthScale: 1
    }

    backend.strokePath(path, {
      kind: 'pen',
      width: 2,
      color: 'rgb(255, 0, 0)',
      customStartCap: arrowCap,
      customEndCap: arrowCap
    })

    const strokeIndex = target.calls.findIndex((entry) => entry[0] === 'stroke')

    expect(target.calls.slice(strokeIndex + 1)).toEqual([
      ['save'],
      ['setLineDash', []],
      ['beginPath'],
      ['moveTo', 0, 0],
      ['lineTo', 6, -4],
      ['lineTo', 4, 0],
      ['lineTo', 6, 4],
      ['closePath'],
      ['fill', undefined],
      ['restore'],
      ['save'],
      ['setLineDash', []],
      ['beginPath'],
      ['moveTo', 10, 0],
      ['lineTo', 4, 4],
      ['lineTo', 6, 0],
      ['lineTo', 4, -4],
      ['closePath'],
      ['fill', undefined],
      ['restore']
    ])
    expect(target.stackDepth).toBe(0)
  })

  test('does not create an implicit canvas state frame when clipping', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.save()
    backend.clipRect({ x: 5, y: 6, width: 70, height: 80 }, 'intersect')
    backend.restore()

    expect(target.calls).toEqual([
      ['save'],
      ['beginPath'],
      ['rect', 5, 6, 70, 80],
      ['clip'],
      ['restore']
    ])
    expect(target.stackDepth).toBe(0)
  })

  test('rebuilds the active clip from the current frame baseline when setClip is called repeatedly', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.save()
    backend.setTransform([2, 0, 0, 2, 10, 20])
    backend.setClip({
      kind: 'geometry',
      mode: 'replace',
      geometry: [
        [
          [
            [1, 2],
            [4, 2],
            [4, 6],
            [1, 6],
            [1, 2]
          ]
        ]
      ]
    })
    backend.setClip({
      kind: 'geometry',
      mode: 'replace',
      geometry: [
        [
          [
            [10, 11],
            [14, 11],
            [14, 15],
            [10, 15],
            [10, 11]
          ]
        ]
      ]
    })
    backend.setClip(null)
    backend.restore()

    expect(target.calls).toEqual([
      ['save'],
      ['setTransform', 2, 0, 0, 2, 10, 20],
      ['save'],
      ['restore'],
      ['save'],
      ['setTransform', 2, 0, 0, 2, 10, 20],
      ['beginPath'],
      ['moveTo', 1, 2],
      ['lineTo', 4, 2],
      ['lineTo', 4, 6],
      ['lineTo', 1, 6],
      ['closePath'],
      ['clip', 'evenodd'],
      ['restore'],
      ['save'],
      ['setTransform', 2, 0, 0, 2, 10, 20],
      ['beginPath'],
      ['moveTo', 10, 11],
      ['lineTo', 14, 11],
      ['lineTo', 14, 15],
      ['lineTo', 10, 15],
      ['closePath'],
      ['clip', 'evenodd'],
      ['restore'],
      ['save'],
      ['setTransform', 2, 0, 0, 2, 10, 20],
      ['restore'],
      ['restore']
    ])
    expect(target.stackDepth).toBe(0)
  })

  test('renders shared path geometry for fill and stroke without forcing open figures closed', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: true,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 }
          ]
        },
        {
          closed: false,
          points: [
            { x: 5, y: 6 },
            { x: 7, y: 8 }
          ]
        }
      ]
    }

    backend.fillPath(path, { color: 'rgb(0, 255, 0)' }, { fillMode: 'alternate' })
    backend.strokePath(path, { color: 'rgb(255, 0, 0)', width: 3, miterLimit: 9 })

    expect(target.calls).toEqual([
      ['beginPath'],
      ['moveTo', 1, 2],
      ['lineTo', 3, 4],
      ['closePath'],
      ['moveTo', 5, 6],
      ['lineTo', 7, 8],
      ['fill', 'evenodd'],
      ['beginPath'],
      ['moveTo', 1, 2],
      ['lineTo', 3, 4],
      ['closePath'],
      ['moveTo', 5, 6],
      ['lineTo', 7, 8],
      ['setLineDash', []],
      ['stroke']
    ])
    expect(backend.ctx.fillStyle).toBe('rgb(0, 255, 0)')
    expect(backend.ctx.strokeStyle).toBe('rgb(255, 0, 0)')
    expect(backend.ctx.lineWidth).toBe(3)
    expect(backend.ctx.miterLimit).toBe(9)
  })

  test('insets EMF+ aligned simple closed paths', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 },
            { x: 0, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      color: 'rgb(255, 0, 0)',
      width: 8,
      alignment: 1
    })

    expect(target.calls).toEqual([
      ['beginPath'],
      ['moveTo', 4, 4],
      ['lineTo', 16, 4],
      ['lineTo', 16, 6],
      ['lineTo', 4, 6],
      ['closePath'],
      ['setLineDash', []],
      ['stroke']
    ])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('warns and falls back for inset-aligned complex paths', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []
    const path = {
      figures: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 }
          ]
        }
      ]
    }

    backend.strokePath(path, {
      color: 'rgb(255, 0, 0)',
      width: 8,
      alignment: 1,
      addWarning(message) {
        warnings.push(message)
      }
    })

    expect(warnings).toEqual(['Canvas backend cannot inset complex EMF+ pen-aligned paths; drawing centered stroke'])
    expect(target.calls).toEqual([
      ['beginPath'],
      ['moveTo', 0, 0],
      ['lineTo', 20, 0],
      ['lineTo', 20, 10],
      ['setLineDash', []],
      ['stroke']
    ])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('warns and falls back for inset-aligned open lines', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      {
        color: 'rgb(255, 0, 0)',
        width: 8,
        alignment: 1,
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual(['Canvas backend cannot inset open EMF+ pen-aligned lines; drawing centered stroke'])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([['moveTo', 0, 0]])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([['lineTo', 20, 0]])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('warns and falls back for inset-aligned compound lines', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawLine(
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      {
        color: 'rgb(255, 0, 0)',
        width: 8,
        alignment: 1,
        compoundArray: [0, 0.5, 0.75, 1],
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(warnings).toEqual([
      'Canvas backend cannot combine EMF+ inset pen alignment with compound lines; drawing centered stroke'
    ])
    expect(target.calls.filter((call) => call[0] === 'stroke')).toEqual([['stroke']])
    expect(target.calls.filter((call) => call[0] === 'moveTo')).toEqual([['moveTo', 0, 0]])
    expect(target.calls.filter((call) => call[0] === 'lineTo')).toEqual([['lineTo', 20, 0]])
    expect(backend.ctx.lineWidth).toBe(8)
  })

  test('fills polygon clipping geometry through the shared evenodd path pipeline', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.fillGeometry(
      [
        [
          [
            [1, 2],
            [5, 2],
            [5, 6],
            [1, 6],
            [1, 2]
          ]
        ]
      ],
      { kind: 'brush', type: 'solid', color: 'rgb(0, 255, 0)' },
      { fillMode: 'alternate' }
    )

    expect(target.calls).toEqual([
      ['beginPath'],
      ['moveTo', 1, 2],
      ['lineTo', 5, 2],
      ['lineTo', 5, 6],
      ['lineTo', 1, 6],
      ['closePath'],
      ['fill', 'evenodd']
    ])
  })

  test('draws text using decoded font, brush, and string-format alignment', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'Hello',
      { x: 10, y: 20, width: 100, height: 30 },
      { cssFont: 'italic bold 18px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { textAlign: 'center', textBaseline: 'bottom' }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'Hello', 60, 50]
    ])
    expect(backend.ctx.font).toBe('italic bold 18px Arial')
    expect(backend.ctx.fillStyle).toBe('rgb(1, 2, 3)')
    expect(backend.ctx.textAlign).toBe('center')
    expect(backend.ctx.textBaseline).toBe('bottom')
  })

  test('preserves explicit Canvas text maxWidth opt-in', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'abcdef',
      { x: 0, y: 0, width: 24, height: 12 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { maxWidth: 30, trimming: 1 }
    )

    expect(target.calls).toEqual([
      ['fillText', 'abcdef', 0, 0, 30]
    ])
  })

  test('applies EMF+ leading and trailing margins to the effective text layout width', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'Hello',
      { x: 10, y: 20, width: 100, height: 30 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { textAlign: 'right', leadingMargin: 1, trailingMargin: 2 }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'Hello', 90, 20]
    ])
  })

  test('applies EMF+ RTL leading margin from the physical right edge', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'Hello',
      { x: 10, y: 20, width: 100, height: 30 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { directionRightToLeft: true, textAlign: 'right', leadingMargin: 1, trailingMargin: 2 }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'Hello', 100, 20]
    ])
  })

  test('draws explicit multi-line text at stable line-height offsets', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'One\r\nTwo\nThree',
      { x: 10, y: 20, width: 120, height: 80 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { textAlign: 'left', textBaseline: 'top' }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'One', 10, 20],
      ['fillText', 'Two', 10, 32],
      ['fillText', 'Three', 10, 44]
    ])
  })

  test('expands tabs to deterministic layout columns before drawing text', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'A\tB',
      { x: 0, y: 0, width: 200, height: 20 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { firstTabOffset: 48 }
    )

    expect(target.calls.find((call) => call[0] === 'fillText')).toEqual(['fillText', 'A   B', 0, 0])
  })

  test('keeps hotkey underline ranges aligned after newline and tab expansion', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'A\nB\t&C',
      { x: 0, y: 0, width: 200, height: 40 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { hotkeyPrefix: 1, firstTabOffset: 48 }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'A', 0, 0],
      ['fillText', 'B   C', 0, 12]
    ])
    expect(target.calls.find((call) => call[0] === 'moveTo')).toEqual(['moveTo', 48, 13])
    expect(target.calls.find((call) => call[0] === 'lineTo')).toEqual(['lineTo', 60, 13])
  })

  test('wraps text by words within the layout rectangle width', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'aa bbb cc',
      { x: 0, y: 0, width: 48, height: 80 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {}
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'aa', 0, 0],
      ['fillText', 'bbb', 0, 12],
      ['fillText', 'cc', 0, 24]
    ])
  })

  test('wraps long words by grapheme when no word boundary fits', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'abcdef',
      { x: 0, y: 0, width: 24, height: 80 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {}
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'ab', 0, 0],
      ['fillText', 'cd', 0, 12],
      ['fillText', 'ef', 0, 24]
    ])
  })

  test('honors StringFormatFlags.NoWrap by keeping text on one line', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'aa bbb cc',
      { x: 0, y: 0, width: 48, height: 80 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { noWrap: true }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'aa bbb cc', 0, 0]
    ])
  })

  test('applies StringFormatFlags.LineLimit to wrapped text height', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawText(
      'aa bbb cc',
      { x: 0, y: 0, width: 48, height: 20 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {
        lineLimit: true,
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'aa', 0, 0]
    ])
    expect(warnings).toEqual(['Canvas backend approximates StringFormatFlags.LineLimit for wrapped or clipped text layout'])
  })

  test('skips wrapped text when LineLimit height cannot fit one line', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'aa bbb cc',
      { x: 0, y: 0, width: 48, height: 8 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { lineLimit: true }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([])
  })

  test('does not auto-wrap explicit newlines when trimming is active', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'abcdef\nuvwxyz',
      { x: 0, y: 0, width: 24, height: 80 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { trimming: 1 }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'ab', 0, 0],
      ['fillText', 'uv', 0, 12]
    ])
  })

  test('expands tabs before drawing without using raw tab width for wrapping', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'A\tB',
      { x: 0, y: 0, width: 24, height: 60 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { firstTabOffset: 48 }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'A   B', 0, 0]
    ])
  })

  test('draws spaced text as a glyph run when classic advance arrays are provided', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'ABC',
      { x: 10, y: 20, width: 0, height: 0 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {
        referencePoint: { x: 10, y: 20 },
        advanceDx: [
          { x: 7, y: 0 },
          { x: 8, y: 2 },
          { x: 9, y: 0 }
        ]
      }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'A', 10, 20],
      ['fillText', 'B', 17, 20],
      ['fillText', 'C', 25, 22]
    ])
  })

  test('applies EMF+ tracking and classic text justification to glyph advances', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'A B',
      { x: 0, y: 0, width: 120, height: 20 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {
        tracking: 2,
        textJustificationExtra: 6,
        textJustificationCount: 1
      }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'A', 0, 0],
      ['fillText', ' ', 14, 0],
      ['fillText', 'B', 34, 0]
    ])
  })

  test('uses Unicode word boundaries for word trimming without requiring spaces', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      '你好世界',
      { x: 0, y: 0, width: 24, height: 12 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { trimming: 2 }
    )

    expect(target.calls.find((call) => call[0] === 'fillText')).toEqual(['fillText', '你好', 0, 0])
  })

  test('maps RTL and vertical StringFormat flags into Canvas text placement', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const warnings = []

    backend.drawText(
      'AB',
      { x: 10, y: 20, width: 100, height: 40 },
      { cssFont: '10px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {
        directionRightToLeft: true,
        directionVertical: true,
        textAlign: 'right',
        addWarning(message) {
          warnings.push(message)
        }
      }
    )

    expect(target.calls.filter((call) => call[0] === 'fillText')).toEqual([
      ['fillText', 'A', 110, 20],
      ['fillText', 'B', 110, 30]
    ])
    expect(backend.ctx.direction).toBe('inherit')
    expect(warnings).toContain(
      'Canvas backend approximates StringFormatFlags.DirectionVertical with a top-to-bottom glyph run'
    )
  })

  test.each([
    ['None', 0, 'abcdef', 24, 'abcdef'],
    ['Character', 1, 'abcdef', 48, 'abcd'],
    ['Word', 2, 'aa bbb cc', 72, 'aa bbb'],
    ['EllipsisCharacter', 3, 'abcdef', 48, 'abc…'],
    ['EllipsisWord', 4, 'aa bbb cc', 84, 'aa bbb…'],
    ['EllipsisPath', 5, 'abcdef', 48, 'abc…']
  ])('applies StringTrimming.%s without Canvas maxWidth scaling', (_name, trimming, text, width, expectedText) => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      text,
      { x: 0, y: 0, width, height: 12 },
      { cssFont: '12px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { trimming, noWrap: true }
    )

    const fillText = target.calls.find((call) => call[0] === 'fillText')

    expect(fillText).toEqual(['fillText', expectedText, 0, 0])
  })

  test('draws HotkeyPrefix.Show underline only under the hotkey character', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawText(
      'E&xit && Save',
      { x: 0, y: 0, width: 200, height: 20 },
      { cssFont: '20px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { hotkeyPrefix: 1 }
    )

    expect(target.calls.find((call) => call[0] === 'fillText')).toEqual(['fillText', 'Exit & Save', 0, 0])
    expect(target.calls.find((call) => call[0] === 'moveTo')).toEqual(['moveTo', 12, 2])
    expect(target.calls.find((call) => call[0] === 'lineTo')).toEqual(['lineTo', 24, 2])
  })

  test('applies text transforms and font decorations when drawing text', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.setTransform([2, 0, 0, 2, 10, 20])
    target.calls.length = 0

    backend.drawText(
      'Hi',
      { x: 10, y: 20, width: 0, height: 0 },
      { css: '18px Arial', underline: true, strikeOut: true, height: -18 },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      {
        textAlign: 'left',
        textBaseline: 'alphabetic',
        referencePoint: { x: 15, y: 25 },
        transform: [0, -1, 1, 0, -10, 40]
      }
    )

    expect(target.calls).toEqual([
      ['save'],
      ['setTransform', 0, -2, 2, 0, -10, 100],
      ['fillText', 'Hi', 15, 25],
      ['measureText', 'Hi'],
      ['beginPath'],
      ['moveTo', 15, 26.8],
      ['lineTo', 39, 26.8],
      ['stroke'],
      ['beginPath'],
      ['moveTo', 15, 20.05],
      ['lineTo', 39, 20.05],
      ['stroke'],
      ['restore']
    ])
    expect(backend.ctx.font).toBe('18px Arial')
    expect(backend.ctx.strokeStyle).toBe('rgb(1, 2, 3)')
  })

  test('draws driver strings glyph-by-glyph at decoded positions', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.drawDriverString(
      'Hi',
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 }
      ],
      { cssFont: '18px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { realizedAdvance: false }
    )

    expect(target.calls).toEqual([
      ['fillText', 'H', 10, 20],
      ['fillText', 'i', 30, 40]
    ])
    expect(backend.ctx.font).toBe('18px Arial')
    expect(backend.ctx.fillStyle).toBe('rgb(1, 2, 3)')
    expect(backend.ctx.textAlign).toBe('left')
    expect(backend.ctx.textBaseline).toBe('alphabetic')
  })

  test('applies driver-string transforms before drawing realized-advance text', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    backend.setTransform([2, 0, 0, 2, 10, 20])
    target.calls.length = 0

    backend.drawDriverString(
      'Hi',
      [{ x: 5, y: 7 }],
      { cssFont: '18px Arial' },
      { kind: 'brush', type: 'solid', color: 'rgb(1, 2, 3)' },
      { realizedAdvance: true },
      [1, 0, 0, 1, 3, 4]
    )

    expect(target.calls).toEqual([
      ['save'],
      ['setTransform', 2, 0, 0, 2, 16, 28],
      ['fillText', 'Hi', 5, 7],
      ['restore']
    ])
  })

  test('marks fallback surfaces as non-drawable image sources and refuses to draw them', () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas
    const originalDocument = globalThis.document
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)

    Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
    Reflect.deleteProperty(globalThis, 'document')

    try {
      const surface = backend.createSurface(12, 13)

      backend.drawImageRect(
        { canvas: surface },
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 0, y: 0, width: 3, height: 4 }
      )

      expect(surface.__canvasBackendImageSource).toBe(false)
      expect(target.calls.filter((call) => call[0] === 'drawImage')).toEqual([])
    } finally {
      if (originalOffscreenCanvas) {
        globalThis.OffscreenCanvas = originalOffscreenCanvas
      }

      if (originalDocument) {
        globalThis.document = originalDocument
      }
    }
  })

  test('applies classic stretch mode smoothing only around image draws', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = { width: 2, height: 2 }

    backend.ctx.imageSmoothingEnabled = true
    backend.ctx.imageSmoothingQuality = 'medium'
    backend.ctx.drawImage = (...args) => {
      target.calls.push(['drawImageWithSmoothing', backend.ctx.imageSmoothingEnabled, backend.ctx.imageSmoothingQuality, ...args])
    }

    backend.drawImageRect(
      { kind: 'image', canvas: source, width: 2, height: 2 },
      { x: 10, y: 20, width: 30, height: 40 },
      null,
      { stretchMode: 3 }
    )
    backend.drawImageRect(
      { kind: 'image', canvas: source, width: 2, height: 2 },
      { x: 10, y: 20, width: 30, height: 40 },
      null,
      { stretchMode: 4 }
    )
    backend.drawImageParallelogram(
      { kind: 'image', canvas: source, width: 2, height: 2 },
      [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
        { x: 10, y: 40 }
      ],
      null,
      { stretchMode: 3 }
    )
    backend.drawImageParallelogram(
      { kind: 'image', canvas: source, width: 2, height: 2 },
      [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
        { x: 10, y: 40 }
      ],
      null,
      { stretchMode: 4 }
    )

    expect(target.calls.filter((call) => call[0] === 'drawImageWithSmoothing')).toEqual([
      ['drawImageWithSmoothing', false, 'low', source, 10, 20, 30, 40],
      ['drawImageWithSmoothing', true, 'high', source, 10, 20, 30, 40],
      ['drawImageWithSmoothing', false, 'low', source, 0, 0],
      ['drawImageWithSmoothing', true, 'high', source, 0, 0]
    ])
    expect(backend.ctx.imageSmoothingEnabled).toBe(true)
    expect(backend.ctx.imageSmoothingQuality).toBe('medium')
  })

  test('restores parallelogram image canvas state when drawImage throws', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = { width: 2, height: 2 }

    backend.ctx.imageSmoothingEnabled = true
    backend.ctx.imageSmoothingQuality = 'medium'
    backend.ctx.drawImage = () => {
      throw new Error('draw failed')
    }

    expect(() =>
      backend.drawImageParallelogram(
        { kind: 'image', canvas: source, width: 2, height: 2 },
        [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
          { x: 10, y: 40 }
        ],
        null,
        { stretchMode: 3 }
      )
    ).toThrow('draw failed')

    expect(target.stackDepth).toBe(0)
    expect(target.calls).toContainEqual(['restore'])
    expect(backend.ctx.imageSmoothingEnabled).toBe(true)
    expect(backend.ctx.imageSmoothingQuality).toBe('medium')
  })

  test('pads wrapped image sources when image attributes request tiled sampling', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 8,
      height: 6,
      __canvasBackendImageSource: true
    }
    const wrappedCalls = []
    let wrappedSurface = null

    backend.createSurface = (width, height) => {
      wrappedSurface = {
        width,
        height,
        __canvasBackendImageSource: true,
        getContext() {
          return {
            clearRect(...args) {
              wrappedCalls.push(['clearRect', ...args])
            },
            drawImage(...args) {
              wrappedCalls.push(['drawImage', ...args])
            }
          }
        }
      }

      return wrappedSurface
    }

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 1, y: 2, width: 4, height: 3 },
      { kind: 'imageAttributes', wrapMode: 'tile' }
    )

    expect(wrappedSurface).not.toBeNull()
    expect(wrappedSurface.width).toBe(6)
    expect(wrappedSurface.height).toBe(5)
    expect(wrappedSurface.__canvasBackendImageSource).toBe(true)
    expect(wrappedCalls).toContainEqual(['clearRect', 0, 0, 6, 5])
    expect(wrappedCalls.filter((call) => call[0] === 'drawImage')).toEqual([
      ['drawImage', source, 1, 2, 4, 3, 1, 1, 4, 3],
      ['drawImage', source, 4, 2, 1, 3, 0, 1, 1, 3],
      ['drawImage', source, 1, 2, 1, 3, 5, 1, 1, 3],
      ['drawImage', source, 1, 4, 4, 1, 1, 0, 4, 1],
      ['drawImage', source, 1, 2, 4, 1, 1, 4, 4, 1],
      ['drawImage', source, 4, 4, 1, 1, 0, 0, 1, 1],
      ['drawImage', source, 1, 4, 1, 1, 5, 0, 1, 1],
      ['drawImage', source, 4, 2, 1, 1, 0, 4, 1, 1],
      ['drawImage', source, 1, 2, 1, 1, 5, 4, 1, 1]
    ])
    expect(target.calls).toEqual([
      ['drawImage', wrappedSurface, 1, 1, 4, 3, 10, 11, 20, 21]
    ])
  })

  test('fills clamp padding with the image-attributes wrap color before drawing', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 8,
      height: 6,
      __canvasBackendImageSource: true
    }
    const wrappedCalls = []
    let wrappedContext = null

    backend.createSurface = (width, height) => ({
      width,
      height,
      __canvasBackendImageSource: true,
      getContext() {
        wrappedContext = {
          fillStyle: null,
          clearRect(...args) {
            wrappedCalls.push(['clearRect', ...args])
          },
          fillRect(...args) {
            wrappedCalls.push(['fillRect', ...args, this.fillStyle])
          },
          drawImage(...args) {
            wrappedCalls.push(['drawImage', ...args])
          }
        }

        return wrappedContext
      }
    })

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 1, y: 2, width: 4, height: 3 },
      {
        kind: 'imageAttributes',
        wrapMode: 'clamp',
        wrapColor: 'rgba(10, 20, 30, 0.5)',
        clamp: true,
        objectClamp: true
      }
    )

    expect(wrappedCalls).toContainEqual(['fillRect', 0, 0, 6, 5, 'rgba(10, 20, 30, 0.5)'])
    expect(wrappedCalls).toContainEqual(['drawImage', source, 1, 2, 4, 3, 1, 1, 4, 3])
  })

  test('maps cropped images into a destination parallelogram with the active transform', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 100,
      height: 50,
      __canvasBackendImageSource: true
    }

    backend.setTransform([2, 0, 0, 3, 10, 20])
    backend.drawImageParallelogram(
      { canvas: source },
      [
        { x: 5, y: 7 },
        { x: 25, y: 13 },
        { x: 9, y: 27 }
      ],
      { x: 1, y: 2, width: 40, height: 10 }
    )

    expect(target.calls).toEqual([
      ['setTransform', 2, 0, 0, 3, 10, 20],
      ['save'],
      ['setTransform', 1, 0.44999999999999996, 0.8, 6, 20, 41],
      ['drawImage', source, 1, 2, 40, 10, 0, 0, 40, 10],
      ['restore']
    ])
  })

  test('applies color-matrix effects before drawing image rectangles', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 1,
      height: 1,
      __canvasBackendImageSource: true,
      __pixels: new Uint8ClampedArray([255, 0, 0, 255])
    }
    let effectSurface = null

    backend.createSurface = (width, height) => {
      const surface = {
        width,
        height,
        __canvasBackendImageSource: true,
        __pixels: new Uint8ClampedArray(width * height * 4),
        getContext() {
          return {
            drawImage(image) {
              surface.__pixels.set(image.__pixels)
            },
            getImageData() {
              return {
                width,
                height,
                data: surface.__pixels.slice()
              }
            },
            putImageData(imageData) {
              surface.__pixels.set(imageData.data)
            }
          }
        }
      }

      effectSurface = surface
      return surface
    }

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      {
        kind: 'effect',
        type: 'colorMatrix',
        matrix: [
          [0, 0, 1, 0, 0],
          [0, 1, 0, 0, 0],
          [1, 0, 0, 0, 0],
          [0, 0, 0, 1, 0],
          [0, 0, 0, 0, 1]
        ]
      }
    )

    expect(Array.from(effectSurface.__pixels)).toEqual([0, 0, 255, 255])
    expect(target.calls).toEqual([
      ['drawImage', effectSurface, 0, 0, 1, 1, 10, 11, 20, 21]
    ])
  })

  test('applies color-matrix fifth-row channel offsets', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 1,
      height: 1,
      __canvasBackendImageSource: true,
      __pixels: new Uint8ClampedArray([100, 100, 100, 255])
    }
    let effectSurface = null

    backend.createSurface = (width, height) => {
      const surface = {
        width,
        height,
        __canvasBackendImageSource: true,
        __pixels: new Uint8ClampedArray(width * height * 4),
        getContext() {
          return {
            drawImage(image) {
              surface.__pixels.set(image.__pixels)
            },
            getImageData() {
              return {
                width,
                height,
                data: surface.__pixels.slice()
              }
            },
            putImageData(imageData) {
              surface.__pixels.set(imageData.data)
            }
          }
        }
      }

      effectSurface = surface
      return surface
    }

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      {
        kind: 'effect',
        type: 'colorMatrix',
        matrix: [
          [1, 0, 0, 0, 0],
          [0, 1, 0, 0, 0],
          [0, 0, 1, 0, 0],
          [0, 0, 0, 1, 0],
          [0.2, 0.1, -0.2, 0, 1]
        ]
      }
    )

    expect(Array.from(effectSurface.__pixels)).toEqual([151, 126, 49, 255])
  })

  test('applies brightness-contrast effects before drawing image rectangles', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 1,
      height: 1,
      __canvasBackendImageSource: true,
      __pixels: new Uint8ClampedArray([100, 140, 180, 255])
    }
    let effectSurface = null

    backend.createSurface = (width, height) => {
      const surface = {
        width,
        height,
        __canvasBackendImageSource: true,
        __pixels: new Uint8ClampedArray(width * height * 4),
        getContext() {
          return {
            drawImage(image) {
              surface.__pixels.set(image.__pixels)
            },
            getImageData() {
              return {
                width,
                height,
                data: surface.__pixels.slice()
              }
            },
            putImageData(imageData) {
              surface.__pixels.set(imageData.data)
            }
          }
        }
      }

      effectSurface = surface
      return surface
    }

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 0, y: 0, width: 1, height: 1 },
      null,
      {
        kind: 'effect',
        type: 'brightnessContrast',
        brightnessLevel: 255,
        contrastLevel: 0
      }
    )

    expect(Array.from(effectSurface.__pixels)).toEqual([255, 255, 255, 255])
    expect(target.calls).toEqual([
      ['drawImage', effectSurface, 0, 0, 1, 1, 10, 11, 20, 21]
    ])
  })

  test('maps red-eye correction areas into the cropped image surface before applying pixels', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const source = {
      width: 3,
      height: 1,
      __canvasBackendImageSource: true,
      __pixels: new Uint8ClampedArray([
        10, 20, 30, 255,
        250, 20, 20, 255,
        40, 50, 60, 255
      ])
    }
    let effectSurface = null

    backend.createSurface = (width, height) => {
      const surface = {
        width,
        height,
        __canvasBackendImageSource: true,
        __pixels: new Uint8ClampedArray(width * height * 4),
        getContext() {
          return {
            drawImage(image, sx = 0, sy = 0, sw = image.width, sh = image.height) {
              for (let y = 0; y < sh; y += 1) {
                for (let x = 0; x < sw; x += 1) {
                  const sourceIndex = ((sy + y) * image.width + (sx + x)) * 4
                  const targetIndex = (y * width + x) * 4

                  surface.__pixels.set(image.__pixels.slice(sourceIndex, sourceIndex + 4), targetIndex)
                }
              }
            },
            getImageData() {
              return {
                width,
                height,
                data: surface.__pixels.slice()
              }
            },
            putImageData(imageData) {
              surface.__pixels.set(imageData.data)
            }
          }
        }
      }

      effectSurface = surface
      return surface
    }

    backend.drawImageRect(
      { canvas: source },
      { x: 10, y: 11, width: 20, height: 21 },
      { x: 1, y: 0, width: 1, height: 1 },
      null,
      {
        kind: 'effect',
        type: 'redEyeCorrection',
        areas: [{ left: 1, top: 0, right: 2, bottom: 1 }]
      }
    )

    expect(Array.from(effectSurface.__pixels)).toEqual([20, 20, 20, 255])
    expect(target.calls).toEqual([
      ['drawImage', effectSurface, 0, 0, 1, 1, 10, 11, 20, 21]
    ])
  })

  test('renders shared arc segments through canvas ellipse commands', () => {
    const target = createFakeTarget()
    const backend = new CanvasBackend(target)
    const path = {
      figures: [
        {
          closed: true,
          points: [
            { x: 10, y: 20 },
            { x: 20, y: 20 },
            { x: 10, y: 10 }
          ],
          segments: [
            {
              type: 'line',
              point: { x: 20, y: 20 }
            },
            {
              type: 'arc',
              center: { x: 20, y: 10 },
              radiusX: 10,
              radiusY: 10,
              rotation: 0,
              startAngle: Math.PI / 2,
              endAngle: Math.PI,
              counterclockwise: false,
              point: { x: 10, y: 10 }
            }
          ]
        }
      ]
    }

    backend.fillPath(path, { color: 'rgb(0, 255, 0)' })

    expect(target.calls).toEqual([
      ['beginPath'],
      ['moveTo', 10, 20],
      ['lineTo', 20, 20],
      ['ellipse', 20, 10, 10, 10, 0, Math.PI / 2, Math.PI, false],
      ['closePath'],
      ['fill', 'nonzero']
    ])
  })
})
