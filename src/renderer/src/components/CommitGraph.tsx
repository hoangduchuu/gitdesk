import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { GraphNode } from '../../../shared/graph-nodes'
import { ageMarkers } from '../../../shared/format'
import { groupRefs, type RefLabel } from '../../../shared/refs'
import type { SearchMode } from '../../../shared/model'
import type { Commit, GraphRow } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'
import { useBranchDnd, type BranchDrop } from '../branchDrag'
import { useGraphAvatars, type GraphPerson } from '../hooks/useGraphAvatars'
import { LINE_WIDTH_PX, useSettings } from '../hooks/useSettings'
import { localeOf, useT, type Translate } from '../i18n'
import { ChangeIcon } from './ChangeIcon'
import { laneColorFrom } from '../palettes'
import { dashedLanesPerRow, GraphCell, LANE_WIDTH, ROW_HEIGHT } from './GraphCell'

const OVERSCAN_ROWS = 10
const MIN_GRAPH_LANES = 3
const MAX_GRAPH_LANES = 16
const SEARCH_DEBOUNCE_MS = 400
const SEARCH_RESULT_LIMIT = 300

/** `local` filters the commits already loaded; the rest ask git to search the whole history. */
type SearchScope = 'local' | SearchMode
const SEARCH_SCOPES: readonly SearchScope[] = ['local', 'message', 'author', 'content', 'path']

type Remote = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; commits: Commit[] }

interface Props {
  /** The repository, to look up the authors' pictures. */
  repo: string
  rows: ReadonlyArray<GraphRow<GraphNode>>
  selectedHash: string | null
  /** Scroll this node into view when it changes. */
  revealHash: string | null
  /** Extra commits selected with Cmd/Ctrl-click (for multi-commit cherry-pick). */
  picked: ReadonlySet<string>
  onSelect: (node: GraphNode, additive: boolean) => void
  onContextMenu: (node: GraphNode, event: MouseEvent) => void
  /** A branch label was dropped on another: ask what to do (merge, rebase). */
  onBranchDrop: BranchDrop
  /** A search result older than the loaded history was chosen: show that commit's details. */
  onOpenOlder: (commit: Commit) => void
  /** Changes each time the search bar should open and take focus (Cmd/Ctrl+F). */
  searchTick: number
}

/** Virtualised list: only rows near the viewport are rendered, so large histories stay fast. */
export function CommitGraph({ repo, rows, selectedHash, revealHash, picked, onSelect, onContextMenu, onBranchDrop, onOpenOlder, searchTick }: Props) {
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

  const scrollToIndex = useCallback((index: number): void => {
    const element = viewport.current
    if (!element) return
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight
  }, [])

  // ----- search (Cmd/Ctrl+F) -----
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [hit, setHit] = useState(0)
  const [scope, setScope] = useState<SearchScope>('local')
  const [remote, setRemote] = useState<Remote>({ kind: 'idle' })
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchTick === 0) return
    setSearchOpen(true)
    searchInput.current?.focus()
    searchInput.current?.select()
  }, [searchTick])
  // Whole-history searches run in git, after a pause in typing; an answer that arrives late for old text is dropped.
  useEffect(() => {
    if (!searchOpen || scope === 'local' || query.trim() === '') {
      setRemote({ kind: 'idle' })
      return
    }
    setRemote({ kind: 'loading' })
    let stale = false
    const timer = window.setTimeout(() => {
      api()
        .searchCommits(repo, scope, query, SEARCH_RESULT_LIMIT)
        .then(unwrap)
        .then((commits) => !stale && setRemote({ kind: 'ready', commits }))
        .catch((error) => !stale && setRemote({ kind: 'error', message: errorMessage(error) }))
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      window.clearTimeout(timer)
      // Stop git too: a code-change search over a big history can run for minutes.
      void api().cancelSearch(repo)
    }
  }, [repo, scope, query, searchOpen])
  const found = useMemo(() => new Set(remote.kind === 'ready' ? remote.commits.map((commit) => commit.hash) : []), [remote])
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!searchOpen || needle === '') return [] as number[]
    const result: number[] = []
    rows.forEach((row, index) => {
      if (scope === 'local' ? searchText(row.node).includes(needle) : row.node.kind === 'commit' && found.has(row.node.hash)) result.push(index)
    })
    return result
  }, [rows, query, searchOpen, scope, found])
  /** Results git found that are older than what the graph has loaded. */
  const older = useMemo(() => {
    if (remote.kind !== 'ready') return [] as Commit[]
    const loaded = new Set(rows.map((row) => row.node.hash))
    return remote.commits.filter((commit) => !loaded.has(commit.hash))
  }, [remote, rows])
  const unloaded = older.length
  const matchSet = useMemo(() => new Set(matches), [matches])
  useEffect(() => setHit(0), [query, scope, remote])
  const goToHit = (next: number): void => {
    if (matches.length === 0) return
    const wrapped = (next + matches.length) % matches.length
    setHit(wrapped)
    const index = matches[wrapped]!
    scrollToIndex(index)
    onSelect(rows[index]!.node, false)
  }
  const closeSearch = (): void => {
    setSearchOpen(false)
    setQuery('')
    setScope('local')
    viewport.current?.focus()
  }

  // ----- keyboard navigation -----
  const selectedIndex = rows.findIndex((row) => row.node.hash === selectedHash)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) return
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1)
    const moves: Record<string, number> = {
      ArrowDown: selectedIndex + 1,
      ArrowUp: selectedIndex === -1 ? 0 : selectedIndex - 1,
      PageDown: selectedIndex + page,
      PageUp: selectedIndex - page,
      Home: 0,
      End: rows.length - 1
    }
    const target = moves[event.key]
    if (target === undefined || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    const index = Math.min(rows.length - 1, Math.max(0, target))
    scrollToIndex(index)
    onSelect(rows[index]!.node, false)
  }

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

  // Pictures only for the authors on screen; nearest to the top of the view are asked first.
  const people = useMemo(() => {
    const seen = new Set<string>()
    const list: GraphPerson[] = []
    for (const row of rows.slice(first, last)) {
      if (row.node.kind !== 'commit') continue
      const email = row.node.commit.authorEmail.toLowerCase()
      if (seen.has(email)) continue
      seen.add(email)
      list.push({ email: row.node.commit.authorEmail, hash: row.node.commit.hash })
    }
    return list
  }, [rows, first, last])
  const pictures = useGraphAvatars(repo, people)

  return (
    <div className="graph" style={{ '--graph-width': `${graphWidth}px` } as CSSProperties}>
      <div className="graph-header">
        <div className="col-refs">{t('graph.branchTag')}</div>
        <div className="col-graph">{t('graph.graph')}</div>
        <div className="col-message">{t('graph.commitMessage')}</div>
      </div>
      {searchOpen && (
        <div className="graph-search" role="search">
          <select value={scope} onChange={(event) => setScope(event.target.value as SearchScope)} aria-label={t('graph.searchScope')}>
            {SEARCH_SCOPES.map((value) => (
              <option key={value} value={value}>
                {t(`graph.scope.${value}`)}
              </option>
            ))}
          </select>
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder={t(`graph.placeholder.${scope}`)}
            aria-label={t(`graph.placeholder.${scope}`)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch()
              else if (event.key === 'Enter') goToHit(hit + (event.shiftKey ? -1 : 1))
            }}
          />
          <span className="muted" aria-live="polite">
            {query.trim() === ''
              ? ''
              : remote.kind === 'loading'
                ? t('graph.searching')
                : remote.kind === 'error'
                  ? remote.message
                  : matches.length === 0
                    ? unloaded === 0
                      ? t('graph.noMatches')
                      : ''
                    : `${hit + 1}/${matches.length}`}
            {unloaded > 0 && ` ${t('graph.olderMatches', { count: unloaded })}`}
          </span>
          <button type="button" className="ghost" onClick={() => goToHit(hit - 1)} disabled={matches.length === 0} aria-label={t('graph.prevMatch')}>↑</button>
          <button type="button" className="ghost" onClick={() => goToHit(hit + 1)} disabled={matches.length === 0} aria-label={t('graph.nextMatch')}>↓</button>
          <button type="button" className="ghost" onClick={closeSearch} aria-label={t('common.close')}>✕</button>
        </div>
      )}
      {older.length > 0 && (
        <div className="graph-older" role="region" aria-label={t('graph.olderTitle')}>
          <p className="muted">{t('graph.olderTitle')}</p>
          <ul>
            {older.map((commit) => (
              <li key={commit.hash}>
                <button type="button" className={`link${commit.hash === selectedHash ? ' selected' : ''}`} onClick={() => onOpenOlder(commit)}>
                  <span className="mono">{commit.hash.slice(0, 7)}</span>
                  <span className="graph-older-subject">{commit.subject}</span>
                  <span className="muted">{commit.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        className="graph-viewport"
        ref={viewport}
        tabIndex={0}
        role="listbox"
        aria-label={t('graph.commitMessage')}
        aria-activedescendant={selectedIndex === -1 ? undefined : `graph-row-${selectedIndex}`}
        onKeyDown={onKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(first, last).map((row, i) => {
            const index = first + i
            const color = laneColor(row.column)
            const refs = row.node.kind === 'commit' ? groupRefs(row.node.commit.refs) : []
            return (
              <div
                key={row.node.hash}
                id={`graph-row-${index}`}
                role="option"
                aria-selected={row.node.hash === selectedHash}
                className={`graph-row row-${row.node.kind}${refs.length > 0 ? ' has-refs' : ''}${matchSet.has(index) ? ' search-hit' : ''}${matches[hit] === index ? ' search-current' : ''}${
                  row.node.hash === selectedHash || picked.has(row.node.hash) ? ' selected' : ''
                }`}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, '--lane-color': color } as CSSProperties}
                onClick={(event) => onSelect(row.node, event.metaKey || event.ctrlKey)}
                onContextMenu={(event) => onContextMenu(row.node, event)}
              >
                <div className="col-refs">
                  <RefLabels refs={refs} t={t} onBranchDrop={onBranchDrop} />
                </div>
                <div className="col-graph">
                  <GraphCell
                    row={row}
                    lanes={lanes}
                    dashed={dashed[index]!}
                    lineWidth={lineWidth}
                    laneColor={laneColor}
                    picture={row.node.kind === 'commit' ? pictures[row.node.commit.authorEmail.toLowerCase()] : null}
                  />
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

/** Room kept for the "+N" counter when some labels are folded. */
const MORE_WIDTH = 30

/**
 * Branch and tag labels at full width while they fit the column; the rest fold into "+N"
 * and appear when the row is hovered. Only the first label shrinks, so it is never crowded out.
 */
function RefLabels({ refs, t, onBranchDrop }: { refs: readonly RefLabel[]; t: Translate; onBranchDrop: BranchDrop }) {
  const box = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(refs.length)
  const key = refs.map((ref) => `${ref.kind}:${ref.label}`).join('\n')

  useLayoutEffect(() => {
    const element = box.current
    if (element) setShown(fittingLabels(element))
  }, [key])

  if (refs.length === 0) return null
  const folded = refs.length - shown
  return (
    <span ref={box} className={`ref-labels${folded > 0 ? ' has-folded' : ''}`} title={refs.map((ref) => ref.label).join('\n')}>
      {refs.map((label, index) => (
        <RefPill key={`${label.kind}:${label.label}`} label={label} folded={index >= shown} t={t} onBranchDrop={onBranchDrop} />
      ))}
      {folded > 0 && <span className="ref-more">+{folded}</span>}
    </span>
  )
}

/** How many labels fit side by side, leaving room for "+N" when some do not; the first always shows. */
function fittingLabels(element: HTMLElement): number {
  element.classList.add('measuring')
  const box = element.getBoundingClientRect()
  const pills = [...element.querySelectorAll<HTMLElement>('.ref-pill')]
  let count = 1
  for (let index = 1; index < pills.length; index++) {
    const right = pills[index]!.getBoundingClientRect().right - box.left
    const reserve = index < pills.length - 1 ? MORE_WIDTH : 0
    if (right + reserve > box.width) break
    count = index + 1
  }
  element.classList.remove('measuring')
  return count
}

function RefPill({ label, folded, t, onBranchDrop }: { label: RefLabel; folded: boolean; t: Translate; onBranchDrop: BranchDrop }) {
  // A label is the local branch when there is one; a remote-only label is the remote branch. Tags are not draggable.
  const { props, over } = useBranchDnd(
    { name: label.label, kind: label.local ? 'local' : 'remote' },
    label.kind === 'branch' ? onBranchDrop : undefined
  )
  return (
    <span
      {...props}
      className={`ref-pill ref-pill-${label.kind}${label.isHead ? ' is-head' : ''}${folded ? ' is-folded' : ''}${over ? ' drop-over' : ''}`}
    >
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
        <span className="wip-label">{'// WIP'}</span>
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
  if (node.kind === 'commit') {
    const { commit } = node
    const meta = `${commit.hash.slice(0, 7)} · ${commit.authorName} · ${new Date(commit.authorTime * 1000).toLocaleString()}`
    return [commit.subject, commit.body, meta].filter(Boolean).join('\n\n')
  }
  if (node.kind === 'stash') return node.stash.message
  return undefined
}

/** Lower-cased text a search looks in: message, author, hash and ref names. */
const searchText = (node: GraphNode): string => {
  if (node.kind === 'commit') {
    const { commit } = node
    return [commit.subject, commit.body, commit.authorName, commit.authorEmail, commit.hash, ...commit.refs.map((ref) => ref.name)]
      .join('\n')
      .toLowerCase()
  }
  return node.kind === 'stash' ? node.stash.message.toLowerCase() : 'wip working changes'
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
