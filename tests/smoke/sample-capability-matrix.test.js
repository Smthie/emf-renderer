import { describe, expect, test } from 'vitest'
import {
  capabilityMatrix,
  gapTriage,
  goldenTiers,
  triageCategories,
  visualGoldenCoreSamples,
  visualGoldenThresholds
} from '../../samples/capability-matrix.js'
import {
  collectFixtureSampleNames,
  fixtureSampleExists,
  getGapTriage,
  getSampleCapability,
  getVisualTier,
  hasLocalSampleDir,
  isParseGapSample,
  isRenderGapSample,
  listVisualTiers,
  visualSnapshotName,
  visualTierSkip
} from '../helpers/read-fixture.js'

const allSamples = collectFixtureSampleNames()
const gapSamples = allSamples.filter((sample) => isParseGapSample(sample) || isRenderGapSample(sample))

describe('sample capability matrix', () => {
  test('tracks at least twenty existing core samples with milestone and expected behavior', () => {
    expect(capabilityMatrix.length).toBeGreaterThanOrEqual(20)
    expect(new Set(capabilityMatrix.map((entry) => entry.sample)).size).toBe(capabilityMatrix.length)

    for (const entry of capabilityMatrix) {
      // The real/ and original/ fixture trees are local-only; assert file
      // existence only when the tree is present (synthetic always is).
      if (hasLocalSampleDir(entry.sample.split('/')[0])) {
        expect(fixtureSampleExists(entry.sample), entry.sample).toBe(true)
      }
      expect(entry.category, entry.sample).toEqual(expect.any(String))
      expect(entry.capabilities, entry.sample).toEqual(expect.arrayContaining([expect.any(String)]))
      expect(entry.ownerMilestone, entry.sample).toMatch(/^M[0-6]$/)
      expect(entry.gapId, entry.sample).toEqual(expect.any(String))
      expect(entry.expectedBehavior, entry.sample).toEqual(expect.any(String))
      expect(triageCategories, entry.sample).toContain(entry.triage.category)
      expect(entry.triage.reason, entry.sample).toEqual(expect.any(String))
      expect(entry.triage.nextAction, entry.sample).toEqual(expect.any(String))
      expect(entry.triage.ownerMilestone, entry.sample).toBe(entry.ownerMilestone)
      expect(getSampleCapability(entry.sample), entry.sample).toBe(entry)
    }
  })

  test('documents triage for every parse-gap and render-gap sample', () => {
    expect(new Set(gapTriage.map((entry) => entry.sample)).size).toBe(gapTriage.length)
    // gapSamples comes from a disk scan, so clones without the local-only
    // real/ tree see an empty list; compare against the locally present
    // subset (a no-op filter when the fixtures are checked out).
    expect(
      gapTriage
        .map((entry) => entry.sample)
        .filter(fixtureSampleExists)
        .sort()
    ).toEqual(gapSamples.sort())

    for (const sample of gapSamples) {
      const triage = getGapTriage(sample)

      expect(triage, sample).not.toBeNull()
      expect(triageCategories, sample).toContain(triage.category)
      expect(triage.reason, sample).toEqual(expect.any(String))
      expect(triage.nextAction, sample).toEqual(expect.any(String))
      expect(triage.ownerMilestone, sample).toMatch(/^M[0-6]$/)
    }
  })

  test('keeps visual baseline and optional golden tiers explicit', () => {
    expect(goldenTiers.map((tier) => tier.id)).toEqual([
      'darwin-browser',
      'windows-gdi',
      'windows-gdiplus'
    ])
    expect(listVisualTiers('baseline').map((tier) => tier.id)).toEqual(['darwin-browser'])
    expect(listVisualTiers('golden').map((tier) => tier.id)).toEqual(['windows-gdi', 'windows-gdiplus'])
    expect(getVisualTier('darwin-browser')).toMatchObject({
      kind: 'baseline',
      platform: 'darwin',
      renderer: 'browser'
    })
    expect(visualSnapshotName('original/image1.emf', 'darwin-browser')).toBe('image1-emf.png')
    expect(visualSnapshotName('original/image1.emf', 'windows-gdi')).toBe('original-image1-windows-gdi.png')
    expect(visualSnapshotName('real/render/image1.emf', 'windows-gdi')).toBe('real-render-image1-windows-gdi.png')
  })

  test('skips optional Windows native golden tiers outside Windows', () => {
    const windowsGdi = getVisualTier('windows-gdi')
    const windowsGdiplus = getVisualTier('windows-gdiplus')

    expect(visualTierSkip(windowsGdi, { platform: 'darwin' })).toMatchObject({ skip: true })
    expect(visualTierSkip(windowsGdi, { platform: 'darwin' }).reason).toContain('requires win32')
    expect(visualTierSkip(windowsGdiplus, { platform: 'linux' })).toMatchObject({ skip: true })
    expect(
      visualTierSkip(windowsGdi, {
        platform: 'win32',
        hasNativeGoldenRunner: false
      })
    ).toMatchObject({ skip: true })
  })

  test('declares core native golden samples with capability-specific thresholds', () => {
    expect(Object.keys(visualGoldenThresholds).sort()).toEqual([
      'bitmap',
      'clip-region',
      'default',
      'gradient',
      'text'
    ])
    expect(visualGoldenCoreSamples.length).toBeGreaterThanOrEqual(8)

    const coreSamples = visualGoldenCoreSamples.map((core) => {
      const matrixEntry = getSampleCapability(core.sample)

      expect(['windows-gdi', 'windows-gdiplus']).toContain(core.tier)
      expect(fixtureSampleExists(core.sample), core.sample).toBe(true)
      expect(matrixEntry, core.sample).not.toBeNull()
      expect(matrixEntry.goldenCandidate, core.sample).toBe(true)
      expect(visualGoldenThresholds[core.thresholdGroup], core.sample).toBeDefined()
      expect(isParseGapSample(core.sample), core.sample).toBe(false)
      expect(isRenderGapSample(core.sample), core.sample).toBe(false)

      return {
        tier: core.tier,
        thresholdGroup: core.thresholdGroup,
        sample: core.sample
      }
    })

    expect(coreSamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: 'windows-gdi', thresholdGroup: 'text' }),
        expect.objectContaining({ tier: 'windows-gdi', thresholdGroup: 'bitmap' }),
        expect.objectContaining({ tier: 'windows-gdi', thresholdGroup: 'clip-region' }),
        expect.objectContaining({ tier: 'windows-gdiplus', thresholdGroup: 'text' }),
        expect.objectContaining({ tier: 'windows-gdiplus', thresholdGroup: 'bitmap' }),
        expect.objectContaining({ tier: 'windows-gdiplus', thresholdGroup: 'gradient' }),
        expect.objectContaining({ tier: 'windows-gdiplus', thresholdGroup: 'clip-region' })
      ])
    )
  })
})
