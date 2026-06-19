import { describe, expect, test } from 'vitest'
import {
  buildCssFontFromLogFontW,
  decodeClassicAnsiBytes,
  decodeEmfPlusStringFormat,
  decodeLogFontW,
  mapGdiTextAlignToCanvas,
  processHotkeyPrefix,
  readClassicAnsiString,
  STRING_FORMAT_DIRECTION_RIGHT_TO_LEFT,
  STRING_FORMAT_DIRECTION_VERTICAL,
  STRING_FORMAT_MEASURE_TRAILING_SPACES,
  STRING_FORMAT_NO_CLIP,
  STRING_FORMAT_NO_WRAP,
  TA_BASELINE,
  TA_BOTTOM,
  TA_CENTER,
  TA_UPDATECP
} from '../../src/runtime/text-layout.js'

describe('text layout helpers', () => {
  test('maps GDI text alignment flags to Canvas textAlign/textBaseline', () => {
    expect(mapGdiTextAlignToCanvas(0)).toEqual({
      textAlign: 'left',
      textBaseline: 'top',
      updateCurrentPosition: false
    })

    expect(mapGdiTextAlignToCanvas(TA_CENTER | TA_BOTTOM)).toEqual({
      textAlign: 'center',
      textBaseline: 'bottom',
      updateCurrentPosition: false
    })

    // TA_BASELINE keeps the alphabetic baseline; the default (no vertical bits)
    // must stay 'top' rather than collapsing back onto the baseline.
    expect(mapGdiTextAlignToCanvas(TA_BASELINE)).toMatchObject({
      textBaseline: 'alphabetic'
    })

    expect(mapGdiTextAlignToCanvas(TA_UPDATECP)).toMatchObject({
      updateCurrentPosition: true
    })
  })

  test('builds a CSS font string from a LOGFONTW-like shape', () => {
    const css = buildCssFontFromLogFontW({
      height: -20,
      weight: 700,
      italic: true,
      faceName: 'Arial'
    })

    expect(css).toContain('italic')
    expect(css).toContain('700')
    expect(css).toContain('20px')
    expect(css).toContain('Arial')
  })

  test('decodes LOGFONTW charset for classic ANSI text records', () => {
    const view = new DataView(new ArrayBuffer(92))
    view.setUint8(23, 0xba)
    writeUtf16Le(view, 28, 'Wingdings')

    expect(decodeLogFontW(view, 0)).toMatchObject({
      charSet: 0xba,
      faceName: 'Wingdings'
    })
  })

  test('decodes classic ANSI bytes as Windows-1252 for supported charsets', () => {
    expect(decodeClassicAnsiBytes(new Uint8Array([0x48, 0x80, 0x93, 0x51, 0x94]), { charSet: 0 })).toBe(
      'H\u20ac\u201cQ\u201d'
    )
    expect(decodeClassicAnsiBytes(new Uint8Array([0xa3, 0xe9]), { charSet: 1 })).toBe('\u00a3\u00e9')
  })

  test('warns while falling back to Windows-1252 for unsupported classic ANSI charsets', () => {
    const warnings = []
    const view = new DataView(new ArrayBuffer(4))
    view.setUint8(0, 0x80)
    view.setUint8(1, 0x00)
    view.setUint8(2, 0x93)

    const text = readClassicAnsiString(view, 0, 3, 3, {
      charSet: 0xba,
      addWarning(message, details) {
        warnings.push({ message, details })
      }
    })

    expect(text).toBe('\u20ac')
    expect(warnings).toEqual([
      {
        message: 'Unsupported EXTTEXTOUTA charset 186; decoding bytes as Windows-1252',
        details: {
          code: 'classic-text-charset-unsupported',
          capability: 'classic-text-encoding',
          charSet: 0xba,
          codePage: 'windows-1252'
        }
      }
    ])
  })

  test('processes HotkeyPrefix modes and escaped ampersands', () => {
    expect(processHotkeyPrefix('Save && Close', 0)).toEqual({
      text: 'Save && Close'
    })
    expect(processHotkeyPrefix('E&xit && Save', 1)).toEqual({
      text: 'Exit & Save',
      underlineRange: { start: 1, length: 1 }
    })
    expect(processHotkeyPrefix('E&xit && Save', 2)).toEqual({
      text: 'Exit & Save'
    })
  })

  test('decodes common EMF+ StringFormat flags into layout booleans', () => {
    const view = new DataView(new ArrayBuffer(56))
    view.setUint32(
      4,
      STRING_FORMAT_DIRECTION_RIGHT_TO_LEFT |
        STRING_FORMAT_DIRECTION_VERTICAL |
        STRING_FORMAT_MEASURE_TRAILING_SPACES |
        STRING_FORMAT_NO_WRAP |
        STRING_FORMAT_NO_CLIP,
      true
    )
    view.setUint32(12, 0, true)
    view.setUint32(16, 0, true)

    const format = decodeEmfPlusStringFormat(view, 0, 56)

    expect(format).toMatchObject({
      directionRightToLeft: true,
      directionVertical: true,
      measureTrailingSpaces: true,
      noWrap: true,
      noClip: true,
      textAlign: 'right',
      textBaseline: 'top'
    })
  })
})

function writeUtf16Le(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(offset + index * 2, text.charCodeAt(index), true)
  }
}
