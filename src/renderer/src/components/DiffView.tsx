import { useCallback, useEffect, useState } from 'react'
import type { SelectionRequest } from '../../../shared/api'
import { parseUnifiedDiff, type DiffHunk, type ParsedDiff } from '../../../shared/diff-parse'
import type { DiffTarget } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { highlightLine, languageFor, type Language } from '../highlight'
import { useT, useTCount, type Translate } from '../i18n'
import { Icon } from '../icons'

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

const ACTIONS: Record<StagingOptions['source'], ReadonlyArray<[SelectionRequest['action'], 'discard' | 'stage' | 'unstage']>> = {
  unstaged: [
    ['discard', 'discard'],
    ['stage', 'stage']
  ],
  staged: [['unstage', 'unstage']]
}

export function DiffView({ repo, target, title, staging, onClose }: Props) {
  const t = useT()
  const tCount = useTCount()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<Selected>(new Map())

  const load = useCallback(() => {
    let cancelled = false
    api()
      .getDiff(repo, target)
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
  }, [repo, target])

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
    if (action === 'discard' && !window.confirm(t('diff.discardConfirm'))) return
    const ok = await staging.apply({ path: target.path, source: staging.source, action, selections, expectedDiff: state.raw })
    if (ok) load()
  }

  const selectedCount = [...selected.values()].reduce((total, lines) => total + lines.size, 0)
  const selectedLines = (): SelectionRequest['selections'] =>
    [...selected.entries()].map(([hunk, lines]) => ({ hunk, lines: [...lines] }))

  return (
    <section className="diff-view">
      <header className="view-header">
        <span className="view-title">{title}</span>
        {staging && selectedCount > 0 && (
          <span className="heading-actions">
            <span className="muted">{tCount('diff.selectedLines', selectedCount)}</span>
            {ACTIONS[staging.source].map(([action, label]) => (
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
        <button type="button" className="ghost" onClick={onClose}>
          <Icon name="close" size={14} />{t('diff.close')}
        </button>
      </header>
      <div className="diff-body">
        {state.kind === 'loading' && <p className="hint">{t('diff.loading')}</p>}
        {state.kind === 'error' && <p className="error">{state.message}</p>}
        {state.kind === 'ready' && (
          <DiffTable
            diff={state.diff}
            language={languageFor(target.path)}
            staging={staging}
            selected={selected}
            onToggleLine={toggleLine}
            onHunkAction={(action, hunk) => void run(action, [{ hunk, lines: null }])}
            t={t}
          />
        )}
      </div>
      {staging && state.kind === 'ready' && state.diff.hunks.length > 0 && (
        <p className="diff-help">{t('diff.help')}</p>
      )}
    </section>
  )
}

interface TableProps {
  diff: ParsedDiff
  language: Language | null
  staging: StagingOptions | undefined
  selected: Selected
  onToggleLine: (hunk: number, line: number) => void
  onHunkAction: (action: SelectionRequest['action'], hunk: number) => void
  t: Translate
}

function DiffTable({ diff, language, staging, selected, onToggleLine, onHunkAction, t }: TableProps) {
  if (diff.binary) return <p className="hint">{t('diff.binary')}</p>
  if (diff.hunks.length === 0) return <p className="hint">{t('diff.noChanges')}</p>
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
    <tr className="diff-hunk">
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
