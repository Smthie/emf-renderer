import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  expect: {
    // Absorb sub-pixel antialiasing jitter between captures without masking
    // real regressions: a per-pixel comparison threshold plus a 1% diff-ratio
    // budget. Deterministic renders match exactly; only AA halos differ.
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixelRatio: 0.01
    }
  },
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'pnpm dev:demo',
    url: 'http://127.0.0.1:4173/demo/',
    reuseExistingServer: true,
    timeout: 120000
  }
})
