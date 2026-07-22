# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-22

Initial release.

### Added

- `renderEmf` / `renderEmfToBlob` / `renderEmfToDataUrl` for rendering EMF and
  EMF+ buffers to a Canvas, PNG `Blob`, or PNG data URL.
- `renderWmf` / `renderWmfToBlob` / `renderWmfToDataUrl` for the WMF format, also
  used for nested WMF-in-EMF content.
- Classic EMF, EMF+, and WMF playback covering common primitives, paths,
  clipping, text, bitmaps, raster operations (ROP), gradients, textures, custom
  line caps, and nested metafiles.
- Published TypeScript declarations generated from JSDoc.
- Runtime diagnostics (`meta.diagnostics`, `meta.warnings`, `meta.unsupported`)
  describing degraded or unsupported records instead of silently approximating.

### Changed

- Deduplicated the EMF+ binary primitives (`decodeArgb`, `readRectF`,
  `readPointF`, `readPointFArray`, `readMatrix`, `signExtend`,
  `readPackedInteger`) into a single `src/emfplus/primitives.js` module.
- The visual test suite now asserts each render is non-blank and configures a
  screenshot comparison threshold.

### Fixed

- EMF+ `Restore` / `EndContainer` with an unmatched state token now no-op with
  a `restore-dc-unmatched` warning diagnostic (GDI+ fails the call and leaves
  the graphics unchanged) instead of being counted as unsupported records.
- EMF+ linear gradient brushes now use the horizontal `RectF` axis before
  applying their brush transform and repeat or mirror color stops according to
  `WrapMode`. Large fills no longer clamp to a solid end color or use the wrong
  gradient direction.
- Classic `RestoreDC` now honors negative relative depths and positive saved-DC
  levels, and unwinds every corresponding Canvas backend frame. Nested
  `RestoreDC(-2)` records no longer leave later world transforms active and
  render affected paths off-canvas. Truncated records and unmatched `SavedDC`
  values now degrade to a warning diagnostic (`record-decode-failed` /
  `restore-dc-unmatched`) instead of silently no-opping.
- WMF `META_RESTOREDC` — the twin of the classic `RestoreDC` bug above — now
  honors its `nSavedDC` parameter (negative relative depth or positive SaveDC
  level) instead of always popping a single frame, and unwinds every
  corresponding Canvas backend frame. Truncated records and unmatched values
  degrade to the same `record-decode-failed` / `restore-dc-unmatched` warning
  diagnostics; WMF playback now reports `diagnostics` alongside `warnings`.
- Classic `MM_TEXT` mapping no longer scales by `SetWindowExtEx` /
  `SetViewportExtEx` (GDI ignores those extents in `MM_TEXT`); previously a
  window extent against the default viewport extent could collapse an entire
  drawing to a single pixel.
- Classic text vertical alignment: the default `TA_TOP` now maps to the canvas
  `top` baseline instead of `alphabetic`, so top-aligned runs are no longer
  lifted off the top edge. `TA_UPDATECP` runs are positioned from the current
  position (`MoveToEx`) rather than the record's reference point.
- EMF+ `DrawImage` / `DrawImagePoints` with no drawable surface degrade to a
  single `image-surface-unavailable` diagnostic instead of being counted as both
  a warning and an unsupported record.

[Unreleased]: https://github.com/Smthie/emf-renderer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Smthie/emf-renderer/releases/tag/v0.1.0
