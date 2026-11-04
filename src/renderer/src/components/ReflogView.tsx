import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { ReflogEntry } from '../../../shared/model'
import { relativeAge } from '../../../shared/format'
import { api, errorMessage, unwrap } from '../api'
import { localeOf, useT } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { Icon } from '../icons'

const REFLOG_LIMIT = 1000

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; entries: ReflogEntry[] }

interface Props {
  repo: string
  /** Changes whenever the repository data is reloaded (after a reset, checkout...), so the list follows. */
  reloadKey: unknown
  onMenu: (entry: ReflogEntry, event: MouseEvent) => void
  onClose: () => void
}

export function ReflogView({ repo, reloadKey, onMenu, onClose }: Props) {
  const t = useT()
  const { language } = useSettings()
  const locale = localeOf(language)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const now = useMemo(() => Date.now() / 1000, [state])

  useEffect(() => {
    let cancelled = false
    api()
      .getReflog(repo, REFLOG_LIMIT)
      .then(unwrap)
      .then((entries) => !cancelled && setState({ kind: 'ready', entries }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, reloadKey])

  return (
    <section className="reflog-view">
      <header className="view-header">
        <span className="view-title">{t('reflog.title')}</span>
        <span className="heading-actions">
          <button type="button" className="ghost" onClick={onClose}>
            <Icon name="close" size={14} />{t('common.close')}
          </button>
        </span>
      </header>
      <div className="reflog-body">
        <p className="hint">{t('reflog.help')}</p>
        {state.kind === 'loading' && <p className="hint">{t('reflog.loading')}</p>}
        {state.kind === 'error' && <p className="error">{state.message}</p>}
        {state.kind === 'ready' && state.entries.length === 0 && <p className="hint">{t('reflog.empty')}</p>}
        {state.kind === 'ready' && state.entries.length > 0 && (
          <ol className="reflog-list">
            {state.entries.map((entry) => (
              <li
                key={entry.selector}
                className={`reflog-row${selected === entry.selector ? ' selected' : ''}`}
                onClick={() => setSelected(entry.selector)}
                onContextMenu={(event) => {
                  setSelected(entry.selector)
                  onMenu(entry, event)
                }}
              >
                <span className="mono muted">{entry.selector}</span>
                <span className="mono">{entry.hash.slice(0, 7)}</span>
                <span className="reflog-action">{entry.action}</span>
                <span className="muted">{relativeAge(entry.time, now, locale)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
