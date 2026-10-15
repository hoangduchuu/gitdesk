import { useEffect, useMemo, useState } from 'react'
import {
  buildResolution,
  hasConflictMarkers,
  parseConflictMarkers,
  type ConflictChoice,
  type ConflictSegment
} from '../../../shared/conflict-markers'
import type { ConflictDetail, ConflictSide } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import type { RepositoryController } from '../hooks/useRepository'
import { useT, useTCount, type Translate } from '../i18n'
import { Icon, type IconName } from '../icons'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; detail: ConflictDetail }

interface Props {
  repo: string
  path: string
  controller: RepositoryController
  onClose: () => void
}

export function ConflictView({ repo, path, controller, onClose }: Props) {
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
    if (result.ok) onClose()
  }
  const takeSide = (side: ConflictSide): Promise<void> =>
    finish(() => api().resolveConflictWithSide(repo, path, side))
  const save = (content: string): Promise<void> => finish(() => api().resolveConflict(repo, path, content))

  return (
    <section className="conflict-view">
      <header className="view-header">
        <span className="view-title">{t('conflict.title', { path })}</span>
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
  const segments = useMemo(() => parseConflictMarkers(detail.working ?? ''), [detail.working])
  const blocks = segments.filter((segment): segment is ConflictSegment => segment.kind === 'conflict')
  const [choices, setChoices] = useState<Array<ConflictChoice | null>>(() => blocks.map(() => null))
  const [result, setResult] = useState(detail.working ?? '')
  const [edited, setEdited] = useState(false)

  const built = buildResolution(segments, choices)
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

  const choose = (index: number, choice: ConflictChoice): void => {
    setEdited(false)
    setChoices((current) => current.map((value, i) => (i === index ? choice : value)))
  }

  const save = (): void => {
    if (hasConflictMarkers(result) && !window.confirm(t('conflict.saveMarkersConfirm'))) return
    void onSave(result)
  }

  const chooseAll = (choice: ConflictChoice): void => {
    setEdited(false)
    setChoices(blocks.map(() => choice))
  }

  return (
    <div className="conflict-body">
      <div className="conflict-blocks">
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
        {blocks.map((block) => (
          <div key={block.index} className="conflict-block">
            <div className="conflict-block-title">
              {t('conflict.count', { current: block.index + 1, total: blocks.length })}
            </div>
            <div className="conflict-sides">
              <div className={`conflict-side side-ours${choices[block.index]?.includes('ours') ? ' chosen' : ''}`}>
                <div className="side-label">{t('conflict.current')} · {block.oursLabel || 'HEAD'}</div>
                <pre>{block.ours || t('conflict.empty')}</pre>
              </div>
              <div className={`conflict-side side-theirs${choices[block.index]?.includes('theirs') ? ' chosen' : ''}`}>
                <div className="side-label">{t('conflict.incoming')} · {block.theirsLabel || t('conflict.incomingFallback')}</div>
                <pre>{block.theirs || t('conflict.empty')}</pre>
              </div>
            </div>
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
