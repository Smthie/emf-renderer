import { createClosedCardinalSplineGeometry } from '../../runtime/path-builder.js'
import { decodeImageObject } from './image.js'
import { decodePathObject } from './path.js'
import { decodeArgb, readMatrix, readPointF, readPointFArray, readRectF } from '../primitives.js'

const BRUSH_TYPE_SOLID = 0
const BRUSH_TYPE_HATCH = 1
const BRUSH_TYPE_TEXTURE = 2
const BRUSH_TYPE_PATH_GRADIENT = 3
const BRUSH_TYPE_LINEAR_GRADIENT = 4
const BRUSH_DATA_PATH = 0x00000001
const BRUSH_DATA_TRANSFORM = 0x00000002
const BRUSH_DATA_PRESET_COLORS = 0x00000004
const BRUSH_DATA_BLEND_FACTORS_H = 0x00000008
const BRUSH_DATA_BLEND_FACTORS_V = 0x00000010
const BRUSH_DATA_FOCUS_SCALES = 0x00000040

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

function readBlendFactors(view, offset, end, target) {
  if (offset + 4 > end) {
    return offset
  }

  const count = view.getUint32(offset, true)
  let cursor = offset + 4

  if (count > 0 && cursor + count * 4 <= end) {
    target.blendPositions = []

    for (let index = 0; index < count; index += 1) {
      target.blendPositions.push(view.getFloat32(cursor, true))
      cursor += 4
    }
  }

  if (count > 0 && cursor + count * 4 <= end) {
    target.blendFactors = []

    for (let index = 0; index < count; index += 1) {
      target.blendFactors.push(view.getFloat32(cursor, true))
      cursor += 4
    }
  }

  return cursor
}

function readBlendColors(view, offset, end, target) {
  if (offset + 4 > end) {
    return offset
  }

  const count = view.getUint32(offset, true)
  let cursor = offset + 4

  if (count > 0 && cursor + count * 4 <= end) {
    target.presetPositions = []

    for (let index = 0; index < count; index += 1) {
      target.presetPositions.push(view.getFloat32(cursor, true))
      cursor += 4
    }
  }

  if (count > 0 && cursor + count * 4 <= end) {
    target.presetColors = []

    for (let index = 0; index < count; index += 1) {
      target.presetColors.push(decodeArgb(view.getUint32(cursor, true)))
      cursor += 4
    }
  }

  return cursor
}

function decodeSolidBrush(view, dataOffset) {
  return {
    kind: 'brush',
    type: 'solid',
    color: decodeArgb(view.getUint32(dataOffset, true))
  }
}

function decodeHatchBrush(view, dataOffset) {
  return {
    kind: 'brush',
    type: 'hatch',
    hatchStyle: view.getUint32(dataOffset, true),
    foreColor: decodeArgb(view.getUint32(dataOffset + 4, true)),
    backColor: decodeArgb(view.getUint32(dataOffset + 8, true))
  }
}

function decodeLinearGradientBrush(view, dataOffset, dataSize) {
  const brush = {
    kind: 'brush',
    type: 'linearGradient',
    brushDataFlags: view.getUint32(dataOffset, true),
    wrapMode: decodeWrapMode(view.getUint32(dataOffset + 4, true)),
    rect: readRectF(view, dataOffset + 8),
    startColor: decodeArgb(view.getUint32(dataOffset + 24, true)),
    endColor: decodeArgb(view.getUint32(dataOffset + 28, true))
  }
  // EmfPlusLinearGradientBrushData places two Reserved ARGB fields (Reserved1 at
  // +32, Reserved2 at +36 — GDI+ writes copies of Start/EndColor there) between
  // EndColor and OptionalData, so the transform/blend/preset block starts at +40,
  // not +32. Reading at +32 mis-decoded the Reserved color bytes as the brush
  // transform matrix (values near FLT_MAX), which collapsed the gradient to a
  // near-solid fill.
  let cursor = dataOffset + 40
  const end = dataOffset + Math.max(0, dataSize)

  if ((brush.brushDataFlags & BRUSH_DATA_TRANSFORM) !== 0 && cursor + 24 <= end) {
    brush.transform = readMatrix(view, cursor)
    cursor += 24
  }

  if ((brush.brushDataFlags & (BRUSH_DATA_BLEND_FACTORS_H | BRUSH_DATA_BLEND_FACTORS_V)) !== 0 && cursor + 8 <= end) {
    cursor = readBlendFactors(view, cursor, end, brush)
  }

  if ((brush.brushDataFlags & BRUSH_DATA_PRESET_COLORS) !== 0 && cursor + 8 <= end) {
    cursor = readBlendColors(view, cursor, end, brush)
  }

  return brush
}

function decodePathGradientBrush(view, dataOffset, dataSize) {
  const brush = {
    kind: 'brush',
    type: 'pathGradient',
    brushDataFlags: view.getUint32(dataOffset, true),
    wrapMode: decodeWrapMode(view.getUint32(dataOffset + 4, true)),
    centerColor: decodeArgb(view.getUint32(dataOffset + 8, true)),
    centerPoint: readPointF(view, dataOffset + 12),
    surroundingColors: []
  }
  const end = dataOffset + Math.max(0, dataSize)
  const surroundingColorCount = view.getUint32(dataOffset + 20, true)
  let cursor = dataOffset + 24

  if (surroundingColorCount > 0 && cursor + surroundingColorCount * 4 <= end) {
    for (let index = 0; index < surroundingColorCount; index += 1) {
      brush.surroundingColors.push(decodeArgb(view.getUint32(cursor, true)))
      cursor += 4
    }
  }

  if ((brush.brushDataFlags & BRUSH_DATA_PATH) !== 0) {
    const boundaryPathSize = cursor + 4 <= end ? Math.max(0, view.getInt32(cursor, true)) : 0

    if (boundaryPathSize > 0 && cursor + 4 + boundaryPathSize <= end) {
      brush.boundaryPath = decodePathObject(view, cursor + 4, boundaryPathSize)
      cursor += 4 + boundaryPathSize
    }
  } else if (cursor + 4 <= end) {
    const boundaryPointCount = view.getUint32(cursor, true)
    cursor += 4

    if (boundaryPointCount > 0 && cursor + boundaryPointCount * 8 <= end) {
      brush.boundaryPoints = readPointFArray(view, cursor, boundaryPointCount)
      brush.boundaryPath = createClosedCardinalSplineGeometry(brush.boundaryPoints)
      cursor += boundaryPointCount * 8
    }
  }

  if ((brush.brushDataFlags & BRUSH_DATA_TRANSFORM) !== 0 && cursor + 24 <= end) {
    brush.transform = readMatrix(view, cursor)
    cursor += 24
  }

  if ((brush.brushDataFlags & BRUSH_DATA_PRESET_COLORS) !== 0 && cursor + 8 <= end) {
    cursor = readBlendColors(view, cursor, end, brush)
  } else if ((brush.brushDataFlags & (BRUSH_DATA_BLEND_FACTORS_H | BRUSH_DATA_BLEND_FACTORS_V)) !== 0 && cursor + 8 <= end) {
    cursor = readBlendFactors(view, cursor, end, brush)
  }

  if ((brush.brushDataFlags & BRUSH_DATA_FOCUS_SCALES) !== 0 && cursor + 12 <= end) {
    const focusScaleCount = view.getUint32(cursor, true)

    if (focusScaleCount === 2) {
      brush.focusScale = {
        x: view.getFloat32(cursor + 4, true),
        y: view.getFloat32(cursor + 8, true)
      }
    }
  }

  return brush
}

function decodeTextureBrush(view, dataOffset, dataSize) {
  const brush = {
    kind: 'brush',
    type: 'texture',
    brushDataFlags: view.getUint32(dataOffset, true),
    wrapMode: decodeWrapMode(view.getUint32(dataOffset + 4, true))
  }
  const end = dataOffset + Math.max(0, dataSize)
  let cursor = dataOffset + 8

  if ((brush.brushDataFlags & BRUSH_DATA_TRANSFORM) !== 0 && cursor + 24 <= end) {
    brush.transform = readMatrix(view, cursor)
    cursor += 24
  }

  if (cursor + 12 <= end) {
    brush.image = decodeImageObject(view, cursor, end - cursor)
  }

  return brush
}

function decodeUnknownBrush(view, brushType, dataOffset) {
  return {
    kind: 'brush',
    type: 'unknown',
    brushType,
    color: decodeArgb(view.getUint32(dataOffset, true))
  }
}

export function decodeBrushObject(view, offset, dataSize) {
  if (dataSize < 8) {
    return decodeSolidBrush(view, offset + 4)
  }

  const brushType = view.getUint32(offset + 4, true)
  const brushDataOffset = offset + 8
  const brushDataSize = Math.max(0, dataSize - 8)

  if (brushType === BRUSH_TYPE_SOLID) {
    return decodeSolidBrush(view, brushDataOffset)
  }

  if (brushType === BRUSH_TYPE_HATCH && brushDataSize >= 12) {
    return decodeHatchBrush(view, brushDataOffset)
  }

  if (brushType === BRUSH_TYPE_LINEAR_GRADIENT && brushDataSize >= 32) {
    return decodeLinearGradientBrush(view, brushDataOffset, brushDataSize)
  }

  if (brushType === BRUSH_TYPE_PATH_GRADIENT && brushDataSize >= 28) {
    return decodePathGradientBrush(view, brushDataOffset, brushDataSize)
  }

  if (brushType === BRUSH_TYPE_TEXTURE && brushDataSize >= 16) {
    return decodeTextureBrush(view, brushDataOffset, brushDataSize)
  }

  return decodeUnknownBrush(view, brushType, brushDataOffset)
}
