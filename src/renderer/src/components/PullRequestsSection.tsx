import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import type { PullRequest } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Icon } from '../icons'

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; list: PullRequest[] }

interface Props {
  repo: string
  /** Changes when the list should be fetched again (a pull request was created). */
  version: number
  onMenu: (pr: PullRequest, event: MouseEvent) => void
  onCreate: () => void
}

/** Open GitHub pull requests. Loaded on request, because it is a network call that needs a connected profile. */
export function PullRequestsSection({ repo, version, onMenu, onCreate }: Props) {
  const t = useT()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [asked, setAsked] = useState(false)

  const load = useCallback((): void => {
    setAsked(true)
    setState({ kind: 'loading' })
    api()
      .getPullRequests(repo)
      .then(unwrap)
      .then((list) => setState({ kind: 'ready', list }))
      .catch((error) => setState({ kind: 'error', message: errorMessage(error) }))
  }, [repo])

  // A new repository starts empty; after the first load the list follows `version`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` only triggers the reload
  useEffect(() => {
    if (asked) load()
  }, [version])
  useEffect(() => {
    setAsked(false)
    setState({ kind: 'idle' })
  }, [repo])

  return (
    <>
      <h3 className="sidebar-heading">
        <Icon name="merge" size={14} />
        {t('pr.heading', { count: state.kind === 'ready' ? state.list.length : 0 })}
        <button type="button" className="sidebar-add" onClick={load} title={t('pr.refresh')} aria-label={t('pr.refresh')}>
          <Icon name="fetch" size={14} />
        </button>
        <button type="button" className="sidebar-add" onClick={onCreate} title={t('pr.create')} aria-label={t('pr.create')}>
          <Icon name="stage" size={14} />
        </button>
      </h3>
      <ul className="sidebar-list">
        {state.kind === 'idle' && (
          <li className="sidebar-empty">
            <button type="button" className="link" onClick={load}>
              {t('pr.load')}
            </button>
          </li>
        )}
        {state.kind === 'loading' && <li className="sidebar-empty">{t('pr.loading')}</li>}
        {state.kind === 'error' && <li className="sidebar-empty error">{state.message}</li>}
        {state.kind === 'ready' && state.list.length === 0 && <li className="sidebar-empty">{t('pr.none')}</li>}
        {state.kind === 'ready' &&
          state.list.map((pr) => (
            <li key={pr.number} className="sidebar-item" onContextMenu={(event) => onMenu(pr, event)} title={`#${pr.number} ${pr.title}\n${pr.head} → ${pr.base} · ${pr.author}\n${t('sidebar.rightClickActions')}`}>
              <span className="item-name">
                #{pr.number} {pr.title}
              </span>
              {pr.draft && <span className="count">{t('pr.draft')}</span>}
            </li>
          ))}
      </ul>
    </>
  )
}
