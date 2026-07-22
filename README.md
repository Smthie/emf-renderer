# emf-renderer

English | [简体中文](./README.zh-CN.md)

A pure front-end rendering library for Windows metafiles — classic EMF, EMF+, and WMF. It renders binary metafile content to a Canvas in the browser and exports PNG `Blob`s or data URLs.

## Positioning

- A browser-side EMF/EMF+/WMF rendering engine
- A unified public API: `renderEmf`, `renderEmfToBlob`, `renderEmfToDataUrl`, plus the isomorphic `renderWmf` family
- Centered on a render-result object rather than a single export format

## Supported environments

- Browser main thread (`document.createElement('canvas')`)
- Worker contexts with `OffscreenCanvas` support

Not currently promised:

- Node.js environments without a native Canvas
- General-purpose rendering in non-browser hosts

The package ships as ESM only.

## Install

```bash
pnpm add emf-renderer
# or
npm install emf-renderer
```

## Quick start

```js
import { renderEmf, renderEmfToBlob, renderEmfToDataUrl } from 'emf-renderer'

async function main() {
  const buffer = await fetch('/path/to/example.emf').then((response) => response.arrayBuffer())

  const result = await renderEmf(buffer, {
    width: 800,
    height: 600,
    trimTransparentBounds: true
  })

  const canvas = result.canvas
  const blob = await result.toBlob()
  const dataUrl = await result.toDataUrl()

  const blob2 = await renderEmfToBlob(buffer)
  const dataUrl2 = await renderEmfToDataUrl(buffer)

  document.body.append(canvas)
  console.log({ blob, dataUrl, blob2, dataUrl2 })
}

main()
```

## API

### `renderEmf(buffer, options?)`

Input:

- `buffer`: `ArrayBuffer | Uint8Array`
- `options.width?`: output width override
- `options.height?`: output height override
- `options.trimTransparentBounds?`: trim transparent borders from the output

Returns a render-result object:

- `canvas`: `HTMLCanvasElement | OffscreenCanvas`
- `width`: number
- `height`: number
- `meta.hasEmfPlus`: boolean
- `meta.records`: number[]
- `meta.warnings`: string[]
- `meta.unsupported`: string[]
- `meta.diagnostics`: `RenderDiagnostic[]` — structured per-record diagnostics; each entry carries `level` (e.g. `"warning"` / `"unsupported"`), `code`, and `message`, optionally with `source` / `recordType` / `recordOffset` / `objectId` / `capability`. Degraded or unsupported records are reported here explicitly instead of being silently approximated.
- `toBlob(): Promise<Blob>`
- `toDataUrl(): Promise<string>`

### `renderEmfToBlob(buffer, options?)`

- Convenience wrapper, equivalent to `await (await renderEmf(buffer, options)).toBlob()`

### `renderEmfToDataUrl(buffer, options?)`

- Convenience wrapper, equivalent to `await (await renderEmf(buffer, options)).toDataUrl()`

### `renderWmf(buffer, options?)` / `renderWmfToBlob` / `renderWmfToDataUrl`

- Isomorphic to the `renderEmf` family; the input is a WMF (Windows Metafile) binary
- Returns the same render-result shape (`canvas`, `meta`, `toBlob`, `toDataUrl`)
- `options` supports `width`, `height`, and `trimTransparentBounds`

```js
import { renderWmf, renderWmfToDataUrl } from 'emf-renderer'

const result = await renderWmf(wmfBuffer)
const dataUrl = await renderWmfToDataUrl(wmfBuffer)
```

## Current scope and limitations

- Both classic EMF and EMF+ have working render pipelines
- Supports common primitives, paths, clipping, text, bitmaps, and a range of EMF+ effects
- Protocol gaps remain (some classic record semantics, complex EMF+ text layout, incomplete bitmap format coverage)
- `meta.unsupported = []` does not mean pixel-perfect parity with GDI/GDI+; visual differences can still come from text layout, gradient/interpolation strategies, and effect implementation details

## Local demo

```bash
pnpm dev:demo
```

Then open `http://127.0.0.1:4173/demo/`.

To load a sample shipped with the repository:

`http://127.0.0.1:4173/demo/?sample=synthetic%2Fclassic%2Fsynthetic-classic-shapes.emf`

## License

[MIT](./LICENSE)
