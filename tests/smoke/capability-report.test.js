import { describe, expect, test } from 'vitest'
import { buildCapabilityReport } from '../../scripts/capability-report.js'

describe('capability report', () => {
  test('summarizes sample records, diagnostics, and gap triage without browser canvas APIs', () => {
    const report = buildCapabilityReport({
      sampleNames: [
        'synthetic/classic/synthetic-classic-path-bezier.emf',
        'synthetic/classic/synthetic-classic-flatten-widen.emf',
        'synthetic/emfplus/synthetic-emfplus-path-clip-region.emf',
        'real/parse-gap/real-libreoffice-tdf93750.emf'
      ]
    })

    expect(report.samples.total).toBe(4)
    expect(report.samples.rendered).toBeGreaterThan(0)
    expect(report.samples.parseFailures.length + report.samples.renderFailures.length).toBeGreaterThanOrEqual(0)
    expect(report.records['emf:0x1']).toBeGreaterThan(0)
    expect(report.warnings['EMR_WIDENPATH uses a bounding-box approximation for multi-segment or closed paths']).toBeUndefined()
    expect(report.warningCodes['runtime-warning']).toBeUndefined()
    expect(report.matrix.byMilestone.M6).toBeGreaterThan(0)
    expect(report.gaps.samples.some((entry) => entry.ownerMilestone === 'M6')).toBe(true)
    expect(() => JSON.stringify(report)).not.toThrow()
  })
})
