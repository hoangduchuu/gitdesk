import { useEffect, useMemo, useState } from 'react'
import { relativeAge } from '../../../shared/format'
import type { FileHistoryEntry } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { localeOf, useT } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { Icon } from '../icons'
import { DiffView } from './DiffView'

const HISTORY_LIMIT = 500

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; entries: FileHistoryEntry[] }

interface Props {
  repo: string
  path: string
  /** Changes whenever the repository data is reloaded, so a new commit shows up. */
  reloadKey: unknown
  onReveal: (hash: string) => void
  /** Open blame for the file as it was at a commit. */
  onBlame: (path: string, rev: string) => void
  onClose: () => void
}

/** Commits that changed one file, with the selected commit's change underneath. */
export function FileHistoryView({ repo, path, reloadKey, onReveal, onBlame, onClose }: Props) {
  const t = useT()
  const { language } = useSettings()
  const locale = localeOf(language)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const now = useMemo(() => Date.now() / 1000, [state])

  useEffect(() => {
    let cancelled = false
    api()
      .getFileHistory(repo, path, HISTORY_LIMIT)
      .then(unwrap)
      .then((entries) => !cancelled && setState({ kind: 'ready', entries }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, path, reloadKey])

  const entry = state.kind === 'ready' ? state.entries.find((candidate) => candidate.commit.hash === selected) : undefined

  return (
    <section className="history-view">
      <header className="view-header">
        <span className="view-title">{t('history.title', { path })}</span>
        <span className="heading-actions">
          <button type="button" className="ghost" onClick={onClose}>
            <Icon name="close" size={14} />{t('common.close')}
          </button>
        </span>
      </header>
      <div className="history-list-wrap">
        <p className="hint">{t('history.help')}</p>
        {state.kind === 'loading' && <p className="hint">{t('history.loading')}</p>}
        {state.kind === 'error' && <p className="error">{state.message}</p>}
        {state.kind === 'ready' && state.entries.length === 0 && <p className="hint">{t('history.empty')}</p>}
        {state.kind === 'ready' && state.entries.length > 0 && (
          <ol className="history-list">
            {state.entries.map(({ commit, path: pathThen }) => (
              <li
                key={commit.hash}
                className={`history-row${commit.hash === selected ? ' selected' : ''}`}
                onClick={() => setSelected(commit.hash)}
                title={pathThen !== path ? pathThen : undefined}
              >
                <span className="mono muted">{commit.hash.slice(0, 7)}</span>
                <span className="history-subject">{commit.subject}</span>
                <span className="muted">{commit.authorName}</span>
                <span className="muted">{relativeAge(commit.authorTime, now, locale)}</span>
                <button
                  type="button"
                  className="link"
                  onClick={(event) => {
                    event.stopPropagation()
                    onReveal(commit.hash)
                  }}
                >
                  {t('history.showInGraph')}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      {entry ? (
        <DiffView
          key={entry.commit.hash}
          repo={repo}
          target={{ kind: 'commit', hash: entry.commit.hash, path: entry.path }}
          title={`${entry.path} — ${entry.commit.hash.slice(0, 7)}`}
          headerActions={
            <button type="button" className="ghost" onClick={() => onBlame(entry.path, entry.commit.hash)}>
              <Icon name="user" size={14} />{t('history.blameHere')}
            </button>
          }
          onClose={() => setSelected(null)}
        />
      ) : (
        state.kind === 'ready' && state.entries.length > 0 && <p className="hint history-pick">{t('history.pickCommit')}</p>
      )}
    </section>
  )
}
