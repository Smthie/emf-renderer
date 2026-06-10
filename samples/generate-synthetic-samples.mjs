import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const EMR_HEADER = 0x00000001
const EMR_POLYGON = 0x00000003
const EMR_POLYBEZIERTO = 0x00000005
const EMR_POLYPOLYLINE16 = 0x0000005a
const EMR_POLYPOLYGON16 = 0x0000005b
const EMR_SETWINDOWEXTEX = 0x00000009
const EMR_SETWINDOWORGEX = 0x0000000a
const EMR_SETVIEWPORTEXTEX = 0x0000000b
const EMR_SETVIEWPORTORGEX = 0x0000000c
const EMR_EOF = 0x0000000e
const EMR_SETPIXELV = 0x0000000f
const EMR_SETMAPMODE = 0x00000011
const EMR_SETBKMODE = 0x00000012
const EMR_SETPOLYFILLMODE = 0x00000013
const EMR_SETSTRETCHBLTMODE = 0x00000015
const EMR_SETTEXTALIGN = 0x00000016
const EMR_SETTEXTCOLOR = 0x00000018
const EMR_SETBKCOLOR = 0x00000019
const EMR_SETMETARGN = 0x0000001c
const EMR_EXCLUDECLIPRECT = 0x0000001d
const EMR_INTERSECTCLIPRECT = 0x0000001e
const EMR_MOVETOEX = 0x0000001b
const EMR_SAVEDC = 0x00000021
const EMR_RESTOREDC = 0x00000022
const EMR_SETWORLDTRANSFORM = 0x00000023
const EMR_SELECTOBJECT = 0x00000025
const EMR_CREATEPEN = 0x00000026
const EMR_CREATEBRUSHINDIRECT = 0x00000027
const EMR_DELETEOBJECT = 0x00000028
const EMR_ANGLEARC = 0x00000029
const EMR_ELLIPSE = 0x0000002a
const EMR_RECTANGLE = 0x0000002b
const EMR_ROUNDRECT = 0x0000002c
const EMR_ARC = 0x0000002d
const EMR_CHORD = 0x0000002e
const EMR_PIE = 0x0000002f
const EMR_LINETO = 0x00000036
const EMR_ARCTO = 0x00000037
const EMR_SETARCDIRECTION = 0x00000039
const EMR_SETMITERLIMIT = 0x0000003a
const EMR_BEGINPATH = 0x0000003b
const EMR_ENDPATH = 0x0000003c
const EMR_CLOSEFIGURE = 0x0000003d
const EMR_FILLPATH = 0x0000003e
const EMR_STROKEANDFILLPATH = 0x0000003f
const EMR_FLATTENPATH = 0x00000041
const EMR_WIDENPATH = 0x00000042
const EMR_EXTSELECTCLIPRGN = 0x0000004b
const EMR_COMMENT = 0x00000046
const EMR_STRETCHDIBITS = 0x00000051
const EMR_EXTCREATEFONTINDIRECTW = 0x00000052
const EMR_EXTTEXTOUTW = 0x00000054
const EMR_POLYGON16 = 0x00000056
const EMR_POLYLINE16 = 0x00000057

const PS_SOLID = 0
const PS_DASH = 1
const BS_SOLID = 0
const MM_TEXT = 1
const MM_ANISOTROPIC = 8
const TRANSPARENT = 1
const OPAQUE = 2
const WINDING = 2
const COLORONCOLOR = 3
const TA_CENTER = 0x0006
const TA_BASELINE = 0x0018
const ETO_OPAQUE = 0x0002
const SRCCOPY = 0x00cc0020
const DIB_RGB_COLORS = 0
const BI_RGB = 0
const CLIPRGN_COPY = 5
const EMR_COMMENT_EMFPLUS = 0x2b464d45
const EMFPLUS_HEADER = 0x4001
const EMFPLUS_END_OF_FILE = 0x4002
const EMFPLUS_GET_DC = 0x4004
const EMFPLUS_OBJECT = 0x4008
const EMFPLUS_CLEAR = 0x4009
const EMFPLUS_FILL_RECTS = 0x400a
const EMFPLUS_DRAW_RECTS = 0x400b
const EMFPLUS_FILL_POLYGON = 0x400c
const EMFPLUS_DRAW_LINES = 0x400d
const EMFPLUS_FILL_ELLIPSE = 0x400e
const EMFPLUS_DRAW_ELLIPSE = 0x400f
const EMFPLUS_FILL_PIE = 0x4010
const EMFPLUS_DRAW_PIE = 0x4011
const EMFPLUS_DRAW_ARC = 0x4012
const EMFPLUS_FILL_REGION = 0x4013
const EMFPLUS_FILL_PATH = 0x4014
const EMFPLUS_DRAW_PATH = 0x4015
const EMFPLUS_FILL_CLOSED_CURVE = 0x4016
const EMFPLUS_DRAW_CLOSED_CURVE = 0x4017
const EMFPLUS_DRAW_CURVE = 0x4018
const EMFPLUS_DRAW_BEZIERS = 0x4019
const EMFPLUS_DRAW_IMAGE = 0x401a
const EMFPLUS_DRAW_IMAGE_POINTS = 0x401b
const EMFPLUS_DRAW_STRING = 0x401c
const EMFPLUS_SET_RENDERING_ORIGIN = 0x401d
const EMFPLUS_SET_ANTI_ALIAS_MODE = 0x401e
const EMFPLUS_SET_TEXT_RENDERING_HINT = 0x401f
const EMFPLUS_SET_TEXT_CONTRAST = 0x4020
const EMFPLUS_SET_INTERPOLATION_MODE = 0x4021
const EMFPLUS_SET_PIXEL_OFFSET_MODE = 0x4022
const EMFPLUS_SET_COMPOSITING_MODE = 0x4023
const EMFPLUS_SET_COMPOSITING_QUALITY = 0x4024
const EMFPLUS_SAVE = 0x4025
const EMFPLUS_RESTORE = 0x4026
const EMFPLUS_SET_WORLD_TRANSFORM = 0x402a
const EMFPLUS_RESET_WORLD_TRANSFORM = 0x402b
const EMFPLUS_TRANSLATE_WORLD_TRANSFORM = 0x402d
const EMFPLUS_SCALE_WORLD_TRANSFORM = 0x402e
const EMFPLUS_ROTATE_WORLD_TRANSFORM = 0x402f
const EMFPLUS_RESET_CLIP = 0x4031
const EMFPLUS_SET_CLIP_RECT = 0x4032
const EMFPLUS_SET_CLIP_PATH = 0x4033
const EMFPLUS_SET_CLIP_REGION = 0x4034
const EMFPLUS_DRAW_DRIVER_STRING = 0x4036

const EMFPLUS_OBJECT_BRUSH = 1
const EMFPLUS_OBJECT_PEN = 2
const EMFPLUS_OBJECT_PATH = 3
const EMFPLUS_OBJECT_REGION = 4
const EMFPLUS_OBJECT_IMAGE = 5
const EMFPLUS_OBJECT_FONT = 6
const EMFPLUS_OBJECT_STRING_FORMAT = 7
const EMFPLUS_INLINE_COLOR = 0x8000
const EMFPLUS_COMPRESSED = 0x4000
const EMFPLUS_MATRIX_POSTMULTIPLY = 0x2000
const EMFPLUS_BRUSH_SOLID = 0
const EMFPLUS_BRUSH_HATCH = 1
const EMFPLUS_BRUSH_PATH_GRADIENT = 3
const EMFPLUS_BRUSH_LINEAR_GRADIENT = 4
const EMFPLUS_REGION_NODE_RECT = 0x10000000
const EMFPLUS_REGION_NODE_INFINITE = 0x10000003
const EMFPLUS_BITMAP_DATA_TYPE_PIXEL = 0
const EMFPLUS_IMAGE_TYPE_BITMAP = 1
const EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED = 0x00030803
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB555 = 0x00021005
const EMFPLUS_PIXEL_FORMAT_16BPP_RGB565 = 0x00021006
const EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555 = 0x00061007
const EMFPLUS_PIXEL_FORMAT_32BPP_ARGB = 0x0026200a
const EMFPLUS_UNIT_PIXEL = 2
const EMFPLUS_PATH_POINT_START = 0
const EMFPLUS_PATH_POINT_LINE = 1
const EMFPLUS_PATH_POINT_BEZIER = 3
const EMFPLUS_PATH_POINT_CLOSE = 0x80
const EMFPLUS_DRIVER_STRING_CMAP_LOOKUP = 0x00000001

const outputDir = path.dirname(fileURLToPath(import.meta.url))

function align4(value) {
  return (value + 3) & ~3
}

function colorRef(red, green, blue) {
  return (red & 0xff) | ((green & 0xff) << 8) | ((blue & 0xff) << 16)
}

function argb(alpha, red, green, blue) {
  return ((alpha & 0xff) << 24) | ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff)
}

class Writer {
  constructor(size) {
    this.buffer = Buffer.alloc(size)
    this.offset = 0
  }

  u8(value) {
    this.buffer.writeUInt8(value & 0xff, this.offset)
    this.offset += 1
  }

  u16(value) {
    this.buffer.writeUInt16LE(value & 0xffff, this.offset)
    this.offset += 2
  }

  i16(value) {
    this.buffer.writeInt16LE(value, this.offset)
    this.offset += 2
  }

  u32(value) {
    this.buffer.writeUInt32LE(value >>> 0, this.offset)
    this.offset += 4
  }

  i32(value) {
    this.buffer.writeInt32LE(value, this.offset)
    this.offset += 4
  }

  f32(value) {
    this.buffer.writeFloatLE(value, this.offset)
    this.offset += 4
  }

  rect(rect) {
    this.i32(rect.left)
    this.i32(rect.top)
    this.i32(rect.right)
    this.i32(rect.bottom)
  }

  pointL(point) {
    this.i32(point.x)
    this.i32(point.y)
  }

  pointS(point) {
    this.i16(point.x)
    this.i16(point.y)
  }

  rectF(rect) {
    this.f32(rect.x)
    this.f32(rect.y)
    this.f32(rect.width)
    this.f32(rect.height)
  }

  pointF(point) {
    this.f32(point.x)
    this.f32(point.y)
  }

  matrix(matrix) {
    for (const value of matrix) {
      this.f32(value)
    }
  }

  bytes(bytes) {
    Buffer.from(bytes).copy(this.buffer, this.offset)
    this.offset += bytes.length
  }
}

function data(size, write) {
  const writer = new Writer(size)
  write?.(writer)
  return writer.buffer
}

function record(type, payload = Buffer.alloc(0)) {
  const size = 8 + align4(payload.length)
  const buffer = Buffer.alloc(size)
  buffer.writeUInt32LE(type >>> 0, 0)
  buffer.writeUInt32LE(size, 4)
  payload.copy(buffer, 8)
  return buffer
}

function boundsOf(points) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  }
}

function createHeader(width, height, bytes, nRecords) {
  return record(
    EMR_HEADER,
    data(80, (writer) => {
      writer.rect({ left: 0, top: 0, right: width, bottom: height })
      writer.rect({ left: 0, top: 0, right: width * 100, bottom: height * 100 })
      writer.u32(0x464d4520)
      writer.u32(0x00010000)
      writer.u32(bytes)
      writer.u32(nRecords)
      writer.u16(64)
      writer.u16(0)
      writer.u32(0)
      writer.u32(0)
      writer.u32(0)
      writer.i32(width)
      writer.i32(height)
      writer.i32(320)
      writer.i32(240)
    })
  )
}

function createEmf(width, height, records) {
  const eof = record(EMR_EOF)
  const bytes = 88 + records.reduce((sum, item) => sum + item.length, 0) + eof.length
  return Buffer.concat([createHeader(width, height, bytes, records.length + 2), ...records, eof])
}

function u32Record(type, value) {
  return record(type, data(4, (writer) => writer.u32(value)))
}

function i32Record(type, value) {
  return record(type, data(4, (writer) => writer.i32(value)))
}

function pointRecord(type, point) {
  return record(type, data(8, (writer) => writer.pointL(point)))
}

function rectRecord(type, rect) {
  return record(type, data(16, (writer) => writer.rect(rect)))
}

function createBrush(handle, red, green, blue) {
  return record(
    EMR_CREATEBRUSHINDIRECT,
    data(16, (writer) => {
      writer.u32(handle)
      writer.u32(BS_SOLID)
      writer.u32(colorRef(red, green, blue))
      writer.u32(0)
    })
  )
}

function createPen(handle, red, green, blue, width = 1, style = PS_SOLID) {
  return record(
    EMR_CREATEPEN,
    data(20, (writer) => {
      writer.u32(handle)
      writer.u32(style)
      writer.u32(width)
      writer.u32(0)
      writer.u32(colorRef(red, green, blue))
    })
  )
}

function selectObject(handle) {
  return u32Record(EMR_SELECTOBJECT, handle)
}

function deleteObject(handle) {
  return u32Record(EMR_DELETEOBJECT, handle)
}

function polygonRecord(type, points, small = false) {
  const payloadSize = 20 + points.length * (small ? 4 : 8)
  return record(
    type,
    data(payloadSize, (writer) => {
      writer.rect(boundsOf(points))
      writer.u32(points.length)
      for (const point of points) {
        if (small) {
          writer.pointS(point)
        } else {
          writer.pointL(point)
        }
      }
    })
  )
}

function polyPolyRecord(type, figures, small = false) {
  const points = figures.flat()
  const counts = figures.map((figure) => figure.length)
  const payloadSize = 24 + counts.length * 4 + points.length * (small ? 4 : 8)
  return record(
    type,
    data(payloadSize, (writer) => {
      writer.rect(boundsOf(points))
      writer.u32(figures.length)
      writer.u32(points.length)
      for (const count of counts) {
        writer.u32(count)
      }
      for (const point of points) {
        if (small) {
          writer.pointS(point)
        } else {
          writer.pointL(point)
        }
      }
    })
  )
}

function roundRect(rect, cornerWidth, cornerHeight) {
  return record(
    EMR_ROUNDRECT,
    data(24, (writer) => {
      writer.rect(rect)
      writer.i32(cornerWidth)
      writer.i32(cornerHeight)
    })
  )
}

function pathPaintRecord(type, rect) {
  return record(type, data(16, (writer) => writer.rect(rect)))
}

function arcRecord(type, box, start, end) {
  return record(
    type,
    data(32, (writer) => {
      writer.rect(box)
      writer.pointL(start)
      writer.pointL(end)
    })
  )
}

function angleArc(center, radius, startAngle, sweepAngle) {
  return record(
    EMR_ANGLEARC,
    data(20, (writer) => {
      writer.pointL(center)
      writer.u32(radius)
      writer.f32(startAngle)
      writer.f32(sweepAngle)
    })
  )
}

function matrixRecord(type, matrix) {
  return record(
    type,
    data(24, (writer) => {
      for (const value of matrix) {
        writer.f32(value)
      }
    })
  )
}

function restoreDc() {
  return i32Record(EMR_RESTOREDC, -1)
}

function resetClip() {
  return record(
    EMR_EXTSELECTCLIPRGN,
    data(8, (writer) => {
      writer.u32(0)
      writer.u32(CLIPRGN_COPY)
    })
  )
}

function utf16Le(text) {
  return Buffer.from(text, 'utf16le')
}

function writeFaceName(buffer, offset, faceName) {
  const source = utf16Le(faceName)
  source.copy(buffer, offset, 0, Math.min(source.length, 31 * 2))
}

function createFont(handle, faceName, height, options = {}) {
  const payload = Buffer.alloc(96)
  payload.writeUInt32LE(handle, 0)
  const offset = 4
  payload.writeInt32LE(height, offset + 0)
  payload.writeInt32LE(0, offset + 4)
  payload.writeInt32LE(options.escapement ?? 0, offset + 8)
  payload.writeInt32LE(options.orientation ?? 0, offset + 12)
  payload.writeInt32LE(options.weight ?? 400, offset + 16)
  payload.writeUInt8(options.italic ? 1 : 0, offset + 20)
  payload.writeUInt8(options.underline ? 1 : 0, offset + 21)
  payload.writeUInt8(options.strikeOut ? 1 : 0, offset + 22)
  payload.writeUInt8(1, offset + 23)
  payload.writeUInt8(0, offset + 24)
  payload.writeUInt8(0, offset + 25)
  payload.writeUInt8(0, offset + 26)
  payload.writeUInt8(0, offset + 27)
  writeFaceName(payload, offset + 28, faceName)
  return record(EMR_EXTCREATEFONTINDIRECTW, payload)
}

function extTextOutW(text, referencePoint, options = {}) {
  const chars = Array.from(text)
  const textBytes = utf16Le(chars.join(''))
  const stringSize = align4(textBytes.length)
  const dxValues = options.dx ?? chars.map(() => options.advance ?? Math.max(8, Math.round((options.fontSize ?? 18) * 0.55)))
  const dxBytes = Buffer.alloc(dxValues.length * 4)
  dxValues.forEach((value, index) => dxBytes.writeInt32LE(value, index * 4))

  const headerSize = 68
  const stringOffset = 8 + headerSize
  const dxOffset = stringOffset + stringSize
  const payload = Buffer.alloc(headerSize + stringSize + dxBytes.length)
  const writer = new Writer(headerSize)
  writer.rect(options.bounds ?? { left: referencePoint.x, top: referencePoint.y - 32, right: referencePoint.x + 240, bottom: referencePoint.y + 12 })
  writer.u32(1)
  writer.f32(1)
  writer.f32(1)
  writer.pointL(referencePoint)
  writer.u32(chars.length)
  writer.u32(stringOffset)
  writer.u32(options.flags ?? 0)
  writer.rect(options.opaqueRect ?? { left: referencePoint.x, top: referencePoint.y - 32, right: referencePoint.x + 240, bottom: referencePoint.y + 12 })
  writer.u32(dxOffset)
  writer.buffer.copy(payload, 0)
  textBytes.copy(payload, headerSize)
  dxBytes.copy(payload, headerSize + stringSize)
  return record(EMR_EXTTEXTOUTW, payload)
}

function stretchDibits(rect, width, height) {
  const rowStride = Math.floor((width * 24 + 31) / 32) * 4
  const bits = Buffer.alloc(rowStride * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowStride + x * 3
      const checker = (Math.floor(x / 2) + Math.floor(y / 2)) % 2
      const red = Math.round((x / Math.max(1, width - 1)) * 220) + (checker ? 20 : 0)
      const green = Math.round((y / Math.max(1, height - 1)) * 210) + (checker ? 20 : 0)
      const blue = checker ? 190 : 65
      bits[offset] = blue
      bits[offset + 1] = green
      bits[offset + 2] = red
    }
  }

  const bmi = data(40, (writer) => {
    writer.u32(40)
    writer.i32(width)
    writer.i32(-height)
    writer.u16(1)
    writer.u16(24)
    writer.u32(BI_RGB)
    writer.u32(bits.length)
    writer.i32(2835)
    writer.i32(2835)
    writer.u32(0)
    writer.u32(0)
  })

  const headerSize = 72
  const bmiOffset = 8 + headerSize
  const bitsOffset = bmiOffset + bmi.length
  const payload = Buffer.concat([
    data(headerSize, (writer) => {
      writer.rect(rect)
      writer.i32(rect.left)
      writer.i32(rect.top)
      writer.i32(0)
      writer.i32(0)
      writer.i32(width)
      writer.i32(height)
      writer.u32(bmiOffset)
      writer.u32(bmi.length)
      writer.u32(bitsOffset)
      writer.u32(bits.length)
      writer.u32(DIB_RGB_COLORS)
      writer.u32(SRCCOPY)
      writer.i32(rect.right - rect.left)
      writer.i32(rect.bottom - rect.top)
    }),
    bmi,
    bits
  ])

  return record(EMR_STRETCHDIBITS, payload)
}

function rotateAround(cx, cy, degrees) {
  const radians = (degrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [
    cosine,
    sine,
    -sine,
    cosine,
    cx - cosine * cx + sine * cy,
    cy - sine * cx - cosine * cy
  ]
}

function baseStateRecords() {
  return [
    u32Record(EMR_SETMAPMODE, MM_TEXT),
    u32Record(EMR_SETBKMODE, TRANSPARENT),
    u32Record(EMR_SETSTRETCHBLTMODE, COLORONCOLOR),
    u32Record(EMR_SETPOLYFILLMODE, WINDING),
    u32Record(EMR_SETMITERLIMIT, 8),
    u32Record(EMR_SETARCDIRECTION, 1)
  ]
}

function emfPlusRecord(type, flags = 0, payload = Buffer.alloc(0)) {
  const size = align4(12 + payload.length)
  const buffer = Buffer.alloc(size)
  buffer.writeUInt16LE(type & 0xffff, 0)
  buffer.writeUInt16LE(flags & 0xffff, 2)
  buffer.writeUInt32LE(size, 4)
  buffer.writeUInt32LE(payload.length, 8)
  payload.copy(buffer, 12)
  return buffer
}

function emfPlusComment(records) {
  const payload = Buffer.concat(records)
  return record(
    EMR_COMMENT,
    Buffer.concat([
      data(8, (writer) => {
        writer.u32(4 + payload.length)
        writer.u32(EMR_COMMENT_EMFPLUS)
      }),
      payload
    ])
  )
}

function emfPlusHeader() {
  return emfPlusRecord(
    EMFPLUS_HEADER,
    1,
    data(16, (writer) => {
      // EmfPlusGraphicsVersion: MetafileSignature 0xDBC01 (bits 12-31) | version.
      // Writing a bare 1 dropped the 0xDBC01 signature, so real GDI+ rejected the
      // whole EMF+ stream as invalid and rendered these EMF+-only samples blank.
      writer.u32(0xdbc01002)
      writer.u32(0)
      writer.u32(96)
      writer.u32(96)
    })
  )
}

function createEmfPlus(width, height, records) {
  return createEmf(width, height, [
    emfPlusComment([
      emfPlusHeader(),
      ...records,
      emfPlusRecord(EMFPLUS_END_OF_FILE)
    ])
  ])
}

function emfPlusObject(objectId, objectType, payload) {
  return emfPlusRecord(EMFPLUS_OBJECT, objectId | (objectType << 8), payload)
}

function emfPlusSolidBrush(objectId, alpha, red, green, blue) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_BRUSH,
    data(12, (writer) => {
      writer.u32(0)
      writer.u32(EMFPLUS_BRUSH_SOLID)
      writer.u32(argb(alpha, red, green, blue))
    })
  )
}

function emfPlusHatchBrush(objectId, fore, back, hatchStyle = 6) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_BRUSH,
    data(20, (writer) => {
      writer.u32(0)
      writer.u32(EMFPLUS_BRUSH_HATCH)
      writer.u32(hatchStyle)
      writer.u32(fore)
      writer.u32(back)
    })
  )
}

function emfPlusLinearGradientBrush(objectId, rect, startColor, endColor) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_BRUSH,
    data(40, (writer) => {
      writer.u32(0)
      writer.u32(EMFPLUS_BRUSH_LINEAR_GRADIENT)
      writer.u32(0)
      writer.u32(0)
      writer.rectF(rect)
      writer.u32(startColor)
      writer.u32(endColor)
    })
  )
}

function emfPlusPathGradientBrush(objectId, centerColor, centerPoint, boundaryPoints) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_BRUSH,
    data(40 + boundaryPoints.length * 8, (writer) => {
      writer.u32(0)
      writer.u32(EMFPLUS_BRUSH_PATH_GRADIENT)
      writer.u32(0)
      writer.u32(0)
      writer.u32(centerColor)
      writer.pointF(centerPoint)
      writer.u32(1)
      writer.u32(argb(255, 245, 248, 255))
      writer.u32(boundaryPoints.length)
      for (const point of boundaryPoints) {
        writer.pointF(point)
      }
    })
  )
}

function emfPlusPen(objectId, color, width = 2, options = {}) {
  const penFlags =
    0x00000008 |
    0x00000010 |
    (options.dashStyle !== undefined ? 0x00000020 : 0) |
    (Array.isArray(options.dashPattern) ? 0x00000100 : 0)
  const dashPattern = options.dashPattern ?? []
  const payloadSize = 20 + 4 + 4 + (options.dashStyle !== undefined ? 4 : 0) + (dashPattern.length > 0 ? 4 + dashPattern.length * 4 : 0) + 12
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_PEN,
    data(payloadSize, (writer) => {
      writer.u32(0)
      writer.u32(0)
      writer.u32(penFlags)
      writer.u32(EMFPLUS_UNIT_PIXEL)
      writer.f32(width)
      writer.u32(options.lineJoin ?? 2)
      writer.f32(options.miterLimit ?? 6)
      if (options.dashStyle !== undefined) {
        writer.u32(options.dashStyle)
      }
      if (dashPattern.length > 0) {
        writer.u32(dashPattern.length)
        for (const value of dashPattern) {
          writer.f32(value)
        }
      }
      writer.u32(0)
      writer.u32(EMFPLUS_BRUSH_SOLID)
      writer.u32(color)
    })
  )
}

function emfPlusPathObject(objectId, points, pointTypes, options = {}) {
  const compressed = options.compressed ?? false
  const pointBytes = compressed ? points.length * 4 : points.length * 8
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_PATH,
    data(12 + pointBytes + pointTypes.length, (writer) => {
      writer.u32(0)
      writer.u32(points.length)
      writer.u32(compressed ? EMFPLUS_COMPRESSED : 0)
      for (const point of points) {
        if (compressed) {
          writer.pointS(point)
        } else {
          writer.pointF(point)
        }
      }
      for (const pointType of pointTypes) {
        writer.u8(pointType)
      }
    })
  )
}

function emfPlusRegionRectObject(objectId, rect) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_REGION,
    data(28, (writer) => {
      writer.u32(0)
      writer.u32(0)
      writer.u32(EMFPLUS_REGION_NODE_RECT)
      writer.rectF(rect)
    })
  )
}

function emfPlusRegionInfiniteObject(objectId) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_REGION,
    data(12, (writer) => {
      writer.u32(0)
      writer.u32(0)
      writer.u32(EMFPLUS_REGION_NODE_INFINITE)
    })
  )
}

function emfPlusFontObject(objectId, familyName, emSize, options = {}) {
  const name = utf16Le(familyName)
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_FONT,
    Buffer.concat([
      data(24, (writer) => {
        writer.u32(0)
        writer.f32(emSize)
        writer.u32(options.unit ?? EMFPLUS_UNIT_PIXEL)
        writer.u32(options.styleFlags ?? 0)
        writer.u32(0)
        writer.u32(familyName.length)
      }),
      name
    ])
  )
}

function emfPlusStringFormatObject(objectId, options = {}) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_STRING_FORMAT,
    data(52, (writer) => {
      writer.u32(0)
      writer.u32(options.formatFlags ?? 0)
      writer.u32(0)
      writer.u32(options.alignment ?? 0)
      writer.u32(options.lineAlign ?? 0)
      writer.u32(0)
      writer.u32(0)
      writer.f32(0)
      writer.i32(0)
      writer.f32(0)
      writer.f32(0)
      writer.f32(1)
      writer.u32(options.trimming ?? 0)
    })
  )
}

function emfPlusRawBitmapObject(objectId, width, height) {
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + x * 4
      const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2
      pixels[offset] = checker ? 112 : 48
      pixels[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 220)
      pixels[offset + 2] = Math.round((x / Math.max(1, width - 1)) * 230)
      pixels[offset + 3] = checker ? 220 : 255
    }
  }

  return emfPlusRawBitmapObjectFromPayload(
    objectId,
    width,
    height,
    stride,
    EMFPLUS_PIXEL_FORMAT_32BPP_ARGB,
    pixels
  )
}

function emfPlusRawBitmapObjectFromPayload(objectId, width, height, stride, pixelFormat, payload) {
  return emfPlusObject(
    objectId,
    EMFPLUS_OBJECT_IMAGE,
    Buffer.concat([
      data(28, (writer) => {
        writer.u32(0)
        writer.u32(EMFPLUS_IMAGE_TYPE_BITMAP)
        writer.u32(width)
        writer.u32(height)
        writer.i32(stride)
        writer.u32(pixelFormat)
        writer.u32(EMFPLUS_BITMAP_DATA_TYPE_PIXEL)
      }),
      payload
    ])
  )
}

function emfPlusIndexedBitmapObject(objectId, width, height) {
  const stride = align4(width)
  const pixels = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + x

      if ((x + y) % 9 === 0) {
        pixels[offset] = 3
      } else if ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) {
        pixels[offset] = 1
      } else {
        pixels[offset] = y > height / 2 ? 2 : 0
      }
    }
  }

  const palette = data(24, (writer) => {
    writer.u32(0)
    writer.u32(4)
    writer.u32(argb(255, 28, 65, 104))
    writer.u32(argb(255, 246, 176, 72))
    writer.u32(argb(150, 52, 163, 136))
    writer.u32(argb(255, 202, 72, 82))
  })

  return emfPlusRawBitmapObjectFromPayload(
    objectId,
    width,
    height,
    stride,
    EMFPLUS_PIXEL_FORMAT_8BPP_INDEXED,
    Buffer.concat([palette, pixels])
  )
}

function packRgb555(red, green, blue) {
  return (
    (Math.round((red / 255) * 0x1f) << 10) |
    (Math.round((green / 255) * 0x1f) << 5) |
    Math.round((blue / 255) * 0x1f)
  )
}

function packRgb565(red, green, blue) {
  return (
    (Math.round((red / 255) * 0x1f) << 11) |
    (Math.round((green / 255) * 0x3f) << 5) |
    Math.round((blue / 255) * 0x1f)
  )
}

function packArgb1555(alpha, red, green, blue) {
  return (alpha >= 128 ? 0x8000 : 0) | packRgb555(red, green, blue)
}

function emfPlus16BppBitmapObject(objectId, width, height, pixelFormat) {
  const stride = align4(width * 2)
  const pixels = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = Math.round((x / Math.max(1, width - 1)) * 240)
      const green = Math.round((y / Math.max(1, height - 1)) * 220)
      const blue = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0 ? 210 : 54
      const alpha = pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555 && (x + y) % 5 === 0 ? 0 : 255
      const value =
        pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_RGB565
          ? packRgb565(red, green, blue)
          : pixelFormat === EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555
            ? packArgb1555(alpha, red, green, blue)
            : packRgb555(red, green, blue)

      pixels.writeUInt16LE(value, y * stride + x * 2)
    }
  }

  return emfPlusRawBitmapObjectFromPayload(objectId, width, height, stride, pixelFormat, pixels)
}

function emfPlusRectS(rect) {
  return data(8, (writer) => {
    writer.i16(rect.x)
    writer.i16(rect.y)
    writer.i16(rect.width)
    writer.i16(rect.height)
  })
}

function emfPlusPointS(point) {
  return data(4, (writer) => writer.pointS(point))
}

function emfPlusPointF(point) {
  return data(8, (writer) => writer.pointF(point))
}

function emfPlusRectF(rect) {
  return data(16, (writer) => writer.rectF(rect))
}

function combineModeFlags(objectId, mode) {
  return objectId | ((mode & 0x0f) << 8)
}

function emfPlusClear(color) {
  return emfPlusRecord(EMFPLUS_CLEAR, 0, data(4, (writer) => writer.u32(color)))
}

function emfPlusFillRectsInline(color, rects) {
  return emfPlusRecord(
    EMFPLUS_FILL_RECTS,
    EMFPLUS_INLINE_COLOR | EMFPLUS_COMPRESSED,
    Buffer.concat([
      data(8, (writer) => {
        writer.u32(color)
        writer.u32(rects.length)
      }),
      ...rects.map(emfPlusRectS)
    ])
  )
}

function emfPlusDrawRects(penId, rects) {
  return emfPlusRecord(
    EMFPLUS_DRAW_RECTS,
    penId | EMFPLUS_COMPRESSED,
    Buffer.concat([
      data(4, (writer) => writer.u32(rects.length)),
      ...rects.map(emfPlusRectS)
    ])
  )
}

function emfPlusDrawLines(penId, points, compressed = false) {
  return emfPlusRecord(
    EMFPLUS_DRAW_LINES,
    penId | (compressed ? EMFPLUS_COMPRESSED : 0),
    Buffer.concat([
      data(4, (writer) => writer.u32(points.length)),
      ...points.map(compressed ? emfPlusPointS : emfPlusPointF)
    ])
  )
}

function emfPlusFillPolygon(brushId, points, compressed = false) {
  return emfPlusRecord(
    EMFPLUS_FILL_POLYGON,
    compressed ? EMFPLUS_COMPRESSED : 0,
    Buffer.concat([
      data(8, (writer) => {
        writer.u32(brushId)
        writer.u32(points.length)
      }),
      ...points.map(compressed ? emfPlusPointS : emfPlusPointF)
    ])
  )
}

function emfPlusFillEllipse(brushId, rect, compressed = true) {
  return emfPlusRecord(
    EMFPLUS_FILL_ELLIPSE,
    compressed ? EMFPLUS_COMPRESSED : 0,
    Buffer.concat([
      data(4, (writer) => writer.u32(brushId)),
      compressed ? emfPlusRectS(rect) : emfPlusRectF(rect)
    ])
  )
}

function emfPlusFillPie(brushId, startAngle, sweepAngle, rect, compressed = true) {
  return emfPlusRecord(
    EMFPLUS_FILL_PIE,
    compressed ? EMFPLUS_COMPRESSED : 0,
    Buffer.concat([
      data(12, (writer) => {
        writer.u32(brushId)
        writer.f32(startAngle)
        writer.f32(sweepAngle)
      }),
      compressed ? emfPlusRectS(rect) : emfPlusRectF(rect)
    ])
  )
}

function emfPlusDrawBeziers(penId, points) {
  return emfPlusRecord(
    EMFPLUS_DRAW_BEZIERS,
    penId,
    Buffer.concat([
      data(4, (writer) => writer.u32(points.length)),
      ...points.map(emfPlusPointF)
    ])
  )
}

function emfPlusShapeRecord(type, objectId, rect, compressed = true) {
  return emfPlusRecord(type, objectId | (compressed ? EMFPLUS_COMPRESSED : 0), compressed ? emfPlusRectS(rect) : emfPlusRectF(rect))
}

function emfPlusAngleShapeRecord(type, objectId, startAngle, sweepAngle, rect, compressed = true) {
  return emfPlusRecord(
    type,
    objectId | (compressed ? EMFPLUS_COMPRESSED : 0),
    Buffer.concat([
      data(8, (writer) => {
        writer.f32(startAngle)
        writer.f32(sweepAngle)
      }),
      compressed ? emfPlusRectS(rect) : emfPlusRectF(rect)
    ])
  )
}

function emfPlusSetClipRect(rect, mode = 2) {
  return emfPlusRecord(EMFPLUS_SET_CLIP_RECT, combineModeFlags(0, mode), emfPlusRectF(rect))
}

function emfPlusSetClipObject(type, objectId, mode = 2) {
  return emfPlusRecord(type, combineModeFlags(objectId, mode))
}

function emfPlusResetClip() {
  return emfPlusRecord(EMFPLUS_RESET_CLIP)
}

function emfPlusFillPath(pathId, brushId) {
  return emfPlusRecord(EMFPLUS_FILL_PATH, pathId, data(4, (writer) => writer.u32(brushId)))
}

function emfPlusDrawPath(pathId, penId) {
  return emfPlusRecord(EMFPLUS_DRAW_PATH, pathId, data(4, (writer) => writer.u32(penId)))
}

function emfPlusFillRegion(regionId, brushId) {
  return emfPlusRecord(EMFPLUS_FILL_REGION, regionId, data(4, (writer) => writer.u32(brushId)))
}

function emfPlusDrawString(fontId, brushId, formatId, text, rect) {
  const textBytes = utf16Le(text)
  return emfPlusRecord(
    EMFPLUS_DRAW_STRING,
    fontId,
    Buffer.concat([
      data(28, (writer) => {
        writer.u32(brushId)
        writer.u32(formatId)
        writer.u32(text.length)
        writer.rectF(rect)
      }),
      textBytes
    ])
  )
}

function emfPlusDrawDriverString(fontId, brushId, text, origin) {
  const glyphs = utf16Le(text)
  const positions = Buffer.concat(Array.from(text).map((_, index) => emfPlusPointF({ x: origin.x + index * 18, y: origin.y })))
  return emfPlusRecord(
    EMFPLUS_DRAW_DRIVER_STRING,
    fontId,
    Buffer.concat([
      data(16, (writer) => {
        writer.u32(brushId)
        writer.u32(EMFPLUS_DRIVER_STRING_CMAP_LOOKUP)
        writer.u32(0)
        writer.u32(text.length)
      }),
      glyphs,
      positions
    ])
  )
}

function emfPlusDrawImage(imageId, destinationRect, sourceRect) {
  return emfPlusRecord(
    EMFPLUS_DRAW_IMAGE,
    imageId,
    Buffer.concat([
      data(24, (writer) => {
        writer.u32(0)
        writer.i32(EMFPLUS_UNIT_PIXEL)
        writer.rectF(sourceRect)
      }),
      emfPlusRectF(destinationRect)
    ])
  )
}

function emfPlusDrawImagePoints(imageId, points, sourceRect) {
  return emfPlusRecord(
    EMFPLUS_DRAW_IMAGE_POINTS,
    imageId,
    Buffer.concat([
      data(28, (writer) => {
        writer.u32(0)
        writer.i32(EMFPLUS_UNIT_PIXEL)
        writer.rectF(sourceRect)
        writer.u32(points.length)
      }),
      ...points.map(emfPlusPointF)
    ])
  )
}

function emfPlusFillClosedCurve(brushId, points, tension = 0.45) {
  return emfPlusRecord(
    EMFPLUS_FILL_CLOSED_CURVE,
    0,
    Buffer.concat([
      data(12, (writer) => {
        writer.u32(brushId)
        writer.f32(tension)
        writer.u32(points.length)
      }),
      ...points.map(emfPlusPointF)
    ])
  )
}

function emfPlusDrawClosedCurve(penId, points, tension = 0.5) {
  return emfPlusRecord(
    EMFPLUS_DRAW_CLOSED_CURVE,
    penId,
    Buffer.concat([
      data(8, (writer) => {
        writer.f32(tension)
        writer.u32(points.length)
      }),
      ...points.map(emfPlusPointF)
    ])
  )
}

function emfPlusDrawCurve(penId, points, offset = 0, segments = points.length - 1, tension = 0.55) {
  return emfPlusRecord(
    EMFPLUS_DRAW_CURVE,
    penId,
    Buffer.concat([
      data(16, (writer) => {
        writer.f32(tension)
        writer.u32(offset)
        writer.u32(segments)
        writer.u32(points.length)
      }),
      ...points.map(emfPlusPointF)
    ])
  )
}

const samples = new Map()

samples.set(
  'synthetic-classic-shapes.emf',
  createEmf(360, 240, [
    ...baseStateRecords(),
    createBrush(1, 236, 248, 244),
    createBrush(2, 91, 141, 239),
    createBrush(3, 255, 183, 96),
    createBrush(4, 111, 207, 151),
    createPen(10, 26, 54, 93, 4),
    createPen(11, 94, 48, 35, 2),
    selectObject(1),
    selectObject(10),
    rectRecord(EMR_RECTANGLE, { left: 18, top: 18, right: 156, bottom: 98 }),
    selectObject(2),
    rectRecord(EMR_ELLIPSE, { left: 194, top: 20, right: 332, bottom: 108 }),
    selectObject(3),
    selectObject(11),
    roundRect({ left: 36, top: 132, right: 174, bottom: 218 }, 34, 34),
    selectObject(4),
    polygonRecord(EMR_POLYGON, [
      { x: 232, y: 132 },
      { x: 326, y: 158 },
      { x: 298, y: 218 },
      { x: 210, y: 206 }
    ]),
    ...[
      [30, 116, 214, 68, 68],
      [182, 116, 64, 128, 214],
      [338, 222, 214, 68, 68]
    ].map(([x, y, red, green, blue]) =>
      record(
        EMR_SETPIXELV,
        data(12, (writer) => {
          writer.pointL({ x, y })
          writer.u32(colorRef(red, green, blue))
        })
      )
    ),
    deleteObject(1),
    deleteObject(2),
    deleteObject(3),
    deleteObject(4),
    deleteObject(10),
    deleteObject(11)
  ])
)

samples.set(
  'synthetic-classic-path-bezier.emf',
  createEmf(360, 240, [
    ...baseStateRecords(),
    createBrush(1, 255, 241, 204),
    createPen(10, 91, 70, 160, 4),
    createPen(11, 212, 91, 54, 2, PS_DASH),
    selectObject(1),
    selectObject(10),
    record(EMR_BEGINPATH),
    pointRecord(EMR_MOVETOEX, { x: 44, y: 190 }),
    polygonRecord(EMR_POLYBEZIERTO, [
      { x: 86, y: 48 },
      { x: 170, y: 48 },
      { x: 210, y: 148 },
      { x: 250, y: 230 },
      { x: 310, y: 188 },
      { x: 314, y: 92 }
    ]),
    pointRecord(EMR_LINETO, { x: 270, y: 194 }),
    pointRecord(EMR_LINETO, { x: 106, y: 206 }),
    record(EMR_CLOSEFIGURE),
    record(EMR_ENDPATH),
    pathPaintRecord(EMR_STROKEANDFILLPATH, { left: 36, top: 42, right: 322, bottom: 224 }),
    selectObject(11),
    pointRecord(EMR_MOVETOEX, { x: 34, y: 42 }),
    polygonRecord(EMR_POLYBEZIERTO, [
      { x: 90, y: 84 },
      { x: 110, y: 8 },
      { x: 166, y: 48 },
      { x: 226, y: 88 },
      { x: 246, y: 18 },
      { x: 326, y: 62 }
    ]),
    deleteObject(1),
    deleteObject(10),
    deleteObject(11)
  ])
)

samples.set(
  'synthetic-classic-metargn-clip.emf',
  createEmf(360, 240, [
    ...baseStateRecords(),
    createBrush(1, 242, 245, 249),
    createBrush(2, 122, 184, 214),
    createBrush(3, 254, 205, 112),
    createPen(10, 40, 54, 72, 3),
    selectObject(1),
    selectObject(10),
    rectRecord(EMR_RECTANGLE, { left: 10, top: 10, right: 350, bottom: 230 }),
    rectRecord(EMR_INTERSECTCLIPRECT, { left: 62, top: 48, right: 298, bottom: 194 }),
    record(EMR_SETMETARGN),
    resetClip(),
    selectObject(2),
    rectRecord(EMR_ELLIPSE, { left: 20, top: 16, right: 340, bottom: 226 }),
    selectObject(3),
    roundRect({ left: 88, top: 74, right: 272, bottom: 168 }, 30, 30),
    deleteObject(1),
    deleteObject(2),
    deleteObject(3),
    deleteObject(10)
  ])
)

samples.set(
  'synthetic-classic-flatten-widen.emf',
  createEmf(380, 240, [
    ...baseStateRecords(),
    createBrush(1, 248, 230, 150),
    createBrush(2, 125, 190, 218),
    createPen(10, 54, 74, 94, 14),
    createPen(11, 180, 72, 72, 3),
    selectObject(1),
    selectObject(11),
    record(EMR_BEGINPATH),
    pointRecord(EMR_MOVETOEX, { x: 34, y: 150 }),
    polygonRecord(EMR_POLYBEZIERTO, [
      { x: 96, y: 36 },
      { x: 168, y: 38 },
      { x: 220, y: 146 }
    ]),
    pointRecord(EMR_LINETO, { x: 80, y: 190 }),
    record(EMR_CLOSEFIGURE),
    record(EMR_ENDPATH),
    record(EMR_FLATTENPATH),
    pathPaintRecord(EMR_FILLPATH, { left: 30, top: 32, right: 224, bottom: 194 }),
    selectObject(2),
    selectObject(10),
    record(EMR_BEGINPATH),
    pointRecord(EMR_MOVETOEX, { x: 250, y: 206 }),
    pointRecord(EMR_LINETO, { x: 310, y: 160 }),
    pointRecord(EMR_LINETO, { x: 330, y: 90 }),
    record(EMR_ENDPATH),
    record(EMR_WIDENPATH),
    pathPaintRecord(EMR_FILLPATH, { left: 240, top: 80, right: 338, bottom: 216 }),
    deleteObject(1),
    deleteObject(2),
    deleteObject(10),
    deleteObject(11)
  ])
)

samples.set(
  'synthetic-classic-polypoly.emf',
  createEmf(400, 260, [
    ...baseStateRecords(),
    createBrush(1, 232, 246, 255),
    createBrush(2, 248, 213, 126),
    createPen(10, 31, 86, 109, 3),
    createPen(11, 132, 68, 46, 2, PS_DASH),
    selectObject(1),
    selectObject(10),
    polyPolyRecord(
      EMR_POLYPOLYGON16,
      [
        [
          { x: 38, y: 46 },
          { x: 142, y: 34 },
          { x: 182, y: 96 },
          { x: 96, y: 132 }
        ],
        [
          { x: 216, y: 52 },
          { x: 334, y: 66 },
          { x: 310, y: 146 },
          { x: 226, y: 128 }
        ]
      ],
      true
    ),
    selectObject(2),
    polygonRecord(
      EMR_POLYGON16,
      [
        { x: 74, y: 180 },
        { x: 130, y: 150 },
        { x: 186, y: 180 },
        { x: 158, y: 226 },
        { x: 94, y: 226 }
      ],
      true
    ),
    selectObject(11),
    polyPolyRecord(
      EMR_POLYPOLYLINE16,
      [
        [
          { x: 220, y: 178 },
          { x: 250, y: 150 },
          { x: 282, y: 184 },
          { x: 316, y: 154 },
          { x: 354, y: 198 }
        ],
        [
          { x: 212, y: 222 },
          { x: 260, y: 204 },
          { x: 308, y: 226 },
          { x: 362, y: 210 }
        ]
      ],
      true
    ),
    polygonRecord(
      EMR_POLYLINE16,
      [
        { x: 28, y: 148 },
        { x: 72, y: 116 },
        { x: 132, y: 142 },
        { x: 188, y: 112 }
      ],
      true
    ),
    deleteObject(1),
    deleteObject(2),
    deleteObject(10),
    deleteObject(11)
  ])
)

samples.set(
  'synthetic-classic-transform-clip.emf',
  createEmf(360, 260, [
    ...baseStateRecords(),
    createBrush(1, 244, 246, 248),
    createBrush(2, 122, 184, 214),
    createBrush(3, 254, 205, 112),
    createBrush(4, 188, 230, 182),
    createPen(10, 40, 54, 72, 3),
    selectObject(1),
    selectObject(10),
    rectRecord(EMR_RECTANGLE, { left: 10, top: 10, right: 350, bottom: 250 }),
    record(EMR_SAVEDC),
    rectRecord(EMR_INTERSECTCLIPRECT, { left: 42, top: 42, right: 318, bottom: 212 }),
    rectRecord(EMR_EXCLUDECLIPRECT, { left: 138, top: 88, right: 226, bottom: 168 }),
    selectObject(2),
    rectRecord(EMR_ELLIPSE, { left: 12, top: 34, right: 348, bottom: 224 }),
    selectObject(3),
    rectRecord(EMR_RECTANGLE, { left: 76, top: 60, right: 284, bottom: 196 }),
    restoreDc(),
    resetClip(),
    record(EMR_SAVEDC),
    matrixRecord(EMR_SETWORLDTRANSFORM, rotateAround(180, 132, -18)),
    selectObject(4),
    roundRect({ left: 116, top: 94, right: 252, bottom: 168 }, 28, 28),
    restoreDc(),
    deleteObject(1),
    deleteObject(2),
    deleteObject(3),
    deleteObject(4),
    deleteObject(10)
  ])
)

samples.set(
  'synthetic-classic-text.emf',
  createEmf(420, 180, [
    ...baseStateRecords(),
    u32Record(EMR_SETBKMODE, OPAQUE),
    u32Record(EMR_SETBKCOLOR, colorRef(242, 245, 249)),
    u32Record(EMR_SETTEXTCOLOR, colorRef(32, 55, 86)),
    createBrush(1, 255, 255, 255),
    createPen(10, 83, 101, 128, 2),
    selectObject(1),
    selectObject(10),
    roundRect({ left: 12, top: 14, right: 408, bottom: 166 }, 22, 22),
    createFont(20, 'Arial', 31, { weight: 700 }),
    selectObject(20),
    extTextOutW('EMF classic text', { x: 28, y: 64 }, {
      flags: ETO_OPAQUE,
      fontSize: 31,
      advance: 17,
      bounds: { left: 24, top: 30, right: 398, bottom: 76 },
      opaqueRect: { left: 24, top: 30, right: 398, bottom: 76 }
    }),
    u32Record(EMR_SETTEXTALIGN, TA_CENTER | TA_BASELINE),
    u32Record(EMR_SETTEXTCOLOR, colorRef(39, 111, 158)),
    createFont(21, 'Arial', 24, { italic: true }),
    selectObject(21),
    extTextOutW('Unicode ABC 123', { x: 210, y: 124 }, {
      fontSize: 24,
      advance: 13,
      bounds: { left: 48, top: 96, right: 372, bottom: 142 },
      opaqueRect: { left: 48, top: 96, right: 372, bottom: 142 }
    }),
    deleteObject(1),
    deleteObject(10),
    deleteObject(20),
    deleteObject(21)
  ])
)

samples.set(
  'synthetic-classic-dib-24bit.emf',
  createEmf(260, 220, [
    ...baseStateRecords(),
    createBrush(1, 246, 247, 241),
    createPen(10, 47, 68, 77, 2),
    selectObject(1),
    selectObject(10),
    rectRecord(EMR_RECTANGLE, { left: 12, top: 12, right: 248, bottom: 208 }),
    stretchDibits({ left: 34, top: 32, right: 226, bottom: 176 }, 16, 12),
    roundRect({ left: 34, top: 32, right: 226, bottom: 176 }, 18, 18),
    deleteObject(1),
    deleteObject(10)
  ])
)

samples.set(
  'synthetic-classic-arcs-pies.emf',
  createEmf(360, 240, [
    ...baseStateRecords(),
    createBrush(1, 255, 226, 177),
    createBrush(2, 195, 223, 255),
    createPen(10, 43, 82, 128, 3),
    createPen(11, 184, 74, 61, 2),
    selectObject(1),
    selectObject(10),
    arcRecord(EMR_PIE, { left: 24, top: 28, right: 150, bottom: 154 }, { x: 150, y: 90 }, { x: 64, y: 150 }),
    selectObject(2),
    arcRecord(EMR_CHORD, { left: 198, top: 28, right: 334, bottom: 150 }, { x: 300, y: 28 }, { x: 214, y: 132 }),
    selectObject(11),
    arcRecord(EMR_ARC, { left: 28, top: 74, right: 170, bottom: 218 }, { x: 56, y: 198 }, { x: 162, y: 114 }),
    pointRecord(EMR_MOVETOEX, { x: 208, y: 196 }),
    angleArc({ x: 252, y: 174 }, 48, 210, 245),
    pointRecord(EMR_MOVETOEX, { x: 214, y: 184 }),
    arcRecord(EMR_ARCTO, { left: 196, top: 112, right: 332, bottom: 226 }, { x: 226, y: 214 }, { x: 328, y: 156 }),
    deleteObject(1),
    deleteObject(2),
    deleteObject(10),
    deleteObject(11)
  ])
)

samples.set(
  'synthetic-classic-mapping.emf',
  createEmf(360, 240, [
    // MM_ANISOTROPIC so the window/viewport extents actually drive the mapping:
    // a 180x120 window onto a 360x240 viewport is a deliberate 2x scale. GDI
    // ignores SetWindowExtEx / SetViewportExtEx under MM_TEXT, so that mode
    // would silently render the figures at 1x and defeat the sample's purpose.
    u32Record(EMR_SETMAPMODE, MM_ANISOTROPIC),
    pointRecord(EMR_SETWINDOWORGEX, { x: 0, y: 0 }),
    pointRecord(EMR_SETWINDOWEXTEX, { x: 180, y: 120 }),
    pointRecord(EMR_SETVIEWPORTORGEX, { x: 0, y: 0 }),
    pointRecord(EMR_SETVIEWPORTEXTEX, { x: 360, y: 240 }),
    u32Record(EMR_SETBKMODE, TRANSPARENT),
    u32Record(EMR_SETPOLYFILLMODE, WINDING),
    createBrush(1, 233, 241, 252),
    createBrush(2, 230, 190, 142),
    createPen(10, 37, 81, 120, 2),
    selectObject(1),
    selectObject(10),
    rectRecord(EMR_RECTANGLE, { left: 8, top: 8, right: 84, bottom: 52 }),
    selectObject(2),
    polygonRecord(EMR_POLYGON, [
      { x: 102, y: 16 },
      { x: 164, y: 26 },
      { x: 146, y: 74 },
      { x: 92, y: 64 }
    ]),
    selectObject(10),
    pointRecord(EMR_MOVETOEX, { x: 10, y: 88 }),
    polygonRecord(EMR_POLYBEZIERTO, [
      { x: 42, y: 58 },
      { x: 80, y: 118 },
      { x: 112, y: 88 },
      { x: 142, y: 62 },
      { x: 154, y: 112 },
      { x: 172, y: 86 }
    ]),
    deleteObject(1),
    deleteObject(2),
    deleteObject(10)
  ])
)

samples.set(
  'synthetic-emfplus-basic-shapes.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 255, 80, 138, 214),
    emfPlusSolidBrush(2, 210, 255, 184, 88),
    emfPlusPen(10, argb(255, 36, 63, 92), 4),
    emfPlusPen(11, argb(255, 178, 69, 53), 2, { dashStyle: 1, dashPattern: [7, 4] }),
    emfPlusFillRectsInline(argb(255, 239, 246, 250), [
      { x: 16, y: 18, width: 388, height: 224 },
      { x: 36, y: 38, width: 128, height: 78 }
    ]),
    emfPlusDrawRects(10, [
      { x: 16, y: 18, width: 388, height: 224 },
      { x: 36, y: 38, width: 128, height: 78 }
    ]),
    emfPlusFillEllipse(1, { x: 224, y: 36, width: 132, height: 86 }),
    emfPlusShapeRecord(EMFPLUS_DRAW_ELLIPSE, 10, { x: 224, y: 36, width: 132, height: 86 }),
    emfPlusFillPolygon(2, [
      { x: 80, y: 160 },
      { x: 150, y: 128 },
      { x: 212, y: 178 },
      { x: 168, y: 220 },
      { x: 92, y: 214 }
    ], true),
    emfPlusDrawLines(11, [
      { x: 238, y: 164 },
      { x: 276, y: 132 },
      { x: 314, y: 176 },
      { x: 356, y: 140 },
      { x: 388, y: 198 }
    ], true),
    emfPlusDrawBeziers(10, [
      { x: 34, y: 130 },
      { x: 86, y: 86 },
      { x: 128, y: 154 },
      { x: 178, y: 116 },
      { x: 230, y: 78 },
      { x: 256, y: 142 },
      { x: 306, y: 110 }
    ])
  ])
)

samples.set(
  'synthetic-emfplus-gradients.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusLinearGradientBrush(
      1,
      { x: 24, y: 28, width: 178, height: 190 },
      argb(255, 48, 128, 208),
      argb(255, 252, 204, 92)
    ),
    emfPlusPathGradientBrush(
      2,
      argb(255, 255, 245, 196),
      { x: 300, y: 128 },
      [
        { x: 230, y: 48 },
        { x: 374, y: 72 },
        { x: 362, y: 210 },
        { x: 222, y: 198 }
      ]
    ),
    emfPlusHatchBrush(3, argb(255, 52, 88, 120), argb(255, 226, 236, 242), 7),
    emfPlusPen(10, argb(255, 34, 54, 78), 3),
    emfPlusFillEllipse(1, { x: 32, y: 28, width: 170, height: 188 }),
    emfPlusFillPolygon(2, [
      { x: 230, y: 48 },
      { x: 374, y: 72 },
      { x: 362, y: 210 },
      { x: 222, y: 198 }
    ]),
    emfPlusFillRectsInline(argb(255, 255, 255, 255), [{ x: 96, y: 92, width: 62, height: 42 }]),
    emfPlusFillEllipse(3, { x: 120, y: 152, width: 88, height: 72 }),
    emfPlusDrawRects(10, [
      { x: 24, y: 24, width: 188, height: 204 },
      { x: 218, y: 38, width: 168, height: 184 }
    ])
  ])
)

samples.set(
  'synthetic-emfplus-path-clip-region.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 255, 95, 163, 121),
    emfPlusSolidBrush(2, 230, 252, 204, 112),
    emfPlusPen(10, argb(255, 42, 72, 98), 4),
    emfPlusPathObject(
      20,
      [
        { x: 58, y: 210 },
        { x: 88, y: 42 },
        { x: 186, y: 52 },
        { x: 218, y: 146 },
        { x: 254, y: 226 },
        { x: 340, y: 190 },
        { x: 358, y: 76 }
      ],
      [
        EMFPLUS_PATH_POINT_START,
        EMFPLUS_PATH_POINT_BEZIER,
        EMFPLUS_PATH_POINT_BEZIER,
        EMFPLUS_PATH_POINT_BEZIER,
        EMFPLUS_PATH_POINT_LINE,
        EMFPLUS_PATH_POINT_LINE,
        EMFPLUS_PATH_POINT_LINE | EMFPLUS_PATH_POINT_CLOSE
      ]
    ),
    emfPlusPathObject(
      21,
      [
        { x: 40, y: 44 },
        { x: 380, y: 44 },
        { x: 380, y: 216 },
        { x: 40, y: 216 }
      ],
      [
        EMFPLUS_PATH_POINT_START,
        EMFPLUS_PATH_POINT_LINE,
        EMFPLUS_PATH_POINT_LINE,
        EMFPLUS_PATH_POINT_LINE | EMFPLUS_PATH_POINT_CLOSE
      ],
      { compressed: true }
    ),
    emfPlusRegionRectObject(30, { x: 72, y: 64, width: 278, height: 132 }),
    emfPlusSetClipObject(EMFPLUS_SET_CLIP_REGION, 30, 2),
    emfPlusFillPath(20, 1),
    emfPlusSetClipObject(EMFPLUS_SET_CLIP_PATH, 21, 2),
    emfPlusFillRegion(30, 2),
    emfPlusResetClip(),
    emfPlusDrawPath(20, 10)
  ])
)

samples.set(
  'synthetic-emfplus-transform-state.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 255, 232, 246, 255),
    emfPlusSolidBrush(2, 220, 248, 174, 106),
    emfPlusPen(10, argb(255, 43, 61, 88), 3),
    emfPlusFillRectsInline(argb(255, 246, 248, 250), [{ x: 18, y: 18, width: 384, height: 224 }]),
    emfPlusRecord(EMFPLUS_SAVE, 0, data(4, (writer) => writer.u32(100))),
    emfPlusRecord(EMFPLUS_TRANSLATE_WORLD_TRANSFORM, EMFPLUS_MATRIX_POSTMULTIPLY, data(8, (writer) => {
      writer.f32(210)
      writer.f32(130)
    })),
    emfPlusRecord(EMFPLUS_ROTATE_WORLD_TRANSFORM, EMFPLUS_MATRIX_POSTMULTIPLY, data(4, (writer) => writer.f32(-20))),
    emfPlusRecord(EMFPLUS_SCALE_WORLD_TRANSFORM, EMFPLUS_MATRIX_POSTMULTIPLY, data(8, (writer) => {
      writer.f32(1.15)
      writer.f32(0.82)
    })),
    emfPlusFillEllipse(2, { x: -72, y: -48, width: 144, height: 96 }),
    emfPlusShapeRecord(EMFPLUS_DRAW_ELLIPSE, 10, { x: -72, y: -48, width: 144, height: 96 }),
    emfPlusRecord(EMFPLUS_RESTORE, 0, data(4, (writer) => writer.u32(100))),
    emfPlusDrawLines(10, [
      { x: 46, y: 202 },
      { x: 110, y: 78 },
      { x: 182, y: 172 },
      { x: 266, y: 70 },
      { x: 356, y: 190 }
    ]),
    emfPlusFillEllipse(1, { x: 58, y: 56, width: 92, height: 64 })
  ])
)

samples.set(
  'synthetic-emfplus-text.emf',
  createEmfPlus(460, 220, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 255, 32, 58, 92),
    emfPlusSolidBrush(2, 255, 50, 126, 158),
    emfPlusPen(10, argb(255, 110, 128, 150), 2),
    emfPlusFontObject(20, 'Arial', 30, { styleFlags: 1 }),
    emfPlusFontObject(21, 'Courier New', 22),
    emfPlusStringFormatObject(30, { alignment: 1, lineAlign: 1 }),
    emfPlusFillRectsInline(argb(255, 245, 247, 250), [{ x: 18, y: 18, width: 424, height: 184 }]),
    emfPlusDrawRects(10, [{ x: 18, y: 18, width: 424, height: 184 }]),
    emfPlusDrawString(20, 1, 30, 'EMF+ DrawString', { x: 30, y: 42, width: 400, height: 58 }),
    emfPlusDrawDriverString(21, 2, 'Driver ABC', { x: 64, y: 146 })
  ])
)

samples.set(
  'synthetic-emfplus-curves-arcs.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 220, 255, 214, 122),
    emfPlusSolidBrush(2, 190, 124, 190, 232),
    emfPlusPen(10, argb(255, 46, 72, 106), 3),
    emfPlusPen(11, argb(255, 190, 72, 52), 2, { dashStyle: 2, dashPattern: [3, 5] }),
    emfPlusFillPie(1, 22, 260, { x: 30, y: 30, width: 130, height: 126 }),
    emfPlusAngleShapeRecord(EMFPLUS_DRAW_PIE, 10, 22, 260, { x: 30, y: 30, width: 130, height: 126 }),
    emfPlusAngleShapeRecord(EMFPLUS_DRAW_ARC, 11, 210, -270, { x: 230, y: 34, width: 134, height: 104 }),
    emfPlusFillClosedCurve(2, [
      { x: 68, y: 202 },
      { x: 128, y: 152 },
      { x: 210, y: 196 },
      { x: 166, y: 232 }
    ]),
    emfPlusDrawClosedCurve(10, [
      { x: 242, y: 202 },
      { x: 282, y: 154 },
      { x: 360, y: 190 },
      { x: 338, y: 230 }
    ]),
    emfPlusDrawCurve(11, [
      { x: 44, y: 170 },
      { x: 116, y: 118 },
      { x: 204, y: 162 },
      { x: 286, y: 116 },
      { x: 372, y: 160 }
    ], 0, 4)
  ])
)

samples.set(
  'synthetic-emfplus-bitmap.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusRawBitmapObject(40, 32, 24),
    emfPlusPen(10, argb(255, 42, 63, 86), 3),
    emfPlusFillRectsInline(argb(255, 245, 246, 241), [{ x: 18, y: 18, width: 384, height: 224 }]),
    emfPlusDrawImage(40, { x: 44, y: 42, width: 150, height: 112 }, { x: 0, y: 0, width: 32, height: 24 }),
    emfPlusDrawImagePoints(
      40,
      [
        { x: 240, y: 46 },
        { x: 384, y: 76 },
        { x: 214, y: 174 }
      ],
      { x: 0, y: 0, width: 32, height: 24 }
    ),
    emfPlusDrawRects(10, [
      { x: 44, y: 42, width: 150, height: 112 },
      { x: 214, y: 46, width: 170, height: 128 }
    ])
  ])
)

samples.set(
  'synthetic-emfplus-bitmap-indexed.emf',
  createEmfPlus(360, 220, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusFillRectsInline(argb(255, 238, 242, 238), [{ x: 20, y: 20, width: 320, height: 180 }]),
    emfPlusIndexedBitmapObject(40, 32, 24),
    emfPlusPen(10, argb(255, 42, 63, 86), 3),
    emfPlusDrawImage(40, { x: 42, y: 40, width: 128, height: 96 }, { x: 0, y: 0, width: 32, height: 24 }),
    emfPlusDrawImagePoints(
      40,
      [
        { x: 214, y: 42 },
        { x: 324, y: 68 },
        { x: 190, y: 158 }
      ],
      { x: 0, y: 0, width: 32, height: 24 }
    ),
    emfPlusDrawRects(10, [
      { x: 42, y: 40, width: 128, height: 96 },
      { x: 190, y: 42, width: 134, height: 116 }
    ])
  ])
)

samples.set(
  'synthetic-emfplus-bitmap-16bpp.emf',
  createEmfPlus(420, 230, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusFillRectsInline(argb(255, 244, 239, 232), [{ x: 18, y: 18, width: 384, height: 194 }]),
    emfPlus16BppBitmapObject(41, 24, 18, EMFPLUS_PIXEL_FORMAT_16BPP_RGB565),
    emfPlus16BppBitmapObject(42, 24, 18, EMFPLUS_PIXEL_FORMAT_16BPP_RGB555),
    emfPlus16BppBitmapObject(43, 24, 18, EMFPLUS_PIXEL_FORMAT_16BPP_ARGB1555),
    emfPlusPen(10, argb(255, 42, 63, 86), 3),
    emfPlusDrawImage(41, { x: 38, y: 46, width: 96, height: 72 }, { x: 0, y: 0, width: 24, height: 18 }),
    emfPlusDrawImage(42, { x: 162, y: 46, width: 96, height: 72 }, { x: 0, y: 0, width: 24, height: 18 }),
    emfPlusDrawImage(43, { x: 286, y: 46, width: 96, height: 72 }, { x: 0, y: 0, width: 24, height: 18 }),
    emfPlusDrawImagePoints(
      43,
      [
        { x: 138, y: 142 },
        { x: 284, y: 130 },
        { x: 160, y: 202 }
      ],
      { x: 0, y: 0, width: 24, height: 18 }
    ),
    emfPlusDrawRects(10, [
      { x: 38, y: 46, width: 96, height: 72 },
      { x: 162, y: 46, width: 96, height: 72 },
      { x: 286, y: 46, width: 96, height: 72 }
    ])
  ])
)

samples.set(
  'synthetic-emfplus-state-modes.emf',
  createEmfPlus(420, 260, [
    emfPlusClear(argb(0, 255, 255, 255)),
    emfPlusSolidBrush(1, 255, 224, 240, 232),
    emfPlusPen(10, argb(255, 36, 74, 108), 2),
    emfPlusRecord(EMFPLUS_SET_ANTI_ALIAS_MODE, 8),
    emfPlusRecord(EMFPLUS_SET_INTERPOLATION_MODE, 7),
    emfPlusRecord(EMFPLUS_SET_PIXEL_OFFSET_MODE, 4),
    emfPlusRecord(EMFPLUS_SET_TEXT_RENDERING_HINT, 5),
    emfPlusRecord(EMFPLUS_SET_TEXT_CONTRAST, 0, data(2, (writer) => writer.u16(8))),
    emfPlusRecord(EMFPLUS_SET_COMPOSITING_MODE, 0),
    emfPlusRecord(EMFPLUS_SET_COMPOSITING_QUALITY, 4),
    emfPlusRecord(EMFPLUS_SET_RENDERING_ORIGIN, 0, data(8, (writer) => {
      writer.i32(6)
      writer.i32(10)
    })),
    emfPlusSetClipRect({ x: 40, y: 40, width: 340, height: 180 }, 2),
    emfPlusFillRectsInline(argb(255, 252, 252, 246), [{ x: 20, y: 20, width: 380, height: 220 }]),
    emfPlusResetClip(),
    emfPlusFillEllipse(1, { x: 56, y: 58, width: 132, height: 96 }),
    emfPlusDrawLines(10, [
      { x: 210, y: 62 },
      { x: 250, y: 190 },
      { x: 316, y: 78 },
      { x: 372, y: 198 }
    ])
  ])
)

fs.mkdirSync(outputDir, { recursive: true })

function resolveOutputPath(fileName) {
  if (fileName.startsWith('synthetic-classic-')) {
    return path.join(outputDir, 'synthetic', 'classic', fileName)
  }

  if (fileName.startsWith('synthetic-emfplus-')) {
    return path.join(outputDir, 'synthetic', 'emfplus', fileName)
  }

  return path.join(outputDir, fileName)
}

for (const [fileName, content] of samples) {
  const outputPath = resolveOutputPath(fileName)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content)
}

console.log(`Wrote ${samples.size} synthetic EMF samples to ${outputDir}`)
