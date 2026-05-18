import { handleClassicRecord } from './classic.js'
import { handleEmfPlusRecord } from './emfplus.js'

export { isClassicDrawingRecord, resolveClassicStockObject } from './constants.js'

export function dispatchRecord(parsed, runtime, backend, record) {
  runtime.applyGraphicsState?.(record)

  if (record.source === 'emfplus') {
    return handleEmfPlusRecord(parsed, runtime, backend, record)
  }

  if (record.source === 'emf') {
    return handleClassicRecord(parsed, runtime, backend, record)
  }

  return false
}
