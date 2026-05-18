import { IDENTITY_MATRIX, cloneMatrix } from './matrix.js'
import { cloneValue } from './clone-value.js'

function cloneClip(clip) {
  if (!clip) {
    return null
  }

  return cloneValue(clip)
}

function cloneStateSnapshot(state) {
  return {
    ...state,
    worldTransform: cloneMatrix(state.worldTransform),
    clip: cloneClip(state.clip)
  }
}

function createDefaults() {
  return {
    worldTransform: cloneMatrix(IDENTITY_MATRIX),
    pageScale: 1,
    pageUnit: 'pixel',
    clip: null,
    renderingOrigin: { x: 0, y: 0 },
    smoothingMode: 'default',
    interpolationMode: 'default',
    pixelOffsetMode: 'default',
    textRenderingHint: 'system',
    textContrast: 0,
    compositingMode: 'sourceOver',
    compositingQuality: 'default'
  }
}

export class GraphicsState {
  constructor() {
    this.current = createDefaults()
    this.stack = []
    this.nextToken = 1
  }

  save() {
    const token = this.nextToken++

    this.stack.push({
      token,
      snapshot: cloneStateSnapshot(this.current)
    })

    return token
  }

  restore(token) {
    const index = this.stack.findIndex((entry) => entry.token === token)

    if (index === -1) {
      throw new Error(`GraphicsState restore mismatch for token ${token}`)
    }

    const [entry] = this.stack.splice(index, this.stack.length - index)
    this.current = cloneStateSnapshot(entry.snapshot)
  }

  setWorldTransform(matrix) {
    this.current.worldTransform = cloneMatrix(matrix)
  }

  resetWorldTransform() {
    this.current.worldTransform = cloneMatrix(IDENTITY_MATRIX)
  }

  setPageTransform(unit, scale) {
    this.current.pageUnit = unit
    this.current.pageScale = scale
  }

  setClip(clip) {
    this.current.clip = cloneClip(clip)
  }

  setRenderingOrigin(origin) {
    this.current.renderingOrigin = cloneValue(origin)
  }

  setSmoothingMode(mode) {
    this.current.smoothingMode = mode
  }

  setInterpolationMode(mode) {
    this.current.interpolationMode = mode
  }

  setPixelOffsetMode(mode) {
    this.current.pixelOffsetMode = mode
  }

  setTextRenderingHint(mode) {
    this.current.textRenderingHint = mode
  }

  setTextContrast(value) {
    this.current.textContrast = value
  }

  setCompositingMode(mode) {
    this.current.compositingMode = mode
  }

  setCompositingQuality(mode) {
    this.current.compositingQuality = mode
  }
}
