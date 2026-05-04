import { decodeBrushObject } from './brush.js'
import { decodeCustomLineCapObject } from './custom-line-cap.js'
import { decodeImageObject } from './image.js'
import { decodePathObject } from './path.js'
import { decodePenObject } from './pen.js'
import { decodeRegionObject } from './region.js'
import { decodeEmfPlusFont, decodeEmfPlusStringFormat } from '../../runtime/text-layout.js'
import { decodeArgb } from '../primitives.js'

const COLOR_MATRIX_EFFECT_GUID = '718f2615-7933-40e3-a511-5f68fe14dd74'
const BLUR_EFFECT_GUID = '633c80a4-1843-482b-9ef2-be2834c5fdd4'
const SHARPEN_EFFECT_GUID = '63cbf3ee-c526-402c-8f71-62c540bf5142'
const BRIGHTNESS_CONTRAST_EFFECT_GUID = 'd3a1dbe1-8ec4-4c17-9f4c-ea97ad1c343d'
const HUE_SATURATION_LIGHTNESS_EFFECT_GUID = '8b2dd6c3-eb07-4d87-a5f0-7108e26a9c5f'
const LEVELS_EFFECT_GUID = '99c354ec-2a31-4f3a-8c34-17a803b33a25'
const TINT_EFFECT_GUID = '1077af00-2848-4441-9489-44ad4c2d7a2c'
const COLOR_BALANCE_EFFECT_GUID = '537e597d-251e-48da-9664-29ca496b70f8'
const COLOR_CURVE_EFFECT_GUID = 'dd6a0022-58e4-4a67-9d9b-d48eb881a53d'
const COLOR_LOOKUP_TABLE_EFFECT_GUID = 'a7ce72a9-0f7f-40d7-b3cc-d0c02d5c3212'
const RED_EYE_CORRECTION_EFFECT_GUID = '74d29d05-69a4-4266-9549-3cc52836b632'

function decodeWrapMode(value) {
  return (
    {
      0: 'tile',
      1: 'tileFlipX',
      2: 'tileFlipY',
      3: 'tileFlipXY',
      4: 'clamp'
    }[value] || 'tile'
  )
}

function decodeEmfPlusImageAttributes(view, offset, dataSize) {
  return {
    kind: 'imageAttributes',
    graphicsVersion: dataSize >= 4 ? view.getUint32(offset, true) : 0,
    attributeType: dataSize >= 8 ? view.getUint32(offset + 4, true) : 0,
    wrapMode: dataSize >= 12 ? decodeWrapMode(view.getUint32(offset + 8, true)) : 'tile',
    wrapColor: dataSize >= 16 ? decodeArgb(view.getUint32(offset + 12, true)) : 'rgba(0, 0, 0, 0)',
    clamp: dataSize >= 20 ? view.getInt32(offset + 16, true) !== 0 : false,
    objectClamp: dataSize >= 24 ? view.getInt32(offset + 20, true) !== 0 : false
  }
}

function formatGuid(view, offset) {
  const data1 = view.getUint32(offset, true).toString(16).padStart(8, '0')
  const data2 = view.getUint16(offset + 4, true).toString(16).padStart(4, '0')
  const data3 = view.getUint16(offset + 6, true).toString(16).padStart(4, '0')
  const tail = Array.from(new Uint8Array(view.buffer, view.byteOffset + offset + 8, 8)).map((value) =>
    value.toString(16).padStart(2, '0')
  )

  return `${data1}-${data2}-${data3}-${tail.slice(0, 2).join('')}-${tail.slice(2).join('')}`
}

function decodeColorMatrixEffect(view, offset) {
  const matrix = []
  let cursor = offset

  for (let row = 0; row < 5; row += 1) {
    const values = []

    for (let column = 0; column < 5; column += 1) {
      values.push(view.getFloat32(cursor, true))
      cursor += 4
    }

    matrix.push(values)
  }

  return matrix
}

function decodeBlurEffect(view, offset) {
  return {
    radius: view.getFloat32(offset, true),
    expandEdge: view.getInt32(offset + 4, true) !== 0
  }
}

function decodeSharpenEffect(view, offset) {
  return {
    radius: view.getFloat32(offset, true),
    amount: view.getFloat32(offset + 4, true)
  }
}

function decodeBrightnessContrastEffect(view, offset) {
  return {
    brightnessLevel: view.getInt32(offset, true),
    contrastLevel: view.getInt32(offset + 4, true)
  }
}

function decodeHueSaturationLightnessEffect(view, offset) {
  return {
    hueLevel: view.getInt32(offset, true),
    saturationLevel: view.getInt32(offset + 4, true),
    lightnessLevel: view.getInt32(offset + 8, true)
  }
}

function decodeLevelsEffect(view, offset) {
  return {
    highlight: view.getInt32(offset, true),
    midtone: view.getInt32(offset + 4, true),
    shadow: view.getInt32(offset + 8, true)
  }
}

function decodeTintEffect(view, offset) {
  return {
    hue: view.getInt32(offset, true),
    amount: view.getInt32(offset + 4, true)
  }
}

function decodeColorBalanceEffect(view, offset) {
  return {
    cyanRed: view.getInt32(offset, true),
    magentaGreen: view.getInt32(offset + 4, true),
    yellowBlue: view.getInt32(offset + 8, true)
  }
}

function decodeColorCurveEffect(view, offset) {
  return {
    adjustment: view.getUint32(offset, true),
    channel: view.getUint32(offset + 4, true),
    adjustValue: view.getInt32(offset + 8, true)
  }
}

function decodeColorLookupTableEffect(view, offset) {
  return {
    lutB: Array.from(new Uint8Array(view.buffer, view.byteOffset + offset, 256)),
    lutG: Array.from(new Uint8Array(view.buffer, view.byteOffset + offset + 256, 256)),
    lutR: Array.from(new Uint8Array(view.buffer, view.byteOffset + offset + 512, 256)),
    lutA: Array.from(new Uint8Array(view.buffer, view.byteOffset + offset + 768, 256))
  }
}

function decodeRectL(view, offset) {
  return {
    left: view.getInt32(offset, true),
    top: view.getInt32(offset + 4, true),
    right: view.getInt32(offset + 8, true),
    bottom: view.getInt32(offset + 12, true)
  }
}

function decodeRedEyeCorrectionEffect(view, offset, availableSize) {
  if (availableSize < 4) {
    return {
      numberOfAreas: 0,
      areas: []
    }
  }

  const numberOfAreas = view.getUint32(offset, true)
  const areas = []
  const maxAreas = Math.max(0, Math.floor((availableSize - 4) / 16))

  for (let index = 0; index < Math.min(numberOfAreas, maxAreas); index += 1) {
    areas.push(decodeRectL(view, offset + 4 + index * 16))
  }

  return {
    numberOfAreas,
    areas
  }
}

const EFFECT_DECODERS = new Map([
  [
    COLOR_MATRIX_EFFECT_GUID,
    {
      type: 'colorMatrix',
      minimumSize: 100,
      decode(view, offset) {
        return {
          matrix: decodeColorMatrixEffect(view, offset)
        }
      }
    }
  ],
  [BLUR_EFFECT_GUID, { type: 'blur', minimumSize: 8, decode: decodeBlurEffect }],
  [SHARPEN_EFFECT_GUID, { type: 'sharpen', minimumSize: 8, decode: decodeSharpenEffect }],
  [
    BRIGHTNESS_CONTRAST_EFFECT_GUID,
    { type: 'brightnessContrast', minimumSize: 8, decode: decodeBrightnessContrastEffect }
  ],
  [
    HUE_SATURATION_LIGHTNESS_EFFECT_GUID,
    { type: 'hueSaturationLightness', minimumSize: 12, decode: decodeHueSaturationLightnessEffect }
  ],
  [LEVELS_EFFECT_GUID, { type: 'levels', minimumSize: 12, decode: decodeLevelsEffect }],
  [TINT_EFFECT_GUID, { type: 'tint', minimumSize: 8, decode: decodeTintEffect }],
  [COLOR_BALANCE_EFFECT_GUID, { type: 'colorBalance', minimumSize: 12, decode: decodeColorBalanceEffect }],
  [COLOR_CURVE_EFFECT_GUID, { type: 'colorCurve', minimumSize: 12, decode: decodeColorCurveEffect }],
  [COLOR_LOOKUP_TABLE_EFFECT_GUID, { type: 'colorLookupTable', minimumSize: 1024, decode: decodeColorLookupTableEffect }],
  [
    RED_EYE_CORRECTION_EFFECT_GUID,
    {
      type: 'redEyeCorrection',
      minimumSize: 4,
      decode(view, offset, availableSize) {
        return decodeRedEyeCorrectionEffect(view, offset, availableSize)
      }
    }
  ]
])

export function decodeEmfPlusSerializableObject(record, parsed) {
  if ((record.dataSize ?? 0) < 20) {
    return null
  }

  const guid = formatGuid(parsed.view, record.dataOffset)
  const payloadSize = parsed.view.getUint32(record.dataOffset + 16, true)
  const payloadOffset = record.dataOffset + 20
  const availableSize = Math.max(0, Math.min(payloadSize, (record.dataSize ?? 0) - 20))
  const descriptor = EFFECT_DECODERS.get(guid)

  if (descriptor && availableSize >= descriptor.minimumSize) {
    return {
      kind: 'effect',
      type: descriptor.type,
      guid,
      ...descriptor.decode(parsed.view, payloadOffset, availableSize)
    }
  }

  return {
    kind: 'effect',
    type: 'unknown',
    guid,
    bufferSize: payloadSize
  }
}

export function decodeEmfPlusObject(record, parsed) {
  const objectType = (record.flags >> 8) & 0x7f

  if (objectType === 1) {
    return decodeBrushObject(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 2) {
    return decodePenObject(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 3) {
    return decodePathObject(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 4) {
    return decodeRegionObject(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 5) {
    return decodeImageObject(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 8) {
    return decodeEmfPlusImageAttributes(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 6) {
    return decodeEmfPlusFont(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 7) {
    return decodeEmfPlusStringFormat(parsed.view, record.dataOffset, record.dataSize)
  }

  if (objectType === 9) {
    return decodeCustomLineCapObject(parsed.view, record.dataOffset, record.dataSize)
  }

  return null
}
