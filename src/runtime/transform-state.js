import { IDENTITY_MATRIX, cloneMatrix, multiplyMatrices } from './matrix.js'

export class TransformState {
  constructor() {
    this.outputTransform = cloneMatrix(IDENTITY_MATRIX)
    this.mappingTransform = cloneMatrix(IDENTITY_MATRIX)
    this.pageTransform = cloneMatrix(IDENTITY_MATRIX)
    this.worldTransform = cloneMatrix(IDENTITY_MATRIX)
    this.current = cloneMatrix(IDENTITY_MATRIX)
    this.stack = []
    this.nextToken = 1
  }

  save() {
    const token = this.nextToken++

    this.stack.push({
      token,
      snapshot: this.#snapshot()
    })

    return token
  }

  restore(token) {
    const index = this.stack.findIndex((entry) => entry.token === token)

    if (index === -1) {
      throw new Error(`TransformState restore mismatch for token ${token}`)
    }

    const [entry] = this.stack.splice(index, this.stack.length - index)
    this.#applySnapshot(entry.snapshot)
  }

  setOutputTransform(matrix) {
    this.outputTransform = cloneMatrix(matrix)
    this.#recompute()
  }

  setMappingTransform(matrix) {
    this.mappingTransform = cloneMatrix(matrix)
    this.#recompute()
  }

  setPageTransform(matrix) {
    this.pageTransform = cloneMatrix(matrix)
    this.#recompute()
  }

  setWorldTransform(matrix) {
    this.worldTransform = cloneMatrix(matrix)
    this.#recompute()
  }

  getEffectiveTransform() {
    return cloneMatrix(this.current)
  }

  get currentTransform() {
    return this.getEffectiveTransform()
  }

  #snapshot() {
    return {
      outputTransform: cloneMatrix(this.outputTransform),
      mappingTransform: cloneMatrix(this.mappingTransform),
      pageTransform: cloneMatrix(this.pageTransform),
      worldTransform: cloneMatrix(this.worldTransform)
    }
  }

  #applySnapshot(snapshot) {
    this.outputTransform = cloneMatrix(snapshot.outputTransform)
    this.mappingTransform = cloneMatrix(snapshot.mappingTransform)
    this.pageTransform = cloneMatrix(snapshot.pageTransform)
    this.worldTransform = cloneMatrix(snapshot.worldTransform)
    this.#recompute()
  }

  #recompute() {
    this.current = multiplyMatrices(
      this.outputTransform,
      multiplyMatrices(
        this.mappingTransform,
        multiplyMatrices(this.pageTransform, this.worldTransform)
      )
    )
  }
}
