import { useEffect, useState } from 'react'
import type { RecentRepo } from '../../../shared/api'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Icon } from '../icons'
import { CloneDialog } from './CloneDialog'
import { SettingsDialog } from './SettingsDialog'
import { Toolbar } from './Toolbar'

interface Props {
  /** Re-reads the recent list each time the page is shown. */
  active: boolean
  onOpenDialog: () => void
  onOpenRecent: (path: string) => void
  /** Clone (folder dialog included) and show the result in this tab. */
  onClone: (url: string, profileId: string | null) => Promise<void>
}

/** An empty tab: open a repository, or pick one opened before. */
export function NewTabPage({ active, onOpenDialog, onOpenRecent, onClone }: Props) {
  const t = useT()
  const [recent, setRecent] = useState<RecentRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    api()
      .getRecentRepos()
      .then(unwrap)
      .then((repos) => !cancelled && setRecent(repos))
      .catch((failure) => !cancelled && setError(errorMessage(failure)))
    return () => {
      cancelled = true
    }
  }, [active])

  return (
    <div className="app">
      <Toolbar {...noRepoToolbar(onOpenDialog, () => setSettingsOpen(true))} />
      <section className="new-tab">
        <p className="hint">{t('app.openRepository')}</p>
        <button type="button" onClick={onOpenDialog}>
          <Icon name="open" size={15} />
          {t('toolbar.open')}
        </button>
        <button type="button" className="ghost" onClick={() => setCloneOpen(true)}>
          <Icon name="download" size={15} />
          {t('clone.button')}
        </button>
        <h2 className="new-tab-heading">{t('tabs.recent')}</h2>
        {error && <p className="error">{error}</p>}
        {recent !== null && recent.length === 0 && <p className="muted">{t('tabs.noRecent')}</p>}
        {recent !== null && recent.length > 0 && (
          <ul className="recent-list">
            {recent.map((repo) => (
              <li key={repo.path}>
                <button type="button" className="recent-repo" onClick={() => onOpenRecent(repo.path)} title={repo.path}>
                  <Icon name="branch" size={14} />
                  <span className="recent-name">{repo.name}</span>
                  <span className="recent-path mono">{repo.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {cloneOpen && <CloneDialog onClone={onClone} onClose={() => setCloneOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

const noop = (): void => undefined
const noRepoToolbar = (onOpen: () => void, onSettings: () => void) => ({
  repo: null,
  status: null,
  busy: null,
  stashCount: 0,
  onOpen,
  onFetch: noop,
  onPull: noop,
  onPush: noop,
  onBranch: noop,
  onGitflow: noop,
  onPushMenu: noop,
  onStash: noop,
  onPop: noop,
  onProfiles: noop,
  terminalOpen: false,
  onTerminal: noop,
  onSettings
})
