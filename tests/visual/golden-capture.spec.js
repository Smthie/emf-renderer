import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'
import { goldenTiers, visualGoldenCoreSamples, visualGoldenSampleKey } from '../../samples/capability-matrix.js'

// Captures THIS renderer's output for the native-golden core samples so that
// `pnpm golden:verify --tier <id>` has an "actual" side to diff against the
// Windows GDI / GDI+ reference PNGs. Disabled by default — the regular visual
// suite should not write files. Enable with EMF_CAPTURE_GOLDEN_ACTUAL=1:
//
//   EMF_CAPTURE_GOLDEN_ACTUAL=1 npx playwright test golden-capture
//
// Renders are untrimmed and composited onto white to mirror how GDI paints a
// metafile onto an opaque device rectangle, which keeps dimensions and
// background comparable to the native reference.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const captureEnabled = process.env.EMF_CAPTURE_GOLDEN_ACTUAL === '1'

test.skip(!captureEnabled, 'Set EMF_CAPTURE_GOLDEN_ACTUAL=1 to capture native-golden actual renders.')

function actualPathFor(sample, tier) {
  const fileName = `${visualGoldenSampleKey(sample)}-${tier.id}.png`
  return path.join(repoRoot, 'tests/visual/actual', tier.id, fileName)
}

const nativeGoldenTiers = goldenTiers.filter((tier) => tier.kind === 'golden')

for (const tier of nativeGoldenTiers) {
  const samples = visualGoldenCoreSamples
    .filter((entry) => entry.tier === tier.id)
    .map((entry) => entry.sample)

  for (const sample of samples) {
    test(`captures ${tier.id} actual for ${sample}`, async ({ page }) => {
      await page.goto('/demo/')

      const dataUrl = await page.evaluate(async (samplePath) => {
        const { renderEmf } = await import('/src/index.js')
        const response = await fetch(`/samples/${samplePath.split('/').map(encodeURIComponent).join('/')}`)
        const buffer = await response.arrayBuffer()
        const result = await renderEmf(buffer, { trimTransparentBounds: false })
        const source = result.canvas
        const composited = document.createElement('canvas')
        composited.width = source.width
        composited.height = source.height
        const context = composited.getContext('2d')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, composited.width, composited.height)
        context.drawImage(source, 0, 0)
        return composited.toDataURL('image/png')
      }, sample)

      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      const outputPath = actualPathFor(sample, tier)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'))
    })
  }
}
