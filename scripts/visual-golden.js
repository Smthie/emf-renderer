import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from 'fast-png'
import {
  capabilityMatrix,
  goldenTiers,
  visualGoldenCoreSamples,
  visualGoldenSampleKey,
  visualGoldenThresholds
} from '../samples/capability-matrix.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}

function parseArgs(argv) {
  const args = {
    command: argv[0] ?? 'plan',
    tier: null,
    sample: null,
    capability: null,
    category: null,
    actualDir: null,
    expectedDir: null,
    sourceDir: null,
    outputDir: null,
    platform: process.platform,
    runner: process.env.EMF_NATIVE_GOLDEN_RUNNER ?? '',
    json: false
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--json') {
      args.json = true
      continue
    }

    if (arg === '--') {
      continue
    }

    if (!arg.startsWith('--')) {
      throw new TypeError(`Unexpected positional argument "${arg}".`)
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const value = inlineValue ?? argv[index + 1]

    if (inlineValue === undefined) {
      index += 1
    }

    if (value === undefined) {
      throw new TypeError(`Missing value for --${rawName}.`)
    }

    if (!(name in args)) {
      throw new TypeError(`Unknown option --${rawName}.`)
    }

    args[name] = value
  }

  return args
}

function requireTier(tierId) {
  const tier = goldenTiers.find((entry) => entry.id === tierId)

  if (!tier) {
    const knownTiers = goldenTiers.map((entry) => entry.id).join(', ')
    throw new TypeError(`Unknown visual golden tier "${tierId}". Known tiers: ${knownTiers}.`)
  }

  return tier
}

function getCapabilityEntry(sample) {
  const entry = capabilityMatrix.find((item) => item.sample === sample)

  if (!entry) {
    throw new TypeError(`No capability matrix entry found for golden sample "${sample}".`)
  }

  return entry
}

function inferThresholdGroup(entry) {
  if (entry.category === 'text') return 'text'
  if (entry.category === 'bitmap') return 'bitmap'
  if (entry.category === 'gradient') return 'gradient'
  if (entry.category === 'clip' || entry.category === 'region') return 'clip-region'
  if (entry.capabilities.some((capability) => /clip|region/i.test(capability))) return 'clip-region'
  return 'default'
}

function getThreshold(group) {
  return visualGoldenThresholds[group] ?? visualGoldenThresholds.default
}

function isTierRunnable(tier, options = {}) {
  const platform = options.platform ?? process.platform
  const runner = options.runner ?? process.env.EMF_NATIVE_GOLDEN_RUNNER ?? ''

  if (tier.kind === 'baseline') {
    return {
      runnable: false,
      reason: `${tier.id} is managed by Playwright snapshots; run pnpm test:visual for the browser baseline.`
    }
  }

  if (tier.kind === 'golden' && options.allowSourceImport === true) {
    return { runnable: true, reason: '' }
  }

  if (tier.platform && tier.platform !== platform) {
    return {
      runnable: false,
      reason: `${tier.id} requires ${tier.platform}; current platform is ${platform}.`
    }
  }

  if (tier.kind === 'golden' && !runner) {
    return {
      runnable: false,
      reason: `${tier.id} requires EMF_NATIVE_GOLDEN_RUNNER or --runner to generate native Windows output.`
    }
  }

  if (tier.kind === 'golden' && runner && !fs.existsSync(runner)) {
    return {
      runnable: false,
      reason: `${tier.id} native runner was not found at ${runner}.`
    }
  }

  return { runnable: true, reason: '' }
}

function resolveDirectory(directory, fallback) {
  return path.resolve(repoRoot, directory ?? fallback)
}

function defaultActualDirectory(tier) {
  return path.join('tests/visual/actual', tier.id)
}

function fileNameForSample(sample, tier) {
  return `${visualGoldenSampleKey(sample)}-${tier.id}.png`
}

function normalizePlanSample(coreSample) {
  const entry = getCapabilityEntry(coreSample.sample)
  const thresholdGroup = coreSample.thresholdGroup ?? inferThresholdGroup(entry)
  const threshold = getThreshold(thresholdGroup)

  return {
    sample: entry.sample,
    category: entry.category,
    capabilities: [...entry.capabilities],
    ownerMilestone: entry.ownerMilestone,
    gapId: entry.gapId,
    thresholdGroup,
    threshold,
    key: visualGoldenSampleKey(entry.sample)
  }
}

function describeFilters(options) {
  const filters = []

  if (options.sample) filters.push(`sample=${options.sample}`)
  if (options.category) filters.push(`category=${options.category}`)
  if (options.capability) filters.push(`capability=${options.capability}`)

  return filters.length === 0 ? 'no filters' : filters.join(', ')
}

export function listVisualGoldenSamples(options = {}) {
  const tier = typeof options.tier === 'string' ? requireTier(options.tier) : options.tier
  const tierId = tier?.id
  const samples = visualGoldenCoreSamples
    .filter((entry) => !tierId || entry.tier === tierId)
    .map(normalizePlanSample)
    .filter((entry) => !options.sample || entry.sample === options.sample)
    .filter((entry) => !options.category || entry.category === options.category)
    .filter((entry) => {
      if (!options.capability) return true
      return entry.capabilities.includes(options.capability) || entry.thresholdGroup === options.capability
    })

  return samples
}

export function buildVisualGoldenPlan(options = {}) {
  const tier = requireTier(options.tier ?? 'windows-gdi')
  const samples = listVisualGoldenSamples({
    tier,
    sample: options.sample,
    capability: options.capability,
    category: options.category
  })
  const status = samples.length === 0 && tier.kind !== 'baseline' ? 'failed' : null
  const skipState = status === null ? isTierRunnable(tier, options) : null

  return {
    command: 'plan',
    tier: {
      id: tier.id,
      kind: tier.kind,
      platform: tier.platform,
      renderer: tier.renderer,
      directory: tier.directory,
      required: tier.required
    },
    status: status ?? (skipState.runnable ? 'ready' : 'skipped'),
    skipReason: skipState?.reason ?? '',
    failureReason:
      status === 'failed'
        ? `No core visual golden samples matched ${describeFilters(options)} for tier ${tier.id}.`
        : '',
    samples,
    sampleCount: samples.length,
    thresholdGroups: visualGoldenThresholds
  }
}

function readPng(filePath) {
  const image = decode(fs.readFileSync(filePath))

  if (image.depth !== 8) {
    throw new TypeError(`Unsupported PNG bit depth ${image.depth} for ${filePath}.`)
  }

  return image
}

function channelValue(image, pixelIndex, channel) {
  if (image.channels === 1) {
    const gray = image.data[pixelIndex]
    return channel === 3 ? 255 : gray
  }

  if (image.channels === 2) {
    const offset = pixelIndex * 2
    return channel === 3 ? image.data[offset + 1] : image.data[offset]
  }

  if (image.channels === 3) {
    const offset = pixelIndex * 3
    return channel === 3 ? 255 : image.data[offset + channel]
  }

  if (image.channels === 4) {
    return image.data[pixelIndex * 4 + channel]
  }

  throw new TypeError(`Unsupported PNG channel count ${image.channels}.`)
}

export function comparePngFiles(actualPath, expectedPath, threshold) {
  const actual = readPng(actualPath)
  const expected = readPng(expectedPath)

  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      passed: false,
      width: actual.width,
      height: actual.height,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      totalPixels: Math.max(actual.width * actual.height, expected.width * expected.height),
      changedPixels: null,
      changedPixelRatio: 1,
      meanChannelDelta: Infinity,
      maxChannelDelta: Infinity,
      reason: 'image-size-mismatch'
    }
  }

  let changedPixels = 0
  let maxChannelDelta = 0
  let channelDeltaTotal = 0
  const totalPixels = actual.width * actual.height
  const totalChannels = totalPixels * 4

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    let pixelChanged = false

    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(channelValue(actual, pixelIndex, channel) - channelValue(expected, pixelIndex, channel))
      channelDeltaTotal += delta

      if (delta > maxChannelDelta) {
        maxChannelDelta = delta
      }

      if (delta > threshold.pixelDeltaThreshold) {
        pixelChanged = true
      }
    }

    if (pixelChanged) {
      changedPixels += 1
    }
  }

  const changedPixelRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels
  const meanChannelDelta = totalChannels === 0 ? 0 : channelDeltaTotal / totalChannels
  const passed =
    changedPixelRatio <= threshold.maxChangedPixelRatio &&
    meanChannelDelta <= threshold.maxMeanChannelDelta &&
    maxChannelDelta <= threshold.maxMaxChannelDelta

  return {
    passed,
    width: actual.width,
    height: actual.height,
    totalPixels,
    changedPixels,
    changedPixelRatio,
    meanChannelDelta,
    maxChannelDelta,
    reason: passed ? '' : 'threshold-exceeded'
  }
}

function missingResult(sample, tier, actualPath, expectedPath, threshold) {
  const actualExists = fs.existsSync(actualPath)
  const expectedExists = fs.existsSync(expectedPath)
  const reason = !expectedExists ? 'missing-expected-golden' : 'missing-actual-output'

  return {
    status: 'missing',
    reason,
    tier: tier.id,
    fileName: path.basename(expectedPath),
    sample: sample.sample,
    category: sample.category,
    capabilities: sample.capabilities,
    thresholdGroup: sample.thresholdGroup,
    threshold,
    metrics: null,
    actual: normalizeRelativePath(path.relative(repoRoot, actualPath)),
    expected: normalizeRelativePath(path.relative(repoRoot, expectedPath)),
    actualExists,
    expectedExists
  }
}

export function verifyVisualGoldens(options = {}) {
  const plan = buildVisualGoldenPlan(options)
  const tier = requireTier(plan.tier.id)
  const actualDir = resolveDirectory(options.actualDir, defaultActualDirectory(tier))
  const expectedDir = resolveDirectory(options.expectedDir, tier.directory)
  const results = []

  if (plan.status === 'failed') {
    return {
      command: 'verify',
      tier: plan.tier.id,
      status: 'failed',
      failureReason: plan.failureReason,
      sampleCount: plan.sampleCount,
      actualDir: normalizeRelativePath(path.relative(repoRoot, actualDir)),
      expectedDir: normalizeRelativePath(path.relative(repoRoot, expectedDir)),
      results,
      failures: []
    }
  }

  if (plan.status === 'skipped') {
    return {
      command: 'verify',
      tier: plan.tier.id,
      status: 'skipped',
      skipReason: plan.skipReason,
      sampleCount: plan.sampleCount,
      actualDir: normalizeRelativePath(path.relative(repoRoot, actualDir)),
      expectedDir: normalizeRelativePath(path.relative(repoRoot, expectedDir)),
      results,
      failures: []
    }
  }

  for (const sample of plan.samples) {
    const threshold = getThreshold(sample.thresholdGroup)
    const fileName = fileNameForSample(sample.sample, tier)
    const actualPath = path.join(actualDir, fileName)
    const expectedPath = path.join(expectedDir, fileName)

    if (!fs.existsSync(actualPath) || !fs.existsSync(expectedPath)) {
      results.push(missingResult(sample, tier, actualPath, expectedPath, threshold))
      continue
    }

    const metrics = comparePngFiles(actualPath, expectedPath, threshold)
    results.push({
      status: metrics.passed ? 'passed' : 'failed',
      reason: metrics.reason,
      sample: sample.sample,
      category: sample.category,
      capabilities: sample.capabilities,
      thresholdGroup: sample.thresholdGroup,
      threshold,
      metrics,
      actual: normalizeRelativePath(path.relative(repoRoot, actualPath)),
      expected: normalizeRelativePath(path.relative(repoRoot, expectedPath))
    })
  }

  const failures = results.filter((result) => result.status !== 'passed')

  return {
    command: 'verify',
    tier: plan.tier.id,
    status: failures.length === 0 ? 'passed' : 'failed',
    sampleCount: plan.sampleCount,
    checked: results.length,
    actualDir: normalizeRelativePath(path.relative(repoRoot, actualDir)),
    expectedDir: normalizeRelativePath(path.relative(repoRoot, expectedDir)),
    failures,
    results
  }
}

export function generateVisualGoldens(options = {}) {
  const sourceDir = options.sourceDir ? path.resolve(repoRoot, options.sourceDir) : null
  const plan = buildVisualGoldenPlan({
    ...options,
    allowSourceImport: sourceDir !== null
  })
  const tier = requireTier(plan.tier.id)
  const outputDir = resolveDirectory(options.outputDir, tier.directory)

  if (plan.status === 'failed') {
    return {
      command: 'generate',
      tier: plan.tier.id,
      status: 'failed',
      failureReason: plan.failureReason,
      sampleCount: plan.sampleCount,
      generated: [],
      missing: []
    }
  }

  if (plan.status === 'skipped') {
    return {
      command: 'generate',
      tier: plan.tier.id,
      status: 'skipped',
      skipReason: plan.skipReason,
      sampleCount: plan.sampleCount,
      generated: []
    }
  }

  if (!sourceDir) {
    return {
      command: 'generate',
      tier: plan.tier.id,
      status: 'skipped',
      skipReason: 'No --source-dir was provided. Use the native Windows runner to render PNGs, then import them with --source-dir.',
      sampleCount: plan.sampleCount,
      generated: []
    }
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const generated = []
  const missing = []

  for (const sample of plan.samples) {
    const fileName = fileNameForSample(sample.sample, tier)
    const sourcePath = path.join(sourceDir, fileName)
    const outputPath = path.join(outputDir, fileName)

    if (!fs.existsSync(sourcePath)) {
      missing.push({
        sample: sample.sample,
        category: sample.category,
        capabilities: sample.capabilities,
        source: normalizeRelativePath(path.relative(repoRoot, sourcePath))
      })
      continue
    }

    fs.copyFileSync(sourcePath, outputPath)
    generated.push({
      sample: sample.sample,
      category: sample.category,
      capabilities: sample.capabilities,
      output: normalizeRelativePath(path.relative(repoRoot, outputPath))
    })
  }

  return {
    command: 'generate',
    tier: plan.tier.id,
    status: missing.length === 0 ? 'generated' : 'failed',
    sampleCount: plan.sampleCount,
    generated,
    missing
  }
}

function printHumanReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    let report

    if (args.command === 'plan') {
      report = buildVisualGoldenPlan(args)
    } else if (args.command === 'verify') {
      report = verifyVisualGoldens(args)
    } else if (args.command === 'generate') {
      report = generateVisualGoldens(args)
    } else {
      throw new TypeError(`Unknown command "${args.command}". Expected plan, verify, or generate.`)
    }

    printHumanReport(report)
    if (report.status === 'failed') {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`)
    process.exitCode = 1
  }
}
