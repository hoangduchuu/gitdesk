import type { WorkingTreeStatus } from '../../../shared/model'
import type { RepoInfo } from '../../../shared/types'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useT } from '../i18n'
import { Icon, type IconName } from '../icons'

interface Props {
  repo: RepoInfo | null
  status: WorkingTreeStatus | null
  busy: string | null
  stashCount: number
  onOpen: () => void
  /** Click on the repository name: list the recent repositories to switch to. */
  onRepoMenu?: (event: MouseEvent) => void
  /** Click on the branch name: list the branches to check out. */
  onBranchMenu?: (event: MouseEvent) => void
  onFetch: () => void
  onPull: () => void
  onPush: () => void
  /** Right-click on Push: Push and Force push. */
  onPushMenu: (event: MouseEvent) => void
  onBranch: () => void
  /** Opens the Git Flow menu (start and finish feature, release, hotfix). */
  onGitflow: (event: MouseEvent) => void
  onStash: () => void
  onPop: () => void
  onProfiles: () => void
  terminalOpen: boolean
  onTerminal: () => void
  onSettings: () => void
}

interface ToolProps {
  icon: IconName
  label: string
  onClick: (event: MouseEvent) => void
  onContextMenu?: (event: MouseEvent) => void
  disabled?: boolean
  active?: boolean
  /** The operation this button started is running: the icon spins. */
  loading?: boolean
  /** Small number on the icon, e.g. commits to pull. */
  badge?: number
  title?: string
}

/** GitKraken-style toolbar button: icon on top, label below. */
function Tool({ icon, label, onClick, onContextMenu, disabled, active, loading, badge, title }: ToolProps) {
  const classes = `tool${active ? ' active' : ''}${loading ? ' loading' : ''}`
  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick} onContextMenu={onContextMenu} title={title ?? label} aria-busy={loading}>
      <span className="tool-icon">
        <Icon name={loading && icon !== 'fetch' ? 'loading' : icon} size={18} />
        {badge !== undefined && badge > 0 && <span className="tool-badge">{badge}</span>}
      </span>
      <span className="tool-label">{label}</span>
    </button>
  )
}

/** Keep a short operation visible long enough to read as a spin instead of a flash. */
const MIN_LOADING_MS = 600

function useMinimumVisible(value: string | null): string | null {
  const [shown, setShown] = useState(value)
  const since = useRef(0)
  useEffect(() => {
    if (value !== null) {
      since.current = Date.now()
      setShown(value)
      return
    }
    const timer = window.setTimeout(() => setShown(null), Math.max(0, since.current + MIN_LOADING_MS - Date.now()))
    return () => window.clearTimeout(timer)
  }, [value])
  return shown
}

export function Toolbar(props: Props) {
  const t = useT()
  const { repo, status, busy, stashCount, onOpen, onFetch, onPull, onPush, onPushMenu, onBranch, onGitflow, onStash, onPop, onProfiles } = props
  const { terminalOpen, onTerminal, onSettings, onRepoMenu, onBranchMenu } = props
  const running = useMinimumVisible(busy)
  const disabled = repo === null || running !== null
  const dirty = status !== null && status.staged.length + status.unstaged.length > 0

  return (
    <header className="toolbar">
      <Tool icon="open" label={t('toolbar.open')} onClick={onOpen} disabled={busy !== null} />
      {repo && (
        <span className="repo-switchers">
          <button type="button" className="repo-title" onClick={onRepoMenu} disabled={onRepoMenu === undefined} title={t('toolbar.switchRepo')}>
            {repo.name}
            <Icon name="down" size={13} />
          </button>
          <button
            type="button"
            className="repo-title repo-branch"
            onClick={onBranchMenu}
            disabled={onBranchMenu === undefined || running !== null}
            title={t('toolbar.switchBranch')}
          >
            <Icon name="branch" size={13} />
            {status?.branch ?? t('toolbar.detachedHead')}
            <Icon name="down" size={13} />
          </button>
        </span>
      )}
      {running && (
        <span className="busy" role="status">
          <Icon name="loading" size={14} />
          {running}…
        </span>
      )}
      <span className="toolbar-actions">
        <Tool icon="fetch" label={t('toolbar.fetch')} onClick={onFetch} disabled={disabled} loading={running === t('app.fetching')} />
        <Tool icon="pull" label={t('toolbar.pull')} onClick={onPull} disabled={disabled || status?.upstream === null} title={status?.upstream === null ? t('toolbar.noUpstream') : undefined} loading={running === t('app.pulling')} badge={status?.behind} />
        <Tool
          icon="push"
          label={t('toolbar.push')}
          onClick={onPush}
          onContextMenu={onPushMenu}
          disabled={disabled}
          loading={running === t('app.pushing') || running === t('app.forcePushing') || running === t('publish.publishing')}
          badge={status?.ahead}
          title={`${t('toolbar.push')} (${t('toolbar.pushHint')})`}
        />
        <span className="toolbar-separator" />
        <Tool icon="newBranch" label={t('toolbar.branch')} onClick={onBranch} disabled={disabled} />
        <Tool icon="gitflow" label={t('gitflow.title')} onClick={onGitflow} disabled={disabled} />
        <Tool icon="stash" label={t('toolbar.stash')} onClick={onStash} disabled={disabled || !dirty} loading={running === t('action.stashing')} />
        <Tool icon="pop" label={t('toolbar.pop')} onClick={onPop} disabled={disabled || stashCount === 0} loading={running === t('action.poppingStash')} />
        <span className="toolbar-separator" />
        <Tool
          icon="terminal"
          label={t('toolbar.terminal')}
          onClick={onTerminal}
          disabled={repo === null}
          active={terminalOpen}
          title={`${t('toolbar.terminal')} (Ctrl+\`)`}
        />
        <Tool icon="profiles" label={t('toolbar.profiles')} onClick={onProfiles} disabled={repo === null} />
        <Tool icon="settings" label={t('settings.title')} onClick={onSettings} />
      </span>
      {running && <span className="toolbar-progress" role="progressbar" aria-label={`${running}…`} />}
    </header>
  )
}
