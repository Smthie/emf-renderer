// Shared JSDoc shape contracts for the runtime. This module emits no runtime
// code — it exists so the geometry value shapes that flow between the parsers,
// dispatchers, geometry helpers, and the canvas backend have a single
// documented definition. Pinning them down guards against the kind of silent
// field drift that let three `clonePoint` copies diverge (one spread every
// field, one only x/y, one threw on null). Reference a shape from any module
// with `@param {import('./types.js').RectL} rect`.

/**
 * An integer point in logical or device space (EMF POINTL / POINTS, EMF+
 * PointF). Carries only x and y — no extra fields are ever attached.
 * @typedef {Object} PointL
 * @property {number} x
 * @property {number} y
 */

/**
 * An edge-defined rectangle (Win32 RECTL): the classic EMF rect shape.
 * @typedef {Object} RectL
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * An origin-plus-size rectangle (EMF+ RectF, image/destination rects). Distinct
 * from {@link RectL}; `toRectL` bridges this shape to the edge-defined one.
 * @typedef {Object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * A 2x3 affine transform as a flat 6-tuple `[a, b, c, d, e, f]` mapping
 * `(x, y) -> (a*x + c*y + e, b*x + d*y + f)`.
 * @typedef {[number, number, number, number, number, number]} Matrix
 */

/**
 * One subpath. `points` holds the on-path vertices in order; flattened/widened
 * geometry keeps them as plain {@link PointL}-shaped vertices.
 * @typedef {Object} PathFigure
 * @property {boolean} closed Whether the figure is closed back to its start.
 * @property {Array<{ x: number, y: number }>} points
 */

/**
 * A resolved path: an ordered list of figures, ready for the backend to fill or
 * stroke. This is the shape produced by `PathBuilder.toPathGeometry()`.
 * @typedef {Object} PathGeometry
 * @property {PathFigure[]} figures
 */

export {}
