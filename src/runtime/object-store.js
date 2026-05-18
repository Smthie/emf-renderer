export class ObjectStore {
  constructor() {
    this.items = new Map()
  }

  set(handle, value) {
    this.items.set(handle, value)
  }

  get(handle) {
    return this.items.get(handle)
  }

  delete(handle) {
    this.items.delete(handle)
  }

  clear() {
    this.items.clear()
  }
}
