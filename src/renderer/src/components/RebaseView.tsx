import { useEffect, useState } from 'react'
import type { RebaseAction, RebaseStep } from '../../../shared/model'
import type { Commit } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Icon } from '../icons'

interface Row {
  commit: Commit
  action: RebaseAction
  message: string
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

interface Props {
  repo: string
  base: string
  /** Runs the rebase; resolves true when it finished or stopped on conflicts. */
  onStart: (steps: RebaseStep[]) => Promise<boolean>
  onClose: () => void
}

/**
 * Rows are shown newest first, like the graph. Squash and fixup meld a commit into the
 * row below it (the older one); the plan sent to git is oldest first.
 */
export function RebaseView({ repo, base, onStart, onClose }: Props) {
  const t = useT()
  const actionLabels: ReadonlyArray<[RebaseAction, 'rebase.pick' | 'rebase.reword' | 'rebase.squash' | 'rebase.fixup' | 'rebase.drop']> = [
    ['pick', 'rebase.pick'], ['reword', 'rebase.reword'], ['squash', 'rebase.squash'], ['fixup', 'rebase.fixup'], ['drop', 'rebase.drop']
  ]
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    let cancelled = false
    api()
      .getRebaseCommits(repo, base)
      .then(unwrap)
      .then((commits) => {
        if (cancelled) return
        setRows([...commits].reverse().map((commit) => ({ commit, action: 'pick', message: commit.subject })))
        setState({ kind: 'ready' })
      })
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, base])

  const update = (index: number, change: Partial<Row>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))

  const move = (index: number, offset: -1 | 1): void =>
    setRows((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })

  const oldestKept = [...rows].reverse().find((row) => row.action !== 'drop')
  const problem =
    oldestKept && (oldestKept.action === 'squash' || oldestKept.action === 'fixup')
      ? t('rebase.oldestSquashProblem')
      : rows.some((row) => row.action === 'reword' && row.message.trim() === '')
        ? t('rebase.rewordProblem')
        : null

  const start = async (): Promise<void> => {
    const steps = [...rows].reverse().map(
      (row): RebaseStep =>
        row.action === 'reword'
          ? { hash: row.commit.hash, action: 'reword', message: row.message }
          : { hash: row.commit.hash, action: row.action }
    )
    if (await onStart(steps)) onClose()
  }

  return (
    <section className="rebase-view">
      <header className="view-header">
        <span className="view-title">{t('rebase.title', { base: base.slice(0, 7) })}</span>
        <span className="heading-actions">
          <button type="button" className="ghost" onClick={onClose}>
            <Icon name="close" size={14} />{t('common.cancel')}
          </button>
          <button type="button" disabled={state.kind !== 'ready' || problem !== null} onClick={() => void start()}>
            <Icon name="continue" size={14} />{t('rebase.start')}
          </button>
        </span>
      </header>
      {state.kind === 'loading' && <p className="hint">{t('rebase.loading')}</p>}
      {state.kind === 'error' && <p className="error">{state.message}</p>}
      {state.kind === 'ready' && (
        <div className="rebase-body">
          {problem && <p className="rebase-problem">{problem}</p>}
          <ol className="rebase-list">
            {rows.map((row, index) => (
              <li key={row.commit.hash} className={`rebase-row action-${row.action}`}>
                <select
                  value={row.action}
                  aria-label={t('rebase.actionFor', { subject: row.commit.subject })}
                  onChange={(event) => update(index, { action: event.target.value as RebaseAction })}
                >
                  {actionLabels.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
                <span className="mono muted">{row.commit.hash.slice(0, 7)}</span>
                {row.action === 'reword' ? (
                  <input
                    className="rebase-message"
                    value={row.message}
                    onChange={(event) => update(index, { message: event.target.value })}
                  />
                ) : (
                  <span className="rebase-subject">{row.commit.subject}</span>
                )}
                <span className="rebase-move">
                  <button type="button" className="link" disabled={index === 0} onClick={() => move(index, -1)} title={t('rebase.moveUp')}>
                    <Icon name="up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    title={t('rebase.moveDown')}
                  >
                    <Icon name="down" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <p className="muted rebase-help">
            {t('rebase.help')}
          </p>
        </div>
      )}
    </section>
  )
}
