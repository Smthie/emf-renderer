import { decodePathObject } from './path.js'
import { combineRegions, pathToRegionGeometry, rectToRegionGeometry } from '../../runtime/region-ops.js'
import { readRectF } from '../primitives.js'

const REGION_NODE_AND = 0x00000001
const REGION_NODE_OR = 0x00000002
const REGION_NODE_XOR = 0x00000003
const REGION_NODE_EXCLUDE = 0x00000004
const REGION_NODE_COMPLEMENT = 0x00000005
const REGION_NODE_RECT = 0x10000000
const REGION_NODE_PATH = 0x10000001
const REGION_NODE_EMPTY = 0x10000002
const REGION_NODE_INFINITE = 0x10000003
const REGION_OBJECT_HEADER_SIZE = 8

function createLeafNode(type, extra = {}) {
  return { type, ...extra }
}

function resolveCombineMode(nodeType) {
  return (
    {
      [REGION_NODE_AND]: 'intersect',
      [REGION_NODE_OR]: 'union',
      [REGION_NODE_XOR]: 'xor',
      [REGION_NODE_EXCLUDE]: 'exclude',
      [REGION_NODE_COMPLEMENT]: 'complement'
    }[nodeType] ?? null
  )
}

function parseRegionNode(view, offset, limit) {
  if (offset + 4 > limit) {
    throw new Error('Region node exceeds object bounds')
  }

  const nodeType = view.getUint32(offset, true)

  if (nodeType === REGION_NODE_RECT) {
    if (offset + 20 > limit) {
      throw new Error('Region rect node exceeds object bounds')
    }

    return {
      node: createLeafNode('rect', { rect: readRectF(view, offset + 4) }),
      nextOffset: offset + 20,
      nodeCount: 1
    }
  }

  if (nodeType === REGION_NODE_PATH) {
    if (offset + 8 > limit) {
      throw new Error('Region path node exceeds object bounds')
    }

    const pathLength = view.getUint32(offset + 4, true)
    const pathOffset = offset + 8
    const pathEnd = pathOffset + pathLength

    if (pathEnd > limit) {
      throw new Error('Region path payload exceeds object bounds')
    }

    return {
      node: createLeafNode('path', { path: decodePathObject(view, pathOffset, pathLength) }),
      nextOffset: pathEnd,
      nodeCount: 1
    }
  }

  if (nodeType === REGION_NODE_EMPTY) {
    return {
      node: createLeafNode('empty'),
      nextOffset: offset + 4,
      nodeCount: 1
    }
  }

  if (nodeType === REGION_NODE_INFINITE) {
    return {
      node: createLeafNode('infinite'),
      nextOffset: offset + 4,
      nodeCount: 1
    }
  }

  const combineMode = resolveCombineMode(nodeType)

  if (!combineMode) {
    throw new Error(`Unsupported region node type 0x${nodeType.toString(16)}`)
  }

  const left = parseRegionNode(view, offset + 4, limit)
  const right = parseRegionNode(view, left.nextOffset, limit)

  return {
    node: {
      type: combineMode === 'union' ? 'or' : combineMode,
      left: left.node,
      right: right.node
    },
    nextOffset: right.nextOffset,
    nodeCount: 1 + left.nodeCount + right.nodeCount
  }
}

export function resolveRegionNodeGeometry(node, universe = null) {
  if (!node) {
    return undefined
  }

  if (node.type === 'rect') {
    return rectToRegionGeometry(node.rect)
  }

  if (node.type === 'path') {
    return pathToRegionGeometry(node.path, { fillMode: node.path?.fillMode })
  }

  if (node.type === 'empty') {
    return []
  }

  if (node.type === 'infinite') {
    return null
  }

  const mode =
    {
      intersect: 'intersect',
      or: 'union',
      xor: 'xor',
      exclude: 'exclude',
      complement: 'complement'
    }[node.type] ?? null

  if (!mode) {
    return undefined
  }

  const left = resolveRegionNodeGeometry(node.left, universe)
  const right = resolveRegionNodeGeometry(node.right, universe)

  if ((mode === 'exclude' || mode === 'complement' || mode === 'xor') && universe === null && (left === null || right === null)) {
    return undefined
  }

  return combineRegions(left, right, mode, universe)
}

export function decodeRegionObject(view, offset, dataSize) {
  if (dataSize < REGION_OBJECT_HEADER_SIZE) {
    return {
      kind: 'region',
      type: 'unknown',
      reason: 'header too short'
    }
  }

  try {
    const nodeCount = view.getUint32(offset + 4, true) + 1
    const parsed = parseRegionNode(view, offset + REGION_OBJECT_HEADER_SIZE, offset + dataSize)
    const geometry = resolveRegionNodeGeometry(parsed.node)

    if (parsed.node.type === 'rect' && nodeCount === 1) {
      return {
        kind: 'region',
        type: 'rect',
        rect: parsed.node.rect,
        geometry
      }
    }

    if (parsed.node.type === 'infinite' && nodeCount === 1) {
      return {
        kind: 'region',
        type: 'infinite',
        geometry
      }
    }

    if (parsed.node.type === 'empty' && nodeCount === 1) {
      return {
        kind: 'region',
        type: 'empty',
        geometry
      }
    }

    return {
      kind: 'region',
      type: 'tree',
      nodeCount: parsed.nodeCount,
      root: parsed.node,
      geometry
    }
  } catch (error) {
    return {
      kind: 'region',
      type: 'unknown',
      reason: error?.message ?? 'parse failed'
    }
  }
}
