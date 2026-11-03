import { useEffect, useMemo, useState } from 'react'
import {
  buildResolution,
  hasConflictMarkers,
  linesOf,
  parseConflictMarkers,
  selectedLines,
  type BlockChoice,
  type ConflictChoice,
  type ConflictSegment
} from '../../../shared/conflict-markers'
import type { ConflictDetail, ConflictSide } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import type { RepositoryController } from '../hooks/useRepository'
import { useT, useTCount, type Translate } from '../i18n'
import { useConfirm } from './ConfirmDialog'
import { Icon, type IconName } from '../icons'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; detail: ConflictDetail }

interface Props {
  repo: string
  path: string
  controller: RepositoryController
  /** Other files still in conflict, in list order. */
  others: readonly string[]
  onOpenNext: (path: string) => void
  onClose: () => void
}

export function ConflictView({ repo, path, controller, others, onOpenNext, onClose }: Props) {
  const t = useT()
  const tCount = useTCount()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    api()
      .readConflict(repo, path)
      .then(unwrap)
      .then((detail) => !cancelled && setState({ kind: 'ready', detail }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, path])

  const finish = async (resolve: () => ReturnType<ReturnType<typeof api>['resolveConflict']>): Promise<void> => {
    const result = await controller.run(t('conflict.resolving'), resolve)
    if (!result.ok) return
    const next = others[0]
    if (next !== undefined) {
      onOpenNext(next)
    } else {
      controller.setNotice(t('conflict.allResolved'))
      onClose()
    }
  }
  const takeSide = (side: ConflictSide): Promise<void> =>
    finish(() => api().resolveConflictWithSide(repo, path, side))
  const save = (content: string): Promise<void> => finish(() => api().resolveConflict(repo, path, content))

  return (
    <section className="conflict-view">
      <header className="view-header">
        <span className="view-title">
          {t('conflict.title', { path })}
          {others.length > 0 && <span className="muted"> · {tCount('conflict.moreFiles', others.length)}</span>}
        </span>
        <span className="heading-actions">
          <button type="button" className="ghost" onClick={() => void takeSide('ours')}>
            <Icon name="commit" size={14} />{t('conflict.takeCurrentFile')}
          </button>
          <button type="button" className="ghost" onClick={() => void takeSide('theirs')}>
            <Icon name="merge" size={14} />{t('conflict.takeIncomingFile')}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            <Icon name="close" size={14} />{t('common.close')}
          </button>
        </span>
      </header>
      {state.kind === 'loading' && <p className="hint">{t('conflict.loading')}</p>}
      {state.kind === 'error' && <p className="error">{state.message}</p>}
      {state.kind === 'ready' && <ConflictEditor detail={state.detail} onSave={save} t={t} tCount={tCount} />}
    </section>
  )
}

const CHOICES: ReadonlyArray<
  [ConflictChoice, 'conflict.useCurrent' | 'conflict.useIncoming' | 'conflict.bothCurrentFirst' | 'conflict.bothIncomingFirst', IconName]
> = [
  ['ours', 'conflict.useCurrent', 'commit'],
  ['theirs', 'conflict.useIncoming', 'merge'],
  ['both-ours-first', 'conflict.bothCurrentFirst', 'both'],
  ['both-theirs-first', 'conflict.bothIncomingFirst', 'both']
]

function ConflictEditor({ detail, onSave, t, tCount }: { detail: ConflictDetail; onSave: (content: string) => Promise<void>; t: Translate; tCount: (base: string, count: number) => string }) {
  const confirm = useConfirm()
  const segments = useMemo(() => parseConflictMarkers(detail.working ?? ''), [detail.working])
  const blocks = segments.filter((segment): segment is ConflictSegment => segment.kind === 'conflict')
  const [choices, setChoices] = useState<Array<BlockChoice | null>>(() => blocks.map(() => null))
  const [result, setResult] = useState(detail.working ?? '')
  const [edited, setEdited] = useState(false)

  const built = buildResolution(segments, choices)
  const resolvedCount = choices.filter((choice) => choice !== null).length
  // Follow the choices until the user edits the result by hand.
  useEffect(() => {
    if (!edited && built !== null) setResult(built)
  }, [built, edited])

  if (detail.binary || detail.working === null) {
    return (
      <p className="hint">
        {detail.binary ? t('conflict.binaryFile') : t('conflict.deletedOnOneSide', { kind: detail.kind })} {t('conflict.takeFileHelp')}
      </p>
    )
  }

  /** Toggle one line of one side; the block becomes a hand-picked mix. */
  const toggleLine = (block: ConflictSegment, side: 'ours' | 'theirs', line: number): void => {
    setEdited(false)
    setChoices((current) =>
      current.map((value, i) => {
        if (i !== block.index) return value
        const picked = selectedLines(block, value)
        const flags = [...picked[side]]
        flags[line] = !flags[line]
        return { kind: 'lines', ours: picked.ours, theirs: picked.theirs, theirsFirst: picked.theirsFirst, [side]: flags }
      })
    )
  }

  /** Which side's lines come first in a hand-picked block. */
  const setOrder = (block: ConflictSegment, theirsFirst: boolean): void => {
    setEdited(false)
    setChoices((current) =>
      current.map((value, i) => (i === block.index ? { kind: 'lines', ...selectedLines(block, value), theirsFirst } : value))
    )
  }

  const choose = (index: number, choice: ConflictChoice): void => {
    setEdited(false)
    setChoices((current) => current.map((value, i) => (i === index ? choice : value)))
  }

  const save = async (): Promise<void> => {
    if (hasConflictMarkers(result) && !(await confirm(t('conflict.saveMarkersConfirm'), { danger: true }))) return
    void onSave(result)
  }

  const chooseAll = (choice: ConflictChoice): void => {
    setEdited(false)
    setChoices(blocks.map(() => choice))
  }

  return (
    <div className="conflict-body">
      <div className="conflict-blocks">
        {blocks.length > 0 && (
          <div className="conflict-progress" role="status">
            <span>{t('conflict.progress', { done: resolvedCount, total: blocks.length })}</span>
            <button
              type="button"
              className="ghost"
              disabled={resolvedCount === blocks.length}
              onClick={() => {
                const next = choices.findIndex((choice) => choice === null)
                document.getElementById(`conflict-block-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }}
            >
              {t('conflict.nextUnresolved')}
            </button>
          </div>
        )}
        {blocks.length > 1 && (
          <div className="conflict-all">
            <span className="muted">{tCount('conflict.allCount', blocks.length)}</span>
            <button type="button" className="ghost" onClick={() => chooseAll('ours')}>
              <Icon name="commit" size={14} />{t('conflict.allCurrent')}
            </button>
            <button type="button" className="ghost" onClick={() => chooseAll('theirs')}>
              <Icon name="merge" size={14} />{t('conflict.allIncoming')}
            </button>
            <span className="muted">{t('conflict.reviewThenSave')}</span>
          </div>
        )}
        {blocks.length === 0 && <p className="hint">{t('conflict.noMarkers')}</p>}
        {blocks.length > 0 && <p className="muted">{t('conflict.lineHelp')}</p>}
        {blocks.map((block) => (
          <div key={block.index} id={`conflict-block-${block.index}`} className={`conflict-block${choices[block.index] ? ' is-resolved' : ''}`}>
            <div className="conflict-block-title">
              {t('conflict.count', { current: block.index + 1, total: blocks.length })}
            </div>
            <div className="conflict-sides">
              {(['ours', 'theirs'] as const).map((side) => {
                const picked = selectedLines(block, choices[block.index] ?? null)
                const lines = linesOf(block[side])
                const label =
                  side === 'ours'
                    ? `${t('conflict.current')} · ${block.oursLabel || 'HEAD'}`
                    : `${t('conflict.incoming')} · ${block.theirsLabel || t('conflict.incomingFallback')}`
                return (
                  <div key={side} className={`conflict-side side-${side}${picked[side].some(Boolean) ? ' chosen' : ''}`}>
                    <div className="side-label">{label}</div>
                    {lines.length === 0 && <pre className="conflict-empty">{t('conflict.empty')}</pre>}
                    {lines.map((line, n) => (
                      <label key={n} className={`conflict-line${picked[side][n] ? ' is-kept' : ''}`}>
                        <input
                          type="checkbox"
                          checked={picked[side][n] ?? false}
                          onChange={() => toggleLine(block, side, n)}
                          aria-label={t('conflict.keepLine', { side: label, line: n + 1 })}
                        />
                        <code>{line.replace(/\r?\n$/, '') || ' '}</code>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
            {typeof choices[block.index] === 'object' && (
              <div className="conflict-order muted">
                {t('conflict.order')}
                <button type="button" className="ghost" onClick={() => setOrder(block, false)} aria-pressed={!(choices[block.index] as { theirsFirst: boolean }).theirsFirst}>
                  {t('conflict.currentFirst')}
                </button>
                <button type="button" className="ghost" onClick={() => setOrder(block, true)} aria-pressed={(choices[block.index] as { theirsFirst: boolean }).theirsFirst}>
                  {t('conflict.incomingFirst')}
                </button>
              </div>
            )}
            {block.base !== null && (
              <details className="conflict-base">
                <summary>{t('conflict.base')}</summary>
                <pre>{block.base || t('conflict.empty')}</pre>
              </details>
            )}
            <div className="button-row">
              {CHOICES.map(([choice, label, icon]) => (
                <button
                  key={choice}
                  type="button"
                  className={choices[block.index] === choice ? 'active' : 'ghost'}
                  onClick={() => choose(block.index, choice)}
                >
                  <Icon name={icon} size={14} />
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="conflict-result">
        <div className="side-label">
          {edited ? t('conflict.resultEdited') : built === null ? t('conflict.resultChoose') : t('conflict.result')}
        </div>
        <textarea
          spellCheck={false}
          value={result}
          onChange={(event) => {
            setEdited(true)
            setResult(event.target.value)
          }}
        />
        <div className="button-row">
          <button type="button" onClick={save}>
            <Icon name="save" size={14} />{t('conflict.saveResolved')}
          </button>
        </div>
      </div>
    </div>
  )
}
