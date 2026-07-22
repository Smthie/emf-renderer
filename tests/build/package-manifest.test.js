import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packageJsonPath = path.join(rootDir, 'package.json')

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
}

describe('package manifest', () => {
  test('exposes publish-ready metadata and non-latest dependency versions', () => {
    const manifest = readPackageJson()

    expect(manifest.name).toBe('emf-renderer')
    expect(manifest.private).toBe(false)
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('./dist/emf-renderer.js')
    expect(manifest.files).toEqual(['dist', 'README.md', 'README.zh-CN.md', 'LICENSE'])
    expect(manifest.exports?.['.']?.import).toBe('./dist/emf-renderer.js')
    expect(manifest.exports?.['.']?.types).toBe('./dist/types/index.d.ts')
    expect(manifest.types).toBe('./dist/types/index.d.ts')
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.scripts?.build).toBe('vite build')
    expect(manifest.scripts?.['build:types']).toBe('tsc -p tsconfig.json')
    expect(manifest.scripts?.prepack).toBe('pnpm build && pnpm build:types')
    expect(manifest.scripts?.['dev:demo']).toBe('vite')
    expect(manifest.scripts?.dev).toBeUndefined()
    expect(manifest.scripts?.preview).toBeUndefined()
    expect(manifest.scripts?.['test:visual']).toBe('playwright test')

    for (const section of ['dependencies', 'devDependencies']) {
      const deps = manifest[section] ?? {}
      for (const version of Object.values(deps)) {
        expect(typeof version).toBe('string')
        expect(version.toLowerCase()).not.toBe('latest')
      }
    }
  })
})
