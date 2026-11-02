import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SelectionRequest } from '../../../shared/api'
import { parseUnifiedDiff, splitRows, type DiffHunk, type DiffLine, type ParsedDiff } from '../../../shared/diff-parse'
import type { DiffTarget } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { highlightLine, languageFor, type Language } from '../highlight'
import { useT, useTCount, type Translate } from '../i18n'
import { Icon } from '../icons'
import { viewerFor } from '../../../shared/viewers'
import { useConfirm } from './ConfirmDialog'
import { FileViewer } from './FileViewer'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; raw: string; diff: ParsedDiff }

/** Hunk/line staging for a tracked working-tree file. */
export interface StagingOptions {
  source: SelectionRequest['source']
  /** Runs the request; resolves true when it succeeded. */
  apply: (request: SelectionRequest) => Promise<boolean>
}

interface Props {
  repo: string
  target: DiffTarget
  title: string
  staging?: StagingOptions
  onClose: () => void
}

type Selected = ReadonlyMap<number, ReadonlySet<number>>
type Layout = 'unified' | 'split'

/** Diffs longer than this are cut off after a whole hunk, with a button to show the rest. */
const RENDER_LINE_CAP = 3000
const LAYOUT_KEY = 'gitdesk.diffLayout'

const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

const ACTIONS: Record<StagingOptions['source'], ReadonlyArray<[SelectionRequest['action'], 'discard' | 'stage' | 'unstage']>> = {
  unstaged: [
    ['discard', 'discard'],
    ['stage', 'stage']
  ],
  staged: [['unstage', 'unstage']]
}

export function DiffView({ repo, target, title, staging, onClose }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const tCount = useTCount()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<Selected>(new Map())
  const previewable = viewerFor(target.path) !== null
  const [preview, setPreview] = useState(true)
  const [layout, setLayout] = useState<Layout>(readLayout)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [hunkIndex, setHunkIndex] = useState(0)
  const root = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // Staging works on the exact diff git would apply, so it needs the unified, whitespace-sensitive view.
  const stagingOn = staging !== undefined && layout === 'unified' && !ignoreWhitespace

  const load = useCallback(() => {
    let cancelled = false
    api()
      .getDiff(repo, target, ignoreWhitespace)
      .then(unwrap)
      .then((raw) => {
        if (cancelled) return
        setState({ kind: 'ready', raw, diff: parseUnifiedDiff(raw) })
        setSelected(new Map())
      })
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, target, ignoreWhitespace])

  useEffect(() => {
    setState({ kind: 'loading' })
    return load()
  }, [load])

  const toggleLine = (hunk: number, line: number): void =>
    setSelected((current) => {
      const lines = new Set(current.get(hunk))
      if (lines.has(line)) lines.delete(line)
      else lines.add(line)
      const next = new Map(current)
      if (lines.size === 0) next.delete(hunk)
      else next.set(hunk, lines)
      return next
    })

  const run = async (action: SelectionRequest['action'], selections: SelectionRequest['selections']): Promise<void> => {
    if (!staging || state.kind !== 'ready' || target.kind !== 'working') return
    if (action === 'discard' && !(await confirm(t('diff.discardConfirm'), { danger: true }))) return
    const ok = await staging.apply({ path: target.path, source: staging.source, action, selections, expectedDiff: state.raw })
    if (ok) load()
  }

  const hunkCount = state.kind === 'ready' ? state.diff.hunks.length : 0
  const goToHunk = (next: number): void => {
    if (hunkCount === 0) return
    const wrapped = (next + hunkCount) % hunkCount
    setHunkIndex(wrapped)
    if (wrapped >= visibleHunks) setShowAll(true)
    requestAnimationFrame(() =>
      body.current?.querySelector(`[data-hunk="${wrapped}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
  }
  const lineTotal = useMemo(
    () => (state.kind === 'ready' ? state.diff.hunks.reduce((total, hunk) => total + hunk.lines.length, 0) : 0),
    [state]
  )
  // Whole hunks up to the cap (always at least one).
  const visibleHunks = useMemo(() => {
    if (state.kind !== 'ready' || showAll || lineTotal <= RENDER_LINE_CAP) return hunkCount
    let used = 0
    let count = 0
    for (const hunk of state.diff.hunks) {
      if (count > 0 && used + hunk.lines.length > RENDER_LINE_CAP) break
      used += hunk.lines.length
      count++
    }
    return count
  }, [state, showAll, lineTotal, hunkCount])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest('input, textarea')) return
    if (event.key === 'n' || event.key === 'j') goToHunk(hunkIndex + 1)
    else if (event.key === 'p' || event.key === 'k') goToHunk(hunkIndex - 1)
    else if (event.key === 'Escape') onClose()
    else return
    event.preventDefault()
  }
  useEffect(() => {
    if (state.kind === 'ready') root.current?.focus({ preventScroll: true })
    setHunkIndex(0)
    setShowAll(false)
  }, [state.kind === 'ready' ? state.raw : null])

  const selectedCount = [...selected.values()].reduce((total, lines) => total + lines.size, 0)
  const selectedLines = (): SelectionRequest['selections'] =>
    [...selected.entries()].map(([hunk, lines]) => ({ hunk, lines: [...lines] }))

  return (
    <section className="diff-view" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="view-header">
        <span className="view-title">{title}</span>
        {stagingOn && selectedCount > 0 && (
          <span className="heading-actions">
            <span className="muted">{tCount('diff.selectedLines', selectedCount)}</span>
            {ACTIONS[staging!.source].map(([action, label]) => (
              <button
                key={action}
                type="button"
                className={action === 'discard' ? 'ghost danger-text' : 'ghost'}
                onClick={() => void run(action, selectedLines())}
              >
                <Icon name={label} size={14} />
                {t(`diff.${label}Lines`)}
              </button>
            ))}
          </span>
        )}
        {state.kind === 'ready' && !state.diff.binary && !(previewable && preview) && (
          <span className="diff-tools">
            {hunkCount > 1 && (
              <span className="seg">
                <button type="button" className="ghost" onClick={() => goToHunk(hunkIndex - 1)} title={`${t('diff.prevHunk')} (k)`} aria-label={t('diff.prevHunk')}>↑</button>
                <span className="muted hunk-position" aria-live="polite">{hunkIndex + 1}/{hunkCount}</span>
                <button type="button" className="ghost" onClick={() => goToHunk(hunkIndex + 1)} title={`${t('diff.nextHunk')} (j)`} aria-label={t('diff.nextHunk')}>↓</button>
              </span>
            )}
            <button
              type="button"
              className={ignoreWhitespace ? 'ghost active' : 'ghost'}
              aria-pressed={ignoreWhitespace}
              title={t('diff.ignoreWhitespaceHint')}
              onClick={() => setIgnoreWhitespace((on) => !on)}
            >
              {t('diff.ignoreWhitespace')}
            </button>
            <span className="seg" role="group" aria-label={t('diff.layout')}>
              {(['unified', 'split'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={layout === value ? 'ghost active' : 'ghost'}
                  aria-pressed={layout === value}
                  onClick={() => {
                    setLayout(value)
                    try {
                      localStorage.setItem(LAYOUT_KEY, value)
                    } catch {
                      // Not remembered when storage is unavailable.
                    }
                  }}
                >
                  {t(`diff.layout.${value}`)}
                </button>
              ))}
            </span>
          </span>
        )}
        {previewable && state.kind === 'ready' && !state.diff.binary && (
          <button type="button" className="ghost" onClick={() => setPreview((p) => !p)}>
            {t(preview ? 'viewer.showDiff' : 'viewer.showPreview')}
          </button>
        )}
        <button type="button" className="ghost" onClick={onClose}>
          <Icon name="close" size={14} />{t('diff.close')}
        </button>
      </header>
      <div className="diff-body" ref={body}>
        {state.kind === 'loading' && <p className="hint">{t('diff.loading')}</p>}
        {state.kind === 'error' && <p className="error">{state.message}</p>}
        {state.kind === 'ready' && (state.diff.binary || (previewable && preview)) && (
          <FileViewer repo={repo} target={target} />
        )}
        {state.kind === 'ready' && !state.diff.binary && !(previewable && preview) && (
          <DiffTable
            diff={{ ...state.diff, hunks: state.diff.hunks.slice(0, visibleHunks) }}
            layout={layout}
            language={languageFor(target.path)}
            staging={stagingOn ? staging : undefined}
            selected={selected}
            onToggleLine={toggleLine}
            onHunkAction={(action, hunk) => void run(action, [{ hunk, lines: null }])}
            t={t}
          />
        )}
      </div>
      {state.kind === 'ready' && visibleHunks < hunkCount && !(previewable && preview) && (
        <p className="diff-help">
          <button type="button" className="link" onClick={() => setShowAll(true)}>
            {tCount('diff.showAll', lineTotal)}
          </button>
        </p>
      )}
      {stagingOn && state.kind === 'ready' && state.diff.hunks.length > 0 && (
        <p className="diff-help">{t('diff.help')}</p>
      )}
    </section>
  )
}

interface TableProps {
  diff: ParsedDiff
  layout: Layout
  language: Language | null
  staging: StagingOptions | undefined
  selected: Selected
  onToggleLine: (hunk: number, line: number) => void
  onHunkAction: (action: SelectionRequest['action'], hunk: number) => void
  t: Translate
}

function DiffTable({ diff, layout, language, staging, selected, onToggleLine, onHunkAction, t }: TableProps) {
  if (diff.binary) return <p className="hint">{t('diff.binary')}</p>
  if (diff.hunks.length === 0) return <p className="hint">{t('diff.noChanges')}</p>
  if (layout === 'split') return <SplitTable diff={diff} language={language} />
  return (
    <table className="diff-table">
      <tbody>
        {diff.hunks.map((hunk, h) => [
          ...(h > 0 ? [<tr key={`gap${h}`} className="diff-gap" aria-hidden><td colSpan={4} /></tr>] : []),
          <HunkHeader key={`h${h}`} hunk={hunk} index={h} staging={staging} onAction={onHunkAction} t={t} />,
          ...hunk.lines.map((line, l) => {
            const selectable = staging !== undefined && (line.kind === 'added' || line.kind === 'removed')
            const isSelected = selected.get(h)?.has(l) ?? false
            return (
              <tr
                key={`h${h}l${l}`}
                className={`diff-line diff-${line.kind}${selectable ? ' selectable' : ''}${isSelected ? ' line-selected' : ''}`}
                onClick={selectable ? () => onToggleLine(h, l) : undefined}
              >
                <td className="diff-no">{line.oldLine ?? ''}</td>
                <td className="diff-no">{line.newLine ?? ''}</td>
                <td className="diff-marker">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</td>
                {line.kind === 'note' ? (
                  <td className="diff-text">{line.text}</td>
                ) : (
                  // highlightLine escapes the code, so this HTML only contains highlight spans.
                  <td className="diff-text hljs" dangerouslySetInnerHTML={{ __html: highlightLine(line.text, language) || ' ' }} />
                )}
              </tr>
            )
          })
        ])}
      </tbody>
    </table>
  )
}

function HunkHeader(props: {
  hunk: DiffHunk
  index: number
  staging: StagingOptions | undefined
  onAction: (action: SelectionRequest['action'], hunk: number) => void
  t: Translate
}) {
  const { hunk, index, staging, onAction, t } = props
  return (
    <tr className="diff-hunk" data-hunk={index}>
      <td colSpan={4}>
        <span className="hunk-header">
          <span>{hunk.header}</span>
          {staging && (
            <span className="hunk-actions">
              {ACTIONS[staging.source].map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  className={action === 'discard' ? 'link danger' : 'link'}
                  onClick={() => onAction(action, index)}
                >
                <Icon name={label} size={13} />
                {t(`diff.${label}Hunk`)}
                </button>
              ))}
            </span>
          )}
        </span>
      </td>
    </tr>
  )
}

function SplitTable({ diff, language }: { diff: ParsedDiff; language: Language | null }) {
  const cell = (line: DiffLine | null, side: 'old' | 'new') => {
    const kind = line?.kind === 'added' || line?.kind === 'removed' ? ` diff-${line.kind}` : line ? '' : ' diff-empty'
    return [
      <td key="n" className={`diff-no${kind}`}>{(side === 'old' ? line?.oldLine : line?.newLine) ?? ''}</td>,
      line && line.kind !== 'note' ? (
        // highlightLine escapes the code, so this HTML only contains highlight spans.
        <td key="t" className={`diff-text hljs${kind}`} dangerouslySetInnerHTML={{ __html: highlightLine(line.text, language) || ' ' }} />
      ) : (
        <td key="t" className={`diff-text${kind}`}>{line?.text ?? ''}</td>
      )
    ]
  }
  return (
    <table className="diff-table diff-split">
      <colgroup>
        <col className="col-no" /><col className="col-code" /><col className="col-no" /><col className="col-code" />
      </colgroup>
      <tbody>
        {diff.hunks.map((hunk, h) => [
          <tr key={`h${h}`} className="diff-hunk" data-hunk={h}>
            <td colSpan={4}>{hunk.header}</td>
          </tr>,
          ...splitRows(hunk.lines).map((row, r) => (
            <tr key={`h${h}r${r}`} className="diff-line">
              {cell(row.left, 'old')}
              {cell(row.right, 'new')}
            </tr>
          ))
        ])}
      </tbody>
    </table>
  )
}
