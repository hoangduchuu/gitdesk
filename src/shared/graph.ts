import type { GraphItem, GraphRow, GraphSegment } from './types'

/** Each slot holds the hash of the commit that lane is waiting for, or null when free. */
type Lanes = ReadonlyArray<string | null>

const trimEnd = (lanes: Array<string | null>): Array<string | null> => {
  const copy = [...lanes]
  while (copy.length > 0 && copy[copy.length - 1] === null) copy.pop()
  return copy
}

const freeSlot = (lanes: Array<string | null>): number => {
  const index = lanes.indexOf(null)
  return index === -1 ? lanes.length : index
}

const topSegments = (before: Lanes, hash: string, column: number): GraphSegment[] =>
  before.flatMap((expected, lane) => {
    if (expected === null) return []
    const to = expected === hash ? column : lane
    return [{ from: lane, to, color: lane }]
  })

interface RowStep {
  column: number
  after: Array<string | null>
  /** Lanes this commit just pointed at one of its parents. */
  parentLanes: Set<number>
  /** Parents that were already tracked by a different lane. */
  joins: number[]
}

const stepRow = (before: Lanes, commit: GraphItem): RowStep => {
  const found = before.indexOf(commit.hash)
  const lanes = [...before]
  const column = found === -1 ? freeSlot(lanes) : found

  // Every lane waiting for this commit converges into its column.
  const converged = lanes.map((expected) => (expected === commit.hash ? null : expected))

  const parentLanes = new Set<number>()
  const joins: number[] = []
  const [firstParent, ...otherParents] = commit.parents

  if (firstParent !== undefined) {
    converged[column] = firstParent
    parentLanes.add(column)
  }

  for (const parent of otherParents) {
    const tracked = converged.indexOf(parent)
    if (tracked !== -1) {
      joins.push(tracked)
      continue
    }
    const slot = freeSlot(converged)
    converged[slot] = parent
    parentLanes.add(slot)
  }

  return { column, after: converged, parentLanes, joins }
}

const bottomSegments = (step: RowStep): GraphSegment[] => {
  const { column, after, parentLanes, joins } = step
  const lanes = after.flatMap((expected, lane) => {
    if (expected === null) return []
    const from = parentLanes.has(lane) ? column : lane
    return [{ from, to: lane, color: lane }]
  })
  const merges = joins.map((lane) => ({ from: column, to: lane, color: lane }))
  return [...lanes, ...merges]
}

/**
 * Assign each node (given newest first, topologically ordered) to a lane and
 * compute the line segments needed to draw the commit graph row by row.
 */
export function layoutGraph<T extends GraphItem>(nodes: readonly T[]): Array<GraphRow<T>> {
  const rows: Array<GraphRow<T>> = []
  let lanes: Array<string | null> = []

  for (const node of nodes) {
    const step = stepRow(lanes, node)
    const after = trimEnd(step.after)
    rows.push({
      node,
      column: step.column,
      top: topSegments(lanes, node.hash, step.column),
      bottom: bottomSegments({ ...step, after }),
      width: Math.max(lanes.length, after.length, step.column + 1)
    })
    lanes = after
  }

  return rows
}
