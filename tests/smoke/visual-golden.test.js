import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { encode } from 'fast-png'
import { afterEach, describe, expect, test } from 'vitest'
import {
  buildVisualGoldenPlan,
  comparePngFiles,
  generateVisualGoldens,
  listVisualGoldenSamples,
  verifyVisualGoldens
} from '../../scripts/visual-golden.js'

const tempDirs = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
})

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emf-visual-golden-'))
  tempDirs.push(tempDir)
  return tempDir
}

function writePng(filePath, rgba, size = 2) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const data = new Uint8Array(size * size * 4)

  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset)
  }

  fs.writeFileSync(
    filePath,
    encode({
      width: size,
      height: size,
      channels: 4,
      depth: 8,
      data
    })
  )
}

describe('visual golden workflow', () => {
  test('plans core samples with tier, capability, and threshold metadata', () => {
    const plan = buildVisualGoldenPlan({
      tier: 'windows-gdiplus',
      platform: 'win32',
      runner: '/missing/native-runner.exe',
      category: 'gradient'
    })

    expect(plan.status).toBe('skipped')
    expect(plan.skipReason).toContain('native runner was not found')
    expect(plan.samples).toHaveLength(2)
    expect(plan.samples[0]).toMatchObject({
      sample: 'synthetic/emfplus/synthetic-emfplus-gradients.emf',
      category: 'gradient',
      thresholdGroup: 'gradient'
    })
    // A first-party, native GDI+-recorded gradient sample shares the group.
    expect(plan.samples.map((sample) => sample.sample)).toContain(
      'synthetic/gdiplus/synthetic-gdiplus-linear-gradient.emf'
    )
    expect(plan.samples[0].threshold.maxChangedPixelRatio).toBeGreaterThan(0)
  })

  test('lists samples by tier and capability without pulling every renderable fixture', () => {
    const bitmapSamples = listVisualGoldenSamples({
      tier: 'windows-gdi',
      capability: 'bitmap'
    })

    expect(bitmapSamples).toEqual([
      expect.objectContaining({
        sample: 'synthetic/classic/synthetic-classic-dib-24bit.emf',
        thresholdGroup: 'bitmap'
      })
    ])
  })

  test('delegates browser baseline to Playwright instead of passing an empty golden set', () => {
    const report = verifyVisualGoldens({
      tier: 'darwin-browser',
      platform: 'darwin'
    })

    expect(report).toMatchObject({
      command: 'verify',
      tier: 'darwin-browser',
      status: 'skipped',
      sampleCount: 0
    })
    expect(report.skipReason).toContain('pnpm test:visual')
  })

  test('fails when filters match no core golden samples', () => {
    const report = verifyVisualGoldens({
      tier: 'windows-gdi',
      platform: 'win32',
      runner: process.execPath,
      capability: 'does-not-exist'
    })

    expect(report).toMatchObject({
      command: 'verify',
      tier: 'windows-gdi',
      status: 'failed',
      sampleCount: 0
    })
    expect(report.failureReason).toContain('capability=does-not-exist')
  })

  test('compares PNG metrics against capability thresholds', () => {
    const dir = createTempDir()
    const expected = path.join(dir, 'expected.png')
    const actual = path.join(dir, 'actual.png')

    writePng(expected, [255, 0, 0, 255])
    writePng(actual, [254, 0, 0, 255])

    expect(
      comparePngFiles(actual, expected, {
        pixelDeltaThreshold: 2,
        maxChangedPixelRatio: 0,
        maxMeanChannelDelta: 0.5,
        maxMaxChannelDelta: 2
      })
    ).toMatchObject({
      passed: true,
      changedPixels: 0,
      maxChannelDelta: 1
    })

    expect(
      comparePngFiles(actual, expected, {
        pixelDeltaThreshold: 0,
        maxChangedPixelRatio: 0,
        maxMeanChannelDelta: 0.01,
        maxMaxChannelDelta: 0
      })
    ).toMatchObject({
      passed: false,
      changedPixels: 4,
      reason: 'threshold-exceeded'
    })
  })

  test('verifies a tier and reports sample, capability, metrics, and threshold on failure', () => {
    const expectedDir = createTempDir()
    const actualDir = createTempDir()
    const fileName = 'synthetic-classic-synthetic-classic-dib-24bit-windows-gdi.png'

    writePng(path.join(expectedDir, fileName), [255, 0, 0, 255])
    writePng(path.join(actualDir, fileName), [0, 0, 255, 255])

    const report = verifyVisualGoldens({
      tier: 'windows-gdi',
      platform: 'win32',
      runner: process.execPath,
      capability: 'bitmap',
      expectedDir,
      actualDir
    })

    expect(report.status).toBe('failed')
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({
      sample: 'synthetic/classic/synthetic-classic-dib-24bit.emf',
      category: 'bitmap',
      thresholdGroup: 'bitmap',
      reason: 'threshold-exceeded'
    })
    expect(report.failures[0].capabilities).toEqual(
      expect.arrayContaining(['classic-dib', '24bpp-rgb', 'stretch-blit'])
    )
    expect(report.failures[0].metrics.changedPixelRatio).toBe(1)
    expect(report.failures[0].threshold.maxChangedPixelRatio).toBe(0.005)
  })

  test('skips native verification outside Windows before requiring golden files', () => {
    const report = verifyVisualGoldens({
      tier: 'windows-gdi',
      platform: 'darwin',
      capability: 'bitmap'
    })

    expect(report).toMatchObject({
      command: 'verify',
      tier: 'windows-gdi',
      status: 'skipped',
      actualDir: 'tests/visual/actual/windows-gdi',
      expectedDir: 'tests/visual/goldens/windows-gdi',
      sampleCount: 1
    })
    expect(report.skipReason).toContain('requires win32')
  })

  test('CLI accepts pnpm-style separator and kebab-case options', () => {
    const output = execFileSync(
      process.execPath,
      [
        'scripts/visual-golden.js',
        'verify',
        '--',
        '--tier',
        'windows-gdi',
        '--actual-dir',
        'tests/visual/actual/windows-gdi',
        '--capability',
        'bitmap'
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        encoding: 'utf8'
      }
    )
    const report = JSON.parse(output)

    expect(report).toMatchObject({
      command: 'verify',
      tier: 'windows-gdi',
      status: 'skipped',
      actualDir: 'tests/visual/actual/windows-gdi',
      sampleCount: 1
    })
  })

  test('CLI exits with code 1 when visual golden verification fails', () => {
    const expectedDir = createTempDir()
    const actualDir = createTempDir()
    const fileName = 'synthetic-classic-synthetic-classic-dib-24bit-windows-gdi.png'

    writePng(path.join(expectedDir, fileName), [255, 0, 0, 255])
    writePng(path.join(actualDir, fileName), [0, 0, 255, 255])

    const result = spawnSync(
      process.execPath,
      [
        'scripts/visual-golden.js',
        'verify',
        '--tier',
        'windows-gdi',
        '--platform',
        'win32',
        '--runner',
        process.execPath,
        '--capability',
        'bitmap',
        '--actual-dir',
        actualDir,
        '--expected-dir',
        expectedDir
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        encoding: 'utf8'
      }
    )
    const report = JSON.parse(result.stdout)

    expect(result.status).toBe(1)
    expect(report.failures[0].sample).toBe('synthetic/classic/synthetic-classic-dib-24bit.emf')
    expect(report.failures[0].capabilities).toContain('classic-dib')
    expect(report.failures[0].metrics).toMatchObject({
      changedPixelRatio: 1,
      maxChannelDelta: 255
    })
    expect(report.failures[0].metrics.meanChannelDelta).toBeGreaterThan(0)
  })

  test('imports native runner output into the tier golden directory', () => {
    const sourceDir = createTempDir()
    const outputDir = createTempDir()
    const fileName = 'synthetic-classic-synthetic-classic-dib-24bit-windows-gdi.png'

    writePng(path.join(sourceDir, fileName), [10, 20, 30, 255])

    const report = generateVisualGoldens({
      tier: 'windows-gdi',
      platform: 'win32',
      runner: process.execPath,
      capability: 'bitmap',
      sourceDir,
      outputDir
    })

    expect(report.status).toBe('generated')
    expect(report.generated).toEqual([
      expect.objectContaining({
        sample: 'synthetic/classic/synthetic-classic-dib-24bit.emf'
      })
    ])
    expect(fs.existsSync(path.join(outputDir, fileName))).toBe(true)
  })

  test('imports source-dir output without requiring a native runner on the current platform', () => {
    const sourceDir = createTempDir()
    const outputDir = createTempDir()
    const fileName = 'synthetic-classic-synthetic-classic-dib-24bit-windows-gdi.png'

    writePng(path.join(sourceDir, fileName), [10, 20, 30, 255])

    const report = generateVisualGoldens({
      tier: 'windows-gdi',
      platform: 'darwin',
      capability: 'bitmap',
      sourceDir,
      outputDir
    })

    expect(report.status).toBe('generated')
    expect(report.generated).toHaveLength(1)
    expect(fs.existsSync(path.join(outputDir, fileName))).toBe(true)
  })
})
