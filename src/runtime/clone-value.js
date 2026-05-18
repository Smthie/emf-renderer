function cloneTypedArray(value) {
  const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)

  return new value.constructor(bytes)
}

export function cloneValue(value, seen = new WeakMap()) {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return seen.get(value)
  }

  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags)
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const buffer = cloneValue(value.buffer, seen)

      return new DataView(buffer, value.byteOffset, value.byteLength)
    }

    return cloneTypedArray(value)
  }

  if (value instanceof Map) {
    const copy = new Map()

    seen.set(value, copy)

    for (const [key, entryValue] of value.entries()) {
      copy.set(cloneValue(key, seen), cloneValue(entryValue, seen))
    }

    return copy
  }

  if (value instanceof Set) {
    const copy = new Set()

    seen.set(value, copy)

    for (const entry of value.values()) {
      copy.add(cloneValue(entry, seen))
    }

    return copy
  }

  const prototype = Object.getPrototypeOf(value)
  const copy = Array.isArray(value) ? [] : Object.create(prototype)

  seen.set(value, copy)

  for (const key of Reflect.ownKeys(value)) {
    copy[key] = cloneValue(value[key], seen)
  }

  return copy
}
