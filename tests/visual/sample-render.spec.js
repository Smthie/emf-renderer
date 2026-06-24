import { expect, test } from '@playwright/test'
import {
  collectFixtureSampleNames,
  getVisualTier,
  isRenderableSample,
  visualSnapshotName,
  visualTierSkip
} from '../helpers/read-fixture.js'

const visualTier = getVisualTier(process.env.EMF_VISUAL_TIER ?? 'darwin-browser')
const visualTierSkipState = visualTierSkip(visualTier, { hasNativeGoldenRunner: false })

test.skip(visualTierSkipState.skip, visualTierSkipState.reason)
test.skip(visualTier.renderer !== 'browser', `${visualTier.id} is a native golden tier, not a browser snapshot tier.`)

const samples = collectFixtureSampleNames()
  .filter(isRenderableSample)
  // These fixtures are recorded and calibrated by native Windows GDI+. Their
  // browser output is captured by golden-capture instead of the darwin tier.
  .filter((sample) => !sample.startsWith('synthetic/gdiplus/'))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

// Minimum number of non-white pixels a render must contain to count as
// "drew something". The smallest real-content sample (negative-win-org, a
// single thin text line) clears this by an order of magnitude, so the bar
// only ever catches genuinely blank output.
const MIN_INK_PIXELS = 8

// Samples that currently render blank (transparent or full-white) because of
// known, separately-tracked rendering gaps — NOT because the golden is a valid
// empty image. Kept explicit so a blank render is never silently frozen as
// "correct", and so fixing any of these trips this test (prompting removal).
// Tracked gaps: EMR_SMALLTEXTOUT (both small-text-out entries) and the
// degenerate-arc + HIMETRIC mapping combination.
const KNOWN_BLANK_SAMPLES = new Set([
  'real/render/real-libreoffice-test-arc-start-point-equal-end-point.emf',
  'real/render/real-libreoffice-test-small-text-out.emf',
  'real/render/real-libreoffice-test-small-text-out-ansi.emf'
])

function snapshotName(sample) {
  return visualSnapshotName(sample, visualTier)
}

// Count pixels that differ from white once the (transparent-background) render
// is composited onto white — i.e. the visible "ink". Detects both transparent
// blanks and opaque all-white blanks.
function countInkPixels(node) {
  const imageElement = /** @type {HTMLImageElement} */ (node)
  const canvas = document.createElement('canvas')
  canvas.width = imageElement.naturalWidth
  canvas.height = imageElement.naturalHeight
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(imageElement, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let ink = 0

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 248 || pixels[index + 1] < 248 || pixels[index + 2] < 248) {
      ink += 1
    }
  }

  return ink
}

for (const sample of samples) {
  test(`renders ${sample}`, async ({ page }) => {
    await page.goto(`/demo/?sample=${encodeURIComponent(sample)}`)
    await page.waitForSelector('img[data-render-result="ready"]', { timeout: 15000 })
    await expect(page.locator('#status')).toContainText('预览生成成功')

    const image = page.locator('#preview img')
    await expect(image).toBeVisible()

    const metrics = await image.evaluate((node) => {
      const imageElement = /** @type {HTMLImageElement} */ (node)
      return {
        width: imageElement.naturalWidth,
        height: imageElement.naturalHeight,
        loaded: imageElement.complete,
        isPngDataUrl: imageElement.src.startsWith('data:image/png;base64,')
      }
    })

    expect(metrics.width).toBeGreaterThan(0)
    expect(metrics.height).toBeGreaterThan(0)
    expect(metrics.loaded).toBe(true)
    expect(metrics.isPngDataUrl).toBe(true)

    // Content guard: a screenshot alone happily freezes a blank render as the
    // golden. Assert the render actually drew something, except for the
    // explicitly tracked known-blank samples (whose blankness is itself locked).
    const ink = await image.evaluate(countInkPixels)

    if (KNOWN_BLANK_SAMPLES.has(sample)) {
      expect(
        ink,
        `${sample} now renders content — fix tracked, remove it from KNOWN_BLANK_SAMPLES`
      ).toBeLessThan(MIN_INK_PIXELS)
    } else {
      expect(ink, `${sample} rendered blank (${ink} ink pixels)`).toBeGreaterThanOrEqual(MIN_INK_PIXELS)
    }

    await expect(image).toHaveScreenshot(snapshotName(sample))
  })
}
