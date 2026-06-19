import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const distDir = path.join(rootDir, 'dist')

function listFilesRecursively(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return listFilesRecursively(entryPath)
    }

    return [path.relative(distDir, entryPath)]
  })
}

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true })
}

afterEach(() => {
  cleanDist()
})

describe('library build output', () => {
  test('pnpm build emits one readable esm file', async () => {
    cleanDist()
    execFileSync('pnpm', ['build'], {
      cwd: rootDir,
      stdio: 'pipe'
    })

    expect(listFilesRecursively(distDir).sort()).toEqual(['emf-renderer.js'])

    const outputFile = path.join(distDir, 'emf-renderer.js')
    const content = fs.readFileSync(outputFile, 'utf8')
    const builtModule = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`)

    expect(Object.keys(builtModule).sort()).toEqual([
      'renderEmf',
      'renderEmfToBlob',
      'renderEmfToDataUrl',
      'renderWmf',
      'renderWmfToBlob',
      'renderWmfToDataUrl'
    ])
    expect(typeof builtModule.renderEmf).toBe('function')
    expect(typeof builtModule.renderEmfToBlob).toBe('function')
    expect(typeof builtModule.renderEmfToDataUrl).toBe('function')
    expect('default' in builtModule).toBe(false)
    expect(content.split('\n').length).toBeGreaterThan(20)
    expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(false)
    expect(fs.existsSync(path.join(distDir, 'assets'))).toBe(false)
  }, 30000)

  test('pnpm build:types emits public type declarations', () => {
    cleanDist()
    execFileSync('pnpm', ['build:types'], {
      cwd: rootDir,
      stdio: 'pipe'
    })

    const entryDeclaration = path.join(distDir, 'types', 'index.d.ts')
    const renderDeclaration = path.join(distDir, 'types', 'render-emf.d.ts')

    expect(fs.existsSync(entryDeclaration)).toBe(true)
    expect(fs.existsSync(renderDeclaration)).toBe(true)

    const entry = fs.readFileSync(entryDeclaration, 'utf8')
    for (const name of [
      'renderEmf',
      'renderEmfToBlob',
      'renderEmfToDataUrl',
      'renderWmf',
      'renderWmfToBlob',
      'renderWmfToDataUrl'
    ]) {
      expect(entry).toContain(name)
    }

    const render = fs.readFileSync(renderDeclaration, 'utf8')
    expect(render).toContain(
      'export function renderEmf(buffer: ArrayBuffer | Uint8Array, options?: RenderOptions): Promise<RenderResult>'
    )
    expect(render).toContain(
      'export function renderWmf(buffer: ArrayBuffer | Uint8Array, options?: RenderOptions): Promise<RenderResult>'
    )
    expect(render).toContain('export type RenderResult')
    expect(render).toContain('export type RenderOptions')
  }, 30000)
})
