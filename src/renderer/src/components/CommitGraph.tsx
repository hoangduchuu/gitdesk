import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { GraphNode } from '../../../shared/graph-nodes'
import { ageMarkers } from '../../../shared/format'
import { groupRefs, type RefLabel } from '../../../shared/refs'
import type { GraphRow } from '../../../shared/types'
import { LINE_WIDTH_PX, useSettings } from '../hooks/useSettings'
import { localeOf, useT, type Translate } from '../i18n'
import { ChangeIcon } from './ChangeIcon'
import { laneColorFrom } from '../palettes'
import { dashedLanesPerRow, GraphCell, LANE_WIDTH, ROW_HEIGHT } from './GraphCell'

const OVERSCAN_ROWS = 10
const MIN_GRAPH_LANES = 3
const MAX_GRAPH_LANES = 16

interface Props {
  rows: ReadonlyArray<GraphRow<GraphNode>>
  selectedHash: string | null
  /** Scroll this node into view when it changes. */
  revealHash: string | null
  /** Extra commits selected with Cmd/Ctrl-click (for multi-commit cherry-pick). */
  picked: ReadonlySet<string>
  onSelect: (node: GraphNode, additive: boolean) => void
  onContextMenu: (node: GraphNode, event: MouseEvent) => void
}

/** Virtualised list: only rows near the viewport are rendered, so large histories stay fast. */
export function CommitGraph({ rows, selectedHash, revealHash, picked, onSelect, onContextMenu }: Props) {
  const t = useT()
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setHeight(entry?.contentRect.height ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!element || revealHash === null) return
    const index = rows.findIndex((row) => row.node.hash === revealHash)
    if (index === -1) return
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 3)
    }
  }, [revealHash, rows])

  const lanes = useMemo(
    () => Math.min(MAX_GRAPH_LANES, Math.max(MIN_GRAPH_LANES, ...rows.map((row) => row.width))),
    [rows]
  )
  const dashed = useMemo(() => dashedLanesPerRow(rows), [rows])
  const settings = useSettings()
  const lineWidth = LINE_WIDTH_PX[settings.graphLineWidth]
  const laneColor = (lane: number): string => laneColorFrom(settings.graphPalette, lane)
  const ages = useMemo(() => ageMarkers(rows.map((row) => nodeTime(row.node)), Date.now() / 1000, localeOf(settings.language)), [rows, settings.language])
  const graphWidth = lanes * LANE_WIDTH + 8

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN_ROWS)

  return (
    <div className="graph" style={{ '--graph-width': `${graphWidth}px` } as CSSProperties}>
      <div className="graph-header">
        <div className="col-refs">{t('graph.branchTag')}</div>
        <div className="col-graph">{t('graph.graph')}</div>
        <div className="col-message">{t('graph.commitMessage')}</div>
      </div>
      <div className="graph-viewport" ref={viewport} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(first, last).map((row, i) => {
            const index = first + i
            const color = laneColor(row.column)
            const refs = row.node.kind === 'commit' ? groupRefs(row.node.commit.refs) : []
            return (
              <div
                key={row.node.hash}
                className={`graph-row row-${row.node.kind}${refs.length > 0 ? ' has-refs' : ''}${
                  row.node.hash === selectedHash || picked.has(row.node.hash) ? ' selected' : ''
                }`}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, '--lane-color': color } as CSSProperties}
                onClick={(event) => onSelect(row.node, event.metaKey || event.ctrlKey)}
                onContextMenu={(event) => onContextMenu(row.node, event)}
              >
                <div className="col-refs">
                  <RefLabels refs={refs} t={t} />
                </div>
                <div className="col-graph">
                  <GraphCell row={row} lanes={lanes} dashed={dashed[index]!} lineWidth={lineWidth} laneColor={laneColor} />
                </div>
                <div className="col-message" title={fullMessage(row.node)}>
                  <Message node={row.node} />
                  {ages[index] && <span className="age-marker">{ages[index]}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Every branch and tag on the commit, side by side; long names shrink to fit the column. */
function RefLabels({ refs, t }: { refs: readonly RefLabel[]; t: Translate }) {
  if (refs.length === 0) return null
  return (
    <span className="ref-labels" title={refs.map((ref) => ref.label).join('\n')}>
      {refs.map((label) => (
        <RefPill key={`${label.kind}:${label.label}`} label={label} t={t} />
      ))}
    </span>
  )
}

function RefPill({ label, t }: { label: RefLabel; t: Translate }) {
  return (
    <span className={`ref-pill ref-pill-${label.kind}${label.isHead ? ' is-head' : ''}`}>
      {label.isHead && <span className="ref-icon">✓</span>}
      {label.kind === 'tag' && <span className="ref-icon">◆</span>}
      <span className="ref-name">{label.label}</span>
      {label.local && <LocalIcon t={t} />}
      {label.remote && <RemoteIcon t={t} />}
    </span>
  )
}

function Message({ node }: { node: GraphNode }) {
  if (node.kind === 'wip') {
    const { added, modified, deleted, conflicted } = node.changes
    return (
      <span className="message">
        <span className="wip-label">// WIP</span>
        {modified > 0 && <Count kind="modified" value={modified} />}
        {added > 0 && <Count kind="added" value={added} />}
        {deleted > 0 && <Count kind="deleted" value={deleted} />}
        {conflicted > 0 && <Count kind="conflicted" value={conflicted} />}
      </span>
    )
  }
  if (node.kind === 'stash') {
    return (
      <span className="message message-stash">
        <span className="stash-tag">{node.stash.ref}</span>
        {node.stash.message}
      </span>
    )
  }
  const summary = firstLine(node.commit.body)
  return (
    <span className="message">
      <span className="subject">{node.commit.subject}</span>
      {summary && <span className="body-summary">{summary}</span>}
    </span>
  )
}

function Count({ kind, value }: { kind: 'modified' | 'added' | 'deleted' | 'conflicted'; value: number }) {
  return (
    <span className={`count-chip chip-${kind}`}>
      <ChangeIcon kind={kind} />
      {value}
    </span>
  )
}

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

const fullMessage = (node: GraphNode): string | undefined => {
  if (node.kind === 'commit') return [node.commit.subject, node.commit.body].filter(Boolean).join('\n\n')
  if (node.kind === 'stash') return node.stash.message
  return undefined
}

const nodeTime = (node: GraphNode): number | null =>
  node.kind === 'commit' ? node.commit.authorTime : node.kind === 'stash' ? node.stash.time : null


function LocalIcon({ t }: { t: Translate }) {
  return (
    <svg className="ref-svg" viewBox="0 0 16 16" aria-label={t('graph.localBranch')}>
      <title>{t('graph.localBranch')}</title>
      <path d="M3 3.5h10v7H3z M1.5 12.5h13" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function RemoteIcon({ t }: { t: Translate }) {
  return (
    <svg className="ref-svg" viewBox="0 0 16 16" aria-label={t('graph.onRemote')}>
      <title>{t('graph.onRemote')}</title>
      <path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.6 1A2.5 2.5 0 0 0 4.5 12.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
