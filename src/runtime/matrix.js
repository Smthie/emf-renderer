export const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0]

export function cloneMatrix(matrix) {
  return [...matrix]
}

export function multiplyMatrices(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ]
}
