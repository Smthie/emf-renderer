import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEmf } from '../src/emf/parse-emf.js'
import { playParsedMetafile } from '../src/runtime/playback.js'
import { capabilityMatrix, gapTriage } from '../samples/capability-matrix.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultSamplesRoot = path.join(repoRoot, 'samples')

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1
}

// Implements the full drawing surface that src/runtime/dispatch/* probes for,
// so a record is never counted as unsupported merely because this headless
// backend lacks a method (e.g. drawText, fillEllipse). createSurface stays null
// on purpose: Node has no canvas, so image/bitmap records honestly surface as
// image-surface-unavailable — an environment limit, not a renderer capability
// gap. resolveImageSource is intentionally omitted for the same reason (the
// dispatch falls back to null when it is absent).
function createNoopBackend() {
  return {
    resize() {},
    clear() {},
    setTransform() {},
    save() {},
    restore() {},
    applyGraphicsState() {},
    fillRect() {},
    strokeRect() {},
    fillPath() {},
    strokePath() {},
    fillEllipse() {},
    strokeEllipse() {},
    fillGeometry() {},
    drawLine() {},
    drawText() {},
    drawDriverString() {},
    drawImageRect() {},
    drawImageParallelogram() {},
    clipRect() {},
    setClip() {},
    resetClip() {},
    createSurface() {
      return null
    }
  }
}

function collectSampleNames(directory = defaultSamplesRoot, prefix = '') {
  const samples = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      samples.push(...collectSampleNames(path.join(directory, entry.name), `${prefix}${entry.name}/`))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.emf')) {
      samples.push(`${prefix}${entry.name}`)
    }
  }

  return samples.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function recordKey(source, type) {
  return `${source}:0x${type.toString(16)}`
}

function collectRecordCoverage(parsed, report) {
  for (const record of parsed.records ?? []) {
    increment(report.records, recordKey('emf', record.type))

    for (const subrecord of record.emfPlusRecords ?? []) {
      increment(report.records, recordKey('emfplus', subrecord.type))
    }
  }
}

function collectRuntimeDiagnostics(runtime, report) {
  for (const unsupported of runtime.unsupported) {
    increment(report.unsupported, unsupported)
  }

  for (const warning of runtime.warnings) {
    increment(report.warnings, warning)
  }

  for (const diagnostic of runtime.diagnostics) {
    increment(report.diagnosticCodes, diagnostic.code)

    if (diagnostic.level === 'warning') {
      increment(report.warningCodes, diagnostic.code)
    }
  }
}

function summarizeMatrix() {
  const byMilestone = {}
  const byCategory = {}

  for (const entry of capabilityMatrix) {
    increment(byMilestone, entry.ownerMilestone)
    increment(byCategory, entry.category)
  }

  return {
    total: capabilityMatrix.length,
    byMilestone,
    byCategory
  }
}

function summarizeGapTriage() {
  const byMilestone = {}
  const byCategory = {}

  for (const entry of gapTriage) {
    increment(byMilestone, entry.ownerMilestone)
    increment(byCategory, entry.category)
  }

  return {
    total: gapTriage.length,
    byMilestone,
    byCategory,
    samples: gapTriage.map((entry) => ({
      sample: entry.sample,
      ownerMilestone: entry.ownerMilestone,
      category: entry.category,
      nextAction: entry.nextAction
    }))
  }
}

export function buildCapabilityReport(options = {}) {
  const samplesRoot = options.samplesRoot ?? defaultSamplesRoot
  const sampleNames = options.sampleNames ?? collectSampleNames(samplesRoot)
  const report = {
    samples: {
      total: sampleNames.length,
      rendered: 0,
      parseFailures: [],
      renderFailures: []
    },
    records: {},
    unsupported: {},
    warnings: {},
    warningCodes: {},
    diagnosticCodes: {},
    matrix: summarizeMatrix(),
    gaps: summarizeGapTriage()
  }

  for (const sample of sampleNames) {
    const filePath = path.join(samplesRoot, sample)
    let parsed = null

    try {
      parsed = parseEmf(fs.readFileSync(filePath))
      collectRecordCoverage(parsed, report)
    } catch (error) {
      report.samples.parseFailures.push({
        sample,
        message: error?.message ?? String(error)
      })
      continue
    }

    try {
      const runtime = playParsedMetafile(parsed, createNoopBackend())
      collectRuntimeDiagnostics(runtime, report)
      report.samples.rendered += 1
    } catch (error) {
      report.samples.renderFailures.push({
        sample,
        message: error?.message ?? String(error)
      })
    }
  }

  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildCapabilityReport()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
