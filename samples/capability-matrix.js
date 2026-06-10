export const triageCategories = Object.freeze([
  'parse',
  'object',
  'render',
  'corrupt',
  'host-limit',
  'deferred'
])

export const goldenTiers = Object.freeze([
  {
    id: 'darwin-browser',
    kind: 'baseline',
    platform: 'darwin',
    renderer: 'browser',
    directory: 'tests/visual/sample-render.spec.js-snapshots',
    required: true,
    description: 'Playwright browser rendering baseline for local regression checks on darwin.'
  },
  {
    id: 'windows-gdi',
    kind: 'golden',
    platform: 'win32',
    renderer: 'gdi',
    directory: 'tests/visual/goldens/windows-gdi',
    required: false,
    description: 'Optional native Windows GDI PNG golden output for classic EMF calibration.'
  },
  {
    id: 'windows-gdiplus',
    kind: 'golden',
    platform: 'win32',
    renderer: 'gdiplus',
    directory: 'tests/visual/goldens/windows-gdiplus',
    required: false,
    description: 'Optional native Windows GDI+ PNG golden output for EMF+ calibration.'
  }
])

export const visualGoldenThresholds = Object.freeze({
  default: Object.freeze({
    pixelDeltaThreshold: 2,
    maxChangedPixelRatio: 0.01,
    maxMeanChannelDelta: 2.5,
    maxMaxChannelDelta: 64
  }),
  text: Object.freeze({
    pixelDeltaThreshold: 3,
    maxChangedPixelRatio: 0.06,
    maxMeanChannelDelta: 7.5,
    maxMaxChannelDelta: 255
  }),
  bitmap: Object.freeze({
    pixelDeltaThreshold: 1,
    maxChangedPixelRatio: 0.005,
    maxMeanChannelDelta: 1.5,
    maxMaxChannelDelta: 32
  }),
  gradient: Object.freeze({
    pixelDeltaThreshold: 2,
    maxChangedPixelRatio: 0.025,
    maxMeanChannelDelta: 4,
    maxMaxChannelDelta: 96
  }),
  'clip-region': Object.freeze({
    pixelDeltaThreshold: 2,
    maxChangedPixelRatio: 0.015,
    maxMeanChannelDelta: 3,
    maxMaxChannelDelta: 96
  })
})

export const visualGoldenCoreSamples = Object.freeze([
  Object.freeze({
    tier: 'windows-gdi',
    sample: 'synthetic/classic/synthetic-classic-shapes.emf',
    thresholdGroup: 'default'
  }),
  Object.freeze({
    tier: 'windows-gdi',
    sample: 'synthetic/classic/synthetic-classic-dib-24bit.emf',
    thresholdGroup: 'bitmap'
  }),
  Object.freeze({
    tier: 'windows-gdi',
    sample: 'synthetic/classic/synthetic-classic-text.emf',
    thresholdGroup: 'text'
  }),
  Object.freeze({
    tier: 'windows-gdi',
    sample: 'synthetic/classic/synthetic-classic-metargn-clip.emf',
    thresholdGroup: 'clip-region'
  }),
  Object.freeze({
    tier: 'windows-gdi',
    sample: 'synthetic/classic/synthetic-classic-polypoly.emf',
    thresholdGroup: 'clip-region'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/emfplus/synthetic-emfplus-basic-shapes.emf',
    thresholdGroup: 'default'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/emfplus/synthetic-emfplus-bitmap.emf',
    thresholdGroup: 'bitmap'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/emfplus/synthetic-emfplus-gradients.emf',
    thresholdGroup: 'gradient'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/emfplus/synthetic-emfplus-path-clip-region.emf',
    thresholdGroup: 'clip-region'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/emfplus/synthetic-emfplus-text.emf',
    thresholdGroup: 'text'
  }),
  // First-party fixtures recorded by System.Drawing as EmfPlusDual. Unlike the
  // hand-authored EMF+-only fixtures above, native GDI+ can replay these files
  // completely, so they remain valid calibration inputs on any clone.
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/gdiplus/synthetic-gdiplus-linear-gradient.emf',
    thresholdGroup: 'gradient'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/gdiplus/synthetic-gdiplus-line-caps.emf',
    thresholdGroup: 'default'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/gdiplus/synthetic-gdiplus-line-dash.emf',
    thresholdGroup: 'default'
  }),
  Object.freeze({
    tier: 'windows-gdiplus',
    sample: 'synthetic/gdiplus/synthetic-gdiplus-custom-cap.emf',
    thresholdGroup: 'default'
  })
])

export function visualGoldenSampleKey(name) {
  return name
    .replace(/\.emf$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export const capabilityMatrix = Object.freeze([
  {
    sample: 'synthetic/classic/synthetic-classic-shapes.emf',
    category: 'geometry',
    capabilities: ['classic-shapes', 'brush-fill', 'pen-stroke'],
    ownerMilestone: 'M1',
    gapId: 'M1-classic-basic-render-state',
    expectedBehavior: 'Rectangles, ellipses, polygons, fill brushes, and pen strokes remain stable across backend state changes.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Core classic geometry fixture is currently renderable and protects broad backend state refactors.',
      nextAction: 'Keep in darwin/browser baseline and compare with Windows GDI when available.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-arcs-pies.emf',
    category: 'geometry',
    capabilities: ['classic-arcs', 'pies', 'chords'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-arc-region-edges',
    expectedBehavior: 'Arc, pie, and chord start/end semantics are preserved under classic coordinate transforms.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable synthetic coverage exists, but exact GDI arc edge semantics still need native calibration.',
      nextAction: 'Use as a Windows GDI golden candidate after M6 path/region work starts.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-dib-24bit.emf',
    category: 'bitmap',
    capabilities: ['classic-dib', '24bpp-rgb', 'stretch-blit'],
    ownerMilestone: 'M5',
    gapId: 'M5-classic-dib-format-matrix',
    expectedBehavior: '24 bpp DIB pixels are decoded, oriented, and drawn without entering unsupported lifecycle records.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Existing 24 bpp DIB path is renderable and is the control sample for broader bitmap format work.',
      nextAction: 'Keep as the baseline fixture while adding indexed, bitfields, and alpha bitmap samples.',
      ownerMilestone: 'M5'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-mapping.emf',
    category: 'mapping',
    capabilities: ['map-mode', 'viewport-window-origin', 'coordinate-scale'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-mapping-diagnostics',
    expectedBehavior: 'Classic map mode and viewport/window origin changes produce deterministic geometry placement.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Mapping behavior is renderable today and should detect regressions in transform plumbing.',
      nextAction: 'Use with real map-mode samples when diagnostics/API work lands.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-path-bezier.emf',
    category: 'path',
    capabilities: ['classic-path', 'bezier', 'fill-stroke'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-path-region',
    expectedBehavior: 'Classic path begin/end, Bezier segments, fill, and stroke remain stable.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable path fixture anchors later flatten/widen and region diagnostics work.',
      nextAction: 'Compare against Windows GDI after path/region support is expanded.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-metargn-clip.emf',
    category: 'clip',
    capabilities: ['classic-metargn', 'clip-region', 'clip-reset'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-metargn-clip',
    expectedBehavior: 'SETMETARGN promotes the current classic clip into the meta region so later local clip resets keep the effective constraint.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Focused classic meta-region sample covers the M6 clip layering semantics that were previously a no-op.',
      nextAction: 'Compare against Windows GDI once native golden generation is available.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-flatten-widen.emf',
    category: 'path',
    capabilities: ['classic-flattenpath', 'classic-widenpath', 'path-fill'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-flatten-widen-path',
    expectedBehavior: 'FLATTENPATH converts curves to line geometry and WIDENPATH turns stroked line paths into fillable outline paths with stable diagnostics for approximations.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Focused path sample locks the M6 flatten and widen behavior through visual regression.',
      nextAction: 'Tighten WIDENPATH join/cap semantics after Windows GDI comparison.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-polypoly.emf',
    category: 'path',
    capabilities: ['poly-polygon', 'fill-mode', 'multi-contour'],
    ownerMilestone: 'M6',
    gapId: 'M6-classic-poly-region',
    expectedBehavior: 'Multiple polygon contours honor classic fill mode and do not regress path winding behavior.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Synthetic multi-contour coverage exists, with exact GDI winding behavior reserved for native golden comparison.',
      nextAction: 'Keep as a focused regression fixture for M6 region changes.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-text.emf',
    category: 'text',
    capabilities: ['classic-text', 'opaque-background', 'wide-text'],
    ownerMilestone: 'M2',
    gapId: 'M2-classic-glyph-advance',
    expectedBehavior: 'Classic text draws at stable anchors with background and font state preserved.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable text control sample exists before per-glyph advance and justification work.',
      nextAction: 'Extend assertions once dx, ETO_PDY, and justification semantics are consumed.',
      ownerMilestone: 'M2'
    }
  },
  {
    sample: 'synthetic/classic/synthetic-classic-transform-clip.emf',
    category: 'clip',
    capabilities: ['world-transform', 'clip-rect', 'save-restore-dc'],
    ownerMilestone: 'M1',
    gapId: 'M1-state-clip-transform',
    expectedBehavior: 'World transform, clipping, and saved DC state are replayed without leaking into later draws.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable state fixture protects graphics state application changes.',
      nextAction: 'Keep in baseline while M1 applies quality/compositing state before drawing.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-basic-shapes.emf',
    category: 'geometry',
    capabilities: ['emfplus-shapes', 'solid-brush', 'pen'],
    ownerMilestone: 'M1',
    gapId: 'M1-emfplus-state-application',
    expectedBehavior: 'EMF+ basic shapes draw consistently as graphics quality state starts affecting backend calls.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable EMF+ shape control sample is suitable for M1 backend state refactors.',
      nextAction: 'Use as the low-noise EMF+ geometry golden candidate.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-bitmap.emf',
    category: 'bitmap',
    capabilities: ['emfplus-bitmap', 'draw-image', 'image-surface'],
    ownerMilestone: 'M5',
    gapId: 'M5-emfplus-bitmap-format-matrix',
    expectedBehavior: 'EMF+ bitmap objects are decoded into image surfaces and drawn at the requested destination.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable bitmap fixture anchors later raw/indexed/alpha bitmap expansion.',
      nextAction: 'Add native GDI+ golden after raw bitmap format coverage grows.',
      ownerMilestone: 'M5'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-bitmap-indexed.emf',
    category: 'bitmap',
    capabilities: ['emfplus-bitmap', 'indexed-palette', 'draw-image-points', 'image-surface'],
    ownerMilestone: 'M5',
    gapId: 'M5-emfplus-indexed-bitmap',
    expectedBehavior: 'EMF+ 8 bpp indexed bitmap payloads split palette data from pixel bytes and render palette alpha/color correctly.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Synthetic indexed bitmap fixture locks the palette payload and affine DrawImagePoints path added for M5.',
      nextAction: 'Compare against native GDI+ output once a Windows golden runner is available.',
      ownerMilestone: 'M5'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-bitmap-16bpp.emf',
    category: 'bitmap',
    capabilities: ['emfplus-bitmap', '16bpp-rgb555', '16bpp-rgb565', '16bpp-argb1555', 'image-surface'],
    ownerMilestone: 'M5',
    gapId: 'M5-emfplus-raw-16bpp-bitmap',
    expectedBehavior: 'EMF+ 16 bpp RGB555, RGB565, and ARGB1555 raw bitmaps render with stable channel and one-bit alpha semantics.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Synthetic low-bit-depth bitmap fixture covers the raw pixel formats that previously fell outside EMF+ bitmap support.',
      nextAction: 'Use as the core M5 visual regression sample and add real fixtures when collected.',
      ownerMilestone: 'M5'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-curves-arcs.emf',
    category: 'path',
    capabilities: ['emfplus-curves', 'arcs', 'bezier'],
    ownerMilestone: 'M4',
    gapId: 'M4-pen-curve-stroke-semantics',
    expectedBehavior: 'Curves and arcs remain renderable when pen transform, dash cap, and custom cap work changes stroke paths.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable curve fixture is a stable M4 stroke semantics regression target.',
      nextAction: 'Pair with Windows GDI+ golden once advanced pen semantics are implemented.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-gradients.emf',
    category: 'gradient',
    capabilities: ['linear-gradient', 'path-gradient', 'blend-colors'],
    ownerMilestone: 'M1',
    gapId: 'M1-quality-gradient-compositing',
    expectedBehavior: 'Gradient brush colors and interpolation remain visually stable under quality/compositing changes.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable gradient fixture targets quality state and color interpolation regressions.',
      nextAction: 'Use stricter golden thresholds for this core visual fixture when native output exists.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-path-clip-region.emf',
    category: 'clip',
    capabilities: ['emfplus-path', 'clip-region', 'combine-mode'],
    ownerMilestone: 'M6',
    gapId: 'M6-emfplus-region-diagnostics',
    expectedBehavior: 'EMF+ path and region clipping constrain subsequent fills without leaking state.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable path/clip fixture gives M6 region diagnostics a visual anchor.',
      nextAction: 'Keep as a baseline and add gap diagnostics when unsupported combine modes appear.',
      ownerMilestone: 'M6'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-state-modes.emf',
    category: 'state',
    capabilities: ['compositing-mode', 'smoothing-mode', 'interpolation-mode', 'pixel-offset-mode'],
    ownerMilestone: 'M1',
    gapId: 'M1-quality-state-consumption',
    expectedBehavior: 'EMF+ quality/compositing state records affect later rendering or produce explicit diagnostics.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Synthetic state fixture directly represents the M1 class of parsed-but-not-consumed state.',
      nextAction: 'Use unit tests plus this visual sample to prove backend state application.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-text.emf',
    category: 'text',
    capabilities: ['emfplus-draw-string', 'string-format', 'brush-text'],
    ownerMilestone: 'M2',
    gapId: 'M2-emfplus-string-tracking',
    expectedBehavior: 'EMF+ DrawString placement, brush fill, and StringFormat basics remain stable.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable text fixture is the EMF+ counterpart for M2 glyph and tracking work.',
      nextAction: 'Extend with tracking/format flag assertions as text layout matures.',
      ownerMilestone: 'M2'
    }
  },
  {
    sample: 'synthetic/emfplus/synthetic-emfplus-transform-state.emf',
    category: 'state',
    capabilities: ['emfplus-transform', 'save-restore', 'page-transform'],
    ownerMilestone: 'M1',
    gapId: 'M1-transform-state-consumption',
    expectedBehavior: 'EMF+ transform and save/restore state stay scoped to the intended draw operations.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable transform fixture protects the state stack around M1 backend state application.',
      nextAction: 'Keep in visual baseline and compare to GDI+ when golden output is available.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/gdiplus/synthetic-gdiplus-linear-gradient.emf',
    category: 'gradient',
    capabilities: ['emfplus-linear-gradient', 'gradient-wrap-mode', 'brush-transform'],
    ownerMilestone: 'M1',
    gapId: 'M1-gdiplus-native-linear-gradient',
    expectedBehavior: 'Transformed tiled gradients repeat with the same direction and color bands as native GDI+.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'First-party EmfPlusDual fixture provides a native-replayable gradient calibration sample.',
      nextAction: 'Keep in the Windows GDI+ golden core.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'synthetic/gdiplus/synthetic-gdiplus-line-caps.emf',
    category: 'pen',
    capabilities: ['emfplus-pen-cap', 'line-cap', 'stroke'],
    ownerMilestone: 'M4',
    gapId: 'M4-gdiplus-native-line-caps',
    expectedBehavior: 'Round and square start/end caps match native GDI+ placement and scaling.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'First-party EmfPlusDual fixture records supported basic cap values through native GDI+.',
      nextAction: 'Keep in the Windows GDI+ golden core.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'synthetic/gdiplus/synthetic-gdiplus-line-dash.emf',
    category: 'pen',
    capabilities: ['emfplus-dash-style', 'dash-cap', 'custom-dash-pattern'],
    ownerMilestone: 'M4',
    gapId: 'M4-gdiplus-native-line-dash',
    expectedBehavior: 'Built-in and custom dash patterns preserve phase, cap, and stroke width.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'First-party EmfPlusDual fixture provides native-replayable dash calibration.',
      nextAction: 'Keep in the Windows GDI+ golden core.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'synthetic/gdiplus/synthetic-gdiplus-custom-cap.emf',
    category: 'pen',
    capabilities: ['custom-line-cap', 'adjustable-arrow-cap', 'path-stroke'],
    ownerMilestone: 'M4',
    gapId: 'M4-gdiplus-native-custom-cap',
    expectedBehavior: 'Adjustable-arrow custom caps match native GDI+ size, fill, and orientation.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'First-party EmfPlusDual fixture exercises a custom cap with a native serialization path.',
      nextAction: 'Keep in the Windows GDI+ golden core.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'real/render/real-libreoffice-eto-pdy.emf',
    category: 'text',
    capabilities: ['classic-ext-text-out', 'eto-pdy', 'glyph-advance'],
    ownerMilestone: 'M2',
    gapId: 'M2-classic-eto-pdy',
    expectedBehavior: 'Per-glyph x/y advances from ETO_PDY determine text placement instead of a single fillText call.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable real LibreOffice sample exposes the M2 ETO_PDY behavior gap.',
      nextAction: 'Use as the primary real fixture for per-glyph classic text layout.',
      ownerMilestone: 'M2'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-align-rtl-reading.emf',
    category: 'text',
    capabilities: ['rtl-reading', 'text-alignment', 'layout-direction'],
    ownerMilestone: 'M3',
    gapId: 'M3-classic-rtl-layout',
    expectedBehavior: 'RTL reading and alignment affect reference points and advance direction predictably.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable real sample covers layout behavior that Canvas cannot fully infer from textAlign alone.',
      nextAction: 'Use for M3 RTL/mirroring work and diagnostics for approximated behavior.',
      ownerMilestone: 'M3'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-draw-string-transparent.emf',
    category: 'text',
    capabilities: ['emfplus-draw-string', 'transparent-background', 'brush-text'],
    ownerMilestone: 'M2',
    gapId: 'M2-emfplus-transparent-text',
    expectedBehavior: 'Transparent text background does not erase prior content while glyph fill remains visible.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable real EMF+ text sample guards text background behavior during glyph layout changes.',
      nextAction: 'Keep in darwin baseline and add GDI+ golden for text opacity calibration.',
      ownerMilestone: 'M2'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-emfplus-linear-gradient.emf',
    category: 'gradient',
    capabilities: ['emfplus-linear-gradient', 'color-blend'],
    ownerMilestone: 'M1',
    gapId: 'M1-emfplus-gradient-quality',
    expectedBehavior: 'Linear gradient brush output remains stable under compositing and smoothing state changes.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable LibreOffice gradient sample supplies a real producer case for M1 visual sensitivity.',
      nextAction: 'Use as a stricter golden candidate once Windows GDI+ output is captured.',
      ownerMilestone: 'M1'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-emfplus-draw-line-with-caps.emf',
    category: 'pen',
    capabilities: ['emfplus-pen-cap', 'line-cap', 'stroke'],
    ownerMilestone: 'M4',
    gapId: 'M4-pen-caps',
    expectedBehavior: 'Line caps appear at the correct ends with stable scaling and orientation.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable cap sample is the real counterpart for M4 advanced pen semantics.',
      nextAction: 'Use with dash/custom cap fixtures to validate pen cap behavior.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-emfplus-draw-line-with-dash.emf',
    category: 'pen',
    capabilities: ['emfplus-dash-style', 'dash-cap', 'stroke'],
    ownerMilestone: 'M4',
    gapId: 'M4-dash-cap',
    expectedBehavior: 'Dashed lines preserve dash pattern, cap behavior, and stroke width across transforms.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable dash sample will expose M4 dash cap and transform regressions.',
      nextAction: 'Add unit checks around dash cap diagnostics when M4 starts.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-emfplus-draw-path-with-custom-cap.emf',
    category: 'pen',
    capabilities: ['custom-line-cap', 'path-stroke', 'emfplus-pen'],
    ownerMilestone: 'M4',
    gapId: 'M4-custom-line-cap-default-path',
    expectedBehavior: 'Custom line cap path data is rendered or downgraded through stable diagnostics.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable real sample already exercises custom cap handling and should remain visible in M4.',
      nextAction: 'Promote to stricter golden comparison after Default custom cap path rendering lands.',
      ownerMilestone: 'M4'
    }
  },
  {
    sample: 'real/render/real-libreoffice-test-draw-image-points-type-bitmap.emf',
    category: 'bitmap',
    capabilities: ['draw-image-points', 'bitmap-transform', 'image-attributes'],
    ownerMilestone: 'M5',
    gapId: 'M5-draw-image-points-bitmap',
    expectedBehavior: 'Bitmap DrawImagePoints applies the destination parallelogram without losing pixels or unsupported lifecycle records.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable real sample covers image sampling and affine placement before M5 bitmap expansion.',
      nextAction: 'Use with interpolation mode tests after M1/M5 state and bitmap work converge.',
      ownerMilestone: 'M5'
    }
  },
  {
    sample: 'real/render/real-apache-poi-nested-wmf.emf',
    category: 'nested-metafile',
    capabilities: ['nested-wmf', 'comment-record', 'metafile-playback'],
    ownerMilestone: 'M6',
    gapId: 'M6-nested-metafile-diagnostics',
    expectedBehavior: 'Nested WMF content is either replayed through the unified dispatcher or reported with stable diagnostics.',
    goldenCandidate: true,
    triage: {
      category: 'render',
      reason: 'Renderable nested WMF fixture keeps nested metafile playback visible in the real suite.',
      nextAction: 'Use as the non-gap nested control sample for M6 diagnostics/API work.',
      ownerMilestone: 'M6'
    }
  }
])

export const gapTriage = Object.freeze([
  {
    sample: 'real/parse-gap/real-apache-poi-slideshow-crash-7b60e9fe.emf',
    category: 'corrupt',
    reason: 'Parser reports invalid EMF record size 23552 at offset 152, which indicates malformed or truncated input before renderer work can begin.',
    nextAction: 'Keep as a parser robustness fixture; parse should fail with the documented error until recovery diagnostics are designed.',
    ownerMilestone: 'M6'
  },
  {
    sample: 'real/parse-gap/real-apache-poi-spreadsheet-61294.emf',
    category: 'corrupt',
    reason: 'Parser reports invalid EMF record size 4294902055 at offset 2384, consistent with bad record framing.',
    nextAction: 'Keep as corrupt-input coverage and avoid treating it as a renderer regression.',
    ownerMilestone: 'M6'
  },
  {
    sample: 'real/parse-gap/real-libemf2svg-corrupted-bad-corrupted-2014-12-02-215338.emf',
    category: 'corrupt',
    reason: 'Parser rejects the file at offset 0 with invalid EMF header size 59296.',
    nextAction: 'Keep as header validation coverage; do not spend renderer milestones on this sample.',
    ownerMilestone: 'M6'
  },
  {
    sample: 'real/parse-gap/real-libreoffice-tdf93750.emf',
    category: 'parse',
    reason: 'Classic records parse far enough to reach an EMF+ payload, then fail on invalid trailing bytes.',
    nextAction: 'Investigate EMF+ comment payload tolerance and add structured parse diagnostics before making it renderable.',
    ownerMilestone: 'M6'
  },
  {
    sample: 'real/render-gap/real-libemf2svg-fixture-test-libuemf-p-ref.emf',
    category: 'render',
    reason: 'Top-level EMF parse succeeds, but render currently throws DataView out-of-bounds while replaying the sample.',
    nextAction: 'Keep out of the normal visual suite; use M6 diagnostics to identify the failing record and downgrade path.',
    ownerMilestone: 'M6'
  },
  {
    sample: 'real/render-gap/real-libreoffice-test-emfplus-draw-beziers.emf',
    category: 'render',
    reason: 'EMF+ Bezier sample parses, then render fails with DataView out-of-bounds during playback.',
    nextAction: 'Route to M4 curve/pen playback work and add record-offset diagnostics before moving into real/render.',
    ownerMilestone: 'M4'
  },
  {
    sample: 'real/render-gap/real-libreoffice-test-emfplus-draw-curve.emf',
    category: 'render',
    reason: 'EMF+ curve sample parses, then render fails with DataView out-of-bounds during playback.',
    nextAction: 'Route to M4 curve stroke semantics and keep as a negative render-gap smoke fixture.',
    ownerMilestone: 'M4'
  },
  {
    sample: 'real/render-gap/real-libreoffice-test-emfplus-draw-image-points-with-metafile.emf',
    category: 'object',
    reason: 'The sample parses but render fails while handling DrawImagePoints with a metafile-backed image object.',
    nextAction: 'Track with nested metafile/image object support; keep skipped from browser visual snapshots until object replay is implemented.',
    ownerMilestone: 'M5'
  },
  {
    sample: 'real/render-gap/real-libreoffice-test-emfplus-get-dc.emf',
    category: 'render',
    reason: 'Mixed EMF+/classic GetDC transition parses but render fails with DataView out-of-bounds during replay.',
    nextAction: 'Use as a bridge-state fixture for M1 state handling and M6 diagnostics before moving to real/render.',
    ownerMilestone: 'M1'
  },
  {
    sample: 'real/render-gap/real-libreoffice-test-emfplus-get-dc2.emf',
    category: 'render',
    reason: 'Second mixed GetDC transition sample has the same parse-success/render-failure profile.',
    nextAction: 'Keep paired with get-dc as negative coverage for EMF+/classic state transition repair.',
    ownerMilestone: 'M1'
  }
])
