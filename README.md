# emf-renderer

`emf-renderer` 是一个纯前端 EMF/EMF+ 渲染库，面向浏览器环境，将二进制 EMF 内容渲染为 Canvas，并支持导出 PNG Blob/Data URL。

## 项目定位

- 浏览器侧 EMF/EMF+ 渲染内核
- 统一公开 API：`renderEmf`、`renderEmfToBlob`、`renderEmfToDataUrl`（及同构的 `renderWmf` 系列）
- 以“渲染结果对象”为主，而不是单一导出格式

## 支持环境

- 浏览器主线程（`document.createElement('canvas')`）
- 支持 `OffscreenCanvas` 的 Worker 场景

当前不承诺：

- Node.js 原生无 Canvas 环境
- 非浏览器宿主的通用运行时渲染

## 安装

```bash
pnpm add emf-renderer
```

## 本地示例

```bash
pnpm dev:demo
```

然后访问 `http://127.0.0.1:4173/demo/`。

如需直接加载仓库内样本，可访问：

`http://127.0.0.1:4173/demo/?sample=synthetic%2Fclassic%2Fsynthetic-classic-shapes.emf`

## 最小使用示例

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

输入：

- `buffer`: `ArrayBuffer | Uint8Array`
- `options.width?`: 输出宽度覆盖值
- `options.height?`: 输出高度覆盖值
- `options.trimTransparentBounds?`: 是否裁剪透明边界

返回渲染结果对象：

- `canvas`: `HTMLCanvasElement | OffscreenCanvas`
- `width`: number
- `height`: number
- `meta.hasEmfPlus`: boolean
- `meta.records`: number[]
- `meta.warnings`: string[]
- `meta.unsupported`: string[]
- `meta.diagnostics`: `RenderDiagnostic[]` — 结构化的逐记录诊断；每项含 `level`（如 `"warning"` / `"unsupported"`）、`code`、`message`，并可选带 `source` / `recordType` / `recordOffset` / `objectId` / `capability`。降级或不支持的记录会在此显式上报，而非静默近似。
- `toBlob(): Promise<Blob>`
- `toDataUrl(): Promise<string>`

### `renderEmfToBlob(buffer, options?)`

- 便捷函数，等价于 `await (await renderEmf(buffer, options)).toBlob()`

### `renderEmfToDataUrl(buffer, options?)`

- 便捷函数，等价于 `await (await renderEmf(buffer, options)).toDataUrl()`

### `renderWmf(buffer, options?)` / `renderWmfToBlob` / `renderWmfToDataUrl`

- 与 `renderEmf` 系列同构，输入为 WMF（Windows Metafile）二进制
- 返回相同形状的渲染结果对象（`canvas`、`meta`、`toBlob`、`toDataUrl`）
- `options` 支持 `width`、`height`、`trimTransparentBounds`

```js
import { renderWmf, renderWmfToDataUrl } from 'emf-renderer'

const result = await renderWmf(wmfBuffer)
const dataUrl = await renderWmfToDataUrl(wmfBuffer)
```

## 当前支持范围与限制

- classic EMF 与 EMF+ 均已具备可用渲染链路
- 支持常见图元、路径、裁剪、文本、位图与部分 EMF+ 效果
- 仍存在协议空白（如部分 classic 记录语义、复杂 EMF+ 文本排版、位图格式覆盖不足）
- `meta.unsupported = []` 不等于与 GDI/GDI+ 像素级完全一致，视觉差异仍可能来自文本布局、渐变/插值策略与效果实现细节

## License

见 [LICENSE](./LICENSE)。
