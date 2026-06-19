import fs from 'node:fs'
import {
  capabilityMatrix,
  gapTriage,
  goldenTiers,
  visualGoldenSampleKey
} from '../../samples/capability-matrix.js'

export const samplesRoot = new URL('../../samples/', import.meta.url)
export const defaultVisualTierId = 'darwin-browser'

export function sortFixtureSampleNames(left, right) {
  return left.localeCompare(right, undefined, { numeric: true })
}

export function collectFixtureSampleNames(directory = samplesRoot, prefix = '') {
  const samples = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      samples.push(
        ...collectFixtureSampleNames(
          new URL(`${entry.name}/`, directory),
          `${prefix}${entry.name}/`
        )
      )
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.emf')) {
      samples.push(`${prefix}${entry.name}`)
    }
  }

  return samples.sort(sortFixtureSampleNames)
}

export function isParseGapSample(name) {
  return name.includes('/parse-gap/')
}

export function isRenderGapSample(name) {
  return name.includes('/render-gap/')
}

export function isRenderableSample(name) {
  return !isParseGapSample(name) && !isRenderGapSample(name)
}

export function fixtureSampleUrl(name) {
  return new URL(name, samplesRoot)
}

export function fixtureSampleExists(name) {
  return fs.existsSync(fixtureSampleUrl(name))
}

// The samples/real/ and samples/original/ fixture trees are untracked
// local-only content: fresh clones and CI have only the synthetic samples.
// Assertions that require a fixture FILE to exist must first check that its
// top-level directory is present at all.
export function hasLocalSampleDir(prefix) {
  return fs.existsSync(new URL(`${prefix}/`, samplesRoot))
}

export function getSampleCapability(name) {
  return capabilityMatrix.find((entry) => entry.sample === name) ?? null
}

export function getGapTriage(name) {
  return gapTriage.find((entry) => entry.sample === name) ?? null
}

export function listVisualTiers(kind = null) {
  return kind === null ? [...goldenTiers] : goldenTiers.filter((tier) => tier.kind === kind)
}

export function getVisualTier(id = defaultVisualTierId) {
  const tier = goldenTiers.find((entry) => entry.id === id)

  if (!tier) {
    const knownTiers = goldenTiers.map((entry) => entry.id).join(', ')
    throw new TypeError(`Unknown visual comparison tier "${id}". Known tiers: ${knownTiers}.`)
  }

  return tier
}

export function visualTierSkip(tierOrId = defaultVisualTierId, options = {}) {
  const tier = typeof tierOrId === 'string' ? getVisualTier(tierOrId) : tierOrId
  const platform = options.platform ?? process.platform

  if (tier.platform && tier.platform !== platform) {
    return {
      skip: true,
      reason: `${tier.id} requires ${tier.platform}; current platform is ${platform}.`
    }
  }

  if (tier.kind === 'golden' && tier.required === false && options.hasNativeGoldenRunner === false) {
    return {
      skip: true,
      reason: `${tier.id} is an optional native golden tier and no native golden runner is configured.`
    }
  }

  return { skip: false, reason: '' }
}

export function visualSnapshotName(name, tierOrId = defaultVisualTierId) {
  const tier = typeof tierOrId === 'string' ? getVisualTier(tierOrId) : tierOrId
  const fileName = name.split('/').at(-1)

  if (tier.id === defaultVisualTierId) {
    // Playwright appends "-<platform>" before the extension and rewrites any
    // remaining dots in the stem to dashes. Normalize the dots here so the
    // returned name is the literal on-disk basename (minus the platform
    // suffix) instead of relying on that implicit rewrite — e.g.
    // "real-...-vector-image.emf" -> "real-...-vector-image-emf-darwin.png".
    return `${fileName.replaceAll('.', '-')}.png`
  }

  return `${visualGoldenSampleKey(name)}-${tier.id}.png`
}

export function readFixtureArrayBuffer(name) {
  const file = fs.readFileSync(fixtureSampleUrl(name))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}
