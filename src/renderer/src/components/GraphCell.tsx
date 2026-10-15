import type { GraphNode } from '../../../shared/graph-nodes'
import { avatarColor, initials } from './Avatar'
import type { GraphRow, GraphSegment } from '../../../shared/types'

export const LANE_WIDTH = 24
export const ROW_HEIGHT = 34
const NODE_RADIUS = 11
const MERGE_RADIUS = 5
const CORNER = 8

const laneX = (lane: number): number => LANE_WIDTH / 2 + lane * LANE_WIDTH

/** Lanes drawn dashed in a row: lines leaving a WIP or stash node until they reach their commit. */
export interface DashedLanes {
  top: ReadonlySet<number>
  bottom: ReadonlySet<number>
}

const isPseudo = (node: GraphNode): boolean => node.kind !== 'commit'

export function dashedLanesPerRow(rows: ReadonlyArray<GraphRow<GraphNode>>): DashedLanes[] {
  let carrying = new Set<number>()
  return rows.map((row) => {
    const top = carrying
    const passing = new Set(
      row.bottom.filter((segment) => segment.from === segment.to && segment.from !== row.column).map((s) => s.to)
    )
    const bottom = new Set([...carrying].filter((lane) => passing.has(lane)))
    if (isPseudo(row.node)) bottom.add(row.column)
    carrying = bottom
    return { top, bottom }
  })
}

/** Top half: lanes come down from the row above; one that joins this node bends in with a rounded corner. */
const topPath = ({ from, to }: GraphSegment, middle: number): string => {
  const x1 = laneX(from)
  const x2 = laneX(to)
  if (x1 === x2) return `M${x1} 0V${middle}`
  const dir = Math.sign(x2 - x1)
  return `M${x1} 0V${middle - CORNER}Q${x1} ${middle} ${x1 + dir * CORNER} ${middle}H${x2}`
}

/** Bottom half: a new or joining lane leaves the node sideways, then turns down. */
const bottomPath = ({ from, to }: GraphSegment, middle: number): string => {
  const x1 = laneX(from)
  const x2 = laneX(to)
  if (x1 === x2) return `M${x1} ${middle}V${ROW_HEIGHT}`
  const dir = Math.sign(x2 - x1)
  return `M${x1} ${middle}H${x2 - dir * CORNER}Q${x2} ${middle} ${x2} ${middle + CORNER}V${ROW_HEIGHT}`
}

function Node({ node, x, y, color }: { node: GraphNode; x: number; y: number; color: string }) {
  if (node.kind === 'wip') {
    return <circle className="node-wip" cx={x} cy={y} r={NODE_RADIUS - 2} stroke={color} />
  }
  if (node.kind === 'stash') {
    const size = (NODE_RADIUS - 2) * 2
    return <rect className="node-stash" x={x - size / 2} y={y - size / 2} width={size} height={size} rx={4} stroke={color} />
  }
  if (node.parents.length > 1) {
    return <circle cx={x} cy={y} r={MERGE_RADIUS} fill={color} />
  }
  // Avatar framed by the lane colour, like GitKraken's author photos.
  return (
    <g>
      <circle cx={x} cy={y} r={NODE_RADIUS} fill={avatarColor(node.commit.authorEmail)} stroke={color} strokeWidth={2} />
      <text className="node-initials" x={x} y={y} dy="0.35em" textAnchor="middle">
        {initials(node.commit.authorName)}
      </text>
    </g>
  )
}

interface Props {
  row: GraphRow<GraphNode>
  lanes: number
  dashed: DashedLanes
  /** Stroke width of the lane lines, from Settings. */
  lineWidth: number
  /** Colour of a lane in the chosen palette. */
  laneColor: (lane: number) => string
}

export function GraphCell({ row, lanes, dashed, lineWidth, laneColor }: Props) {
  const middle = ROW_HEIGHT / 2
  const pseudo = isPseudo(row.node)
  return (
    <svg width={lanes * LANE_WIDTH} height={ROW_HEIGHT} className="graph-cell" aria-hidden>
      {row.top.map((segment, i) => (
        <path
          key={`t${i}`}
          d={topPath(segment, middle)}
          stroke={laneColor(segment.color)}
          strokeWidth={lineWidth}
          strokeDasharray={dashed.top.has(segment.from) ? '3 3' : undefined}
        />
      ))}
      {row.bottom.map((segment, i) => (
        <path
          key={`b${i}`}
          d={bottomPath(segment, middle)}
          stroke={laneColor(segment.color)}
          strokeWidth={lineWidth}
          strokeDasharray={
            (pseudo && segment.from === row.column) || (segment.from === segment.to && dashed.bottom.has(segment.to))
              ? '3 3'
              : undefined
          }
        />
      ))}
      <Node node={row.node} x={laneX(row.column)} y={middle} color={laneColor(row.column)} />
    </svg>
  )
}
