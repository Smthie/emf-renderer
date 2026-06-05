import { renderEmfToDataUrl } from '../src/index.js'

const EMPTY_PREVIEW_MARKUP = '<div class="empty">导入后将在这里显示渲染结果</div>'

const fileInput = document.getElementById('fileInput')
const fileName = document.getElementById('fileName')
const status = document.getElementById('status')
const preview = document.getElementById('preview')

let renderRequestId = 0

function setStatus(message, type) {
  status.textContent = message
  status.className = `status status--${type}`
}

function clearPreview() {
  preview.innerHTML = EMPTY_PREVIEW_MARKUP
}

function mountImage(image) {
  preview.innerHTML = ''
  image.dataset.renderResult = 'ready'
  preview.append(image)
}

function createPreviewImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let settled = false

    function finalize(handler) {
      if (settled) {
        return
      }

      settled = true
      image.removeEventListener('load', handleLoad)
      image.removeEventListener('error', handleError)
      handler()
    }

    function handleLoad() {
      finalize(() => resolve(image))
    }

    function handleError() {
      finalize(() => reject(new Error('渲染结果加载失败')))
    }

    image.addEventListener('load', handleLoad)
    image.addEventListener('error', handleError)
    image.src = dataUrl

    if (typeof image.decode === 'function') {
      image
        .decode()
        .then(handleLoad)
        .catch(() => {})
    }
  })
}

function normalizeSampleName(sample) {
  if (typeof sample !== 'string' || sample.length === 0) {
    return null
  }

  const value = sample.trim()
  const segments = value.split('/')

  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..' || !/^[\w.-]+$/i.test(segment)
    ) ||
    !segments.at(-1)?.toLowerCase().endsWith('.emf')
  ) {
    return null
  }

  return segments.join('/')
}

function encodeSamplePath(sample) {
  return sample.split('/').map(encodeURIComponent).join('/')
}

async function renderBuffer(buffer, label) {
  const requestId = ++renderRequestId
  fileName.textContent = label
  setStatus('正在解析...', 'loading')

  try {
    const data = await renderEmfToDataUrl(buffer, {
      trimTransparentBounds: true
    })
    const image = await createPreviewImage(data)

    if (requestId !== renderRequestId) {
      return
    }

    mountImage(image)
    setStatus('预览生成成功。', 'hint')
  } catch (error) {
    if (requestId !== renderRequestId) {
      return
    }

    console.error(error)
    clearPreview()
    setStatus(`文件解析失败：${error instanceof Error ? error.message : '请确认文件有效。'}`, 'error')
  }
}

async function loadSample(sample) {
  const sampleName = normalizeSampleName(sample)

  if (!sampleName) {
    setStatus('示例文件名无效。', 'error')
    clearPreview()
    return
  }

  setStatus('正在加载示例文件...', 'loading')
  fileName.textContent = sampleName

  const response = await fetch(`/samples/${encodeSamplePath(sampleName)}`)

  if (!response.ok) {
    throw new Error(`示例文件加载失败：HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  await renderBuffer(buffer, sampleName)
}

fileInput.addEventListener('change', async (event) => {
  const input = /** @type {HTMLInputElement | null} */ (event.currentTarget)
  const file = input?.files?.[0]

  if (!file) {
    fileName.textContent = '未选择文件'
    setStatus('请选择 EMF 文件进行预览。', 'hint')
    clearPreview()
    return
  }

  const buffer = await file.arrayBuffer()
  await renderBuffer(buffer, file.name)
})

async function bootstrap() {
  clearPreview()

  const sample = new URL(window.location.href).searchParams.get('sample')

  if (!sample) {
    setStatus('请选择 EMF 文件进行预览。', 'hint')
    return
  }

  try {
    await loadSample(sample)
  } catch (error) {
    console.error(error)
    clearPreview()
    setStatus(`示例文件加载失败：${error instanceof Error ? error.message : '请确认路径有效。'}`, 'error')
  }
}

void bootstrap()
