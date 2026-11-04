import { useState, type MouseEvent } from 'react'
import type { BranchDrop } from '../branchDrag'
import { keyboardActivatable } from '../a11y'
import { useBranchDnd } from '../branchDrag'
import type { Branch, PullRequest, Remote, Stash, Submodule, Tag, Worktree } from '../../../shared/model'
import { PullRequestsSection } from './PullRequestsSection'
import { SidebarSection } from './SidebarSection'
import { maskUrl } from '../../../shared/remote-url'
import { useT } from '../i18n'
import { Icon } from '../icons'

interface Props {
  branches: readonly Branch[]
  stashes: readonly Stash[]
  tags: readonly Tag[]
  remotes: readonly Remote[]
  selectedStash: string | null
  onSelectBranch: (branch: Branch) => void
  onCheckout: (branch: Branch) => void
  onSelectStash: (stash: Stash) => void
  onSelectTag: (tag: Tag) => void
  onBranchMenu: (branch: Branch, event: MouseEvent) => void
  onTagMenu: (tag: Tag, event: MouseEvent) => void
  onStashMenu: (stash: Stash, event: MouseEvent) => void
  /** A branch was dropped on another: ask what to do (merge, rebase). */
  onBranchDrop: BranchDrop
  onRemoteMenu: (remote: Remote, event: MouseEvent) => void
  onAddRemote: () => void
  /** The repository has no remote: offer to create one. */
  onPublish: () => void
  /** Some remote is on github.com, so pull requests are available. */
  github: boolean
  repo: string
  /** Changes when the pull request list should be fetched again. */
  prVersion: number
  onPullRequestMenu: (pr: PullRequest, event: MouseEvent) => void
  onCreatePullRequest: () => void
  worktrees: readonly Worktree[]
  /** Path of the working tree shown in this tab. */
  currentPath: string
  onWorktreeMenu: (worktree: Worktree, event: MouseEvent) => void
  onOpenWorktree: (worktree: Worktree) => void
  onAddWorktree: () => void
  submodules: readonly Submodule[]
  onSubmoduleMenu: (submodule: Submodule, event: MouseEvent) => void
  onOpenSubmodule: (submodule: Submodule) => void
  onUpdateSubmodules: () => void
}

export function Sidebar(props: Props) {
  const t = useT()
  const { branches, stashes, tags, remotes, selectedStash, onSelectBranch, onCheckout, onSelectStash } = props
  const { onSelectTag, onBranchMenu, onTagMenu, onStashMenu, onBranchDrop, onRemoteMenu, onAddRemote, onPublish } = props
  const { github, repo, prVersion, onPullRequestMenu, onCreatePullRequest } = props
  const { worktrees, currentPath, onWorktreeMenu, onOpenWorktree, onAddWorktree } = props
  const { submodules, onSubmoduleMenu, onOpenSubmodule, onUpdateSubmodules } = props
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle)
  const local = branches.filter((branch) => branch.kind === 'local' && matches(branch.name))
  const remote = branches.filter((branch) => branch.kind === 'remote' && matches(branch.name))
  const visibleRemotes = remotes.filter((item) => matches(item.name))
  const visibleTags = tags.filter((tag) => matches(tag.name))
  const visibleStashes = stashes.filter((stash) => matches(stash.message))

  return (
    <nav className="sidebar" aria-label={t('sidebar.label')}>
      <input
        type="search"
        className="sidebar-filter"
        placeholder={t('sidebar.filter')}
        aria-label={t('sidebar.filter')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
      />
      <SidebarSection id="local" icon="local" title={t('sidebar.local', { count: local.length })} forceOpen={needle !== ''}>
        {local.map((branch) => (
          <BranchItem
            key={branch.name}
            branch={branch}
            title={t('sidebar.checkoutHint')}
            onSelect={onSelectBranch}
            onCheckout={onCheckout}
            onMenu={onBranchMenu}
            onDrop={onBranchDrop}
          />
        ))}
      </SidebarSection>

      <SidebarSection id="remoteBranches" icon="remote" title={t('sidebar.remote', { count: remote.length })} forceOpen={needle !== ''}>
        {remote.length === 0 && <li className="sidebar-empty">{t('sidebar.noRemoteBranches')}</li>}
        {remote.map((branch) => (
          <BranchItem
            key={branch.name}
            branch={branch}
            title={t('sidebar.checkoutLocalHint')}
            onSelect={onSelectBranch}
            onCheckout={onCheckout}
            onMenu={onBranchMenu}
            onDrop={onBranchDrop}
          />
        ))}
      </SidebarSection>

      <SidebarSection
        id="remotes"
        icon="link"
        title={t('sidebar.remotes', { count: remotes.length })}
        forceOpen={needle !== ''}
        actions={
          <button type="button" className="sidebar-add" onClick={onAddRemote} title={t('sidebar.addRemote')} aria-label={t('sidebar.addRemote')}>
            <Icon name="stage" size={14} />
          </button>
        }
      >
        {remotes.length === 0 && (
          <li className="sidebar-empty">
            <button type="button" className="link" onClick={onPublish}>
              {t('sidebar.publish')}
            </button>
          </li>
        )}
        {visibleRemotes.map((remote) => (
          <li key={remote.name} className="sidebar-item" onContextMenu={(event) => onRemoteMenu(remote, event)} title={`${maskUrl(remote.fetchUrl)}\n${t('sidebar.rightClickActions')}`}>
            <span className="item-name">{remote.name}</span>
            <span className="count remote-url">{maskUrl(remote.fetchUrl)}</span>
          </li>
        ))}
      </SidebarSection>

      <SidebarSection
        id="worktrees"
        icon="open"
        title={t('worktree.heading', { count: worktrees.length })}
        forceOpen={needle !== ''}
        actions={
          <button type="button" className="sidebar-add" onClick={onAddWorktree} title={t('worktree.new')} aria-label={t('worktree.new')}>
            <Icon name="stage" size={14} />
          </button>
        }
      >
        {worktrees.filter((worktree) => matches(worktree.branch ?? worktree.path)).map((worktree) => (
          <li
            key={worktree.path}
            className={`sidebar-item${worktree.path === currentPath ? ' current' : ''}`}
            onContextMenu={(event) => onWorktreeMenu(worktree, event)}
            onDoubleClick={() => worktree.path !== currentPath && !worktree.prunable && onOpenWorktree(worktree)}
            title={`${worktree.path}\n${t('sidebar.rightClickActions')}`}
          >
            <span className="item-name">{worktree.branch ?? t('toolbar.detachedHead')}</span>
            <span className="count remote-url">{worktree.prunable ? t('worktree.missing') : worktree.main ? t('worktree.main') : worktree.path.slice(worktree.path.lastIndexOf('/') + 1)}</span>
          </li>
        ))}
      </SidebarSection>

      {submodules.length > 0 && (
        <SidebarSection
          id="submodules"
          icon="link"
          title={t('submodule.heading', { count: submodules.length })}
          forceOpen={needle !== ''}
          actions={
            <button type="button" className="sidebar-add" onClick={onUpdateSubmodules} title={t('submodule.updateAll')} aria-label={t('submodule.updateAll')}>
              <Icon name="download" size={14} />
            </button>
          }
        >
            {submodules.filter((submodule) => matches(submodule.path)).map((submodule) => (
              <li
                key={submodule.path}
                className="sidebar-item"
                onContextMenu={(event) => onSubmoduleMenu(submodule, event)}
                onDoubleClick={() => submodule.state !== 'uninitialized' && onOpenSubmodule(submodule)}
                title={`${submodule.path}${submodule.url ? `\n${maskUrl(submodule.url)}` : ''}\n${t('sidebar.rightClickActions')}`}
              >
                <span className="item-name">{submodule.path}</span>
                <span className="count remote-url">
                  {submodule.state === 'uninitialized'
                    ? t('submodule.notCloned')
                    : submodule.state === 'conflicted'
                      ? t('submodule.conflict')
                      : [submodule.state === 'modified' ? t('submodule.newCommits') : '', submodule.dirty ? t('submodule.dirty') : ''].filter(Boolean).join(', ')}
                </span>
              </li>
            ))}
        </SidebarSection>
      )}

      {github && <PullRequestsSection forceOpen={needle !== ''} repo={repo} version={prVersion} onMenu={onPullRequestMenu} onCreate={onCreatePullRequest} />}

      <SidebarSection id="tags" icon="tag" title={t('sidebar.tags', { count: tags.length })} forceOpen={needle !== ''}>
        {tags.length === 0 && <li className="sidebar-empty">{t('sidebar.noTags')}</li>}
        {visibleTags.map((tag) => (
          <li
            key={tag.name}
            className="sidebar-item"
            {...keyboardActivatable(() => onSelectTag(tag))}
            onClick={() => onSelectTag(tag)}
            onContextMenu={(event) => onTagMenu(tag, event)}
            title={tag.message ?? t('sidebar.rightClickActions')}
          >
            <span className="item-name">{tag.name}</span>
            {tag.annotated && <span className="count">{t('sidebar.annotated')}</span>}
          </li>
        ))}
      </SidebarSection>

      <SidebarSection id="stashes" icon="stash" title={t('sidebar.stashes', { count: stashes.length })} forceOpen={needle !== ''}>
        {stashes.length === 0 && <li className="sidebar-empty">{t('sidebar.noStashes')}</li>}
        {visibleStashes.map((stash) => (
          <li
            key={stash.hash}
            className={`sidebar-item${stash.ref === selectedStash ? ' selected' : ''}`}
            {...keyboardActivatable(() => onSelectStash(stash))}
            onClick={() => onSelectStash(stash)}
            onContextMenu={(event) => onStashMenu(stash, event)}
          >
            <span className="item-name" title={stash.message}>
              {stash.message}
            </span>
            <span className="count">{stash.ref.replace('stash@', '')}</span>
          </li>
        ))}
      </SidebarSection>
    </nav>
  )
}

interface BranchItemProps {
  branch: Branch
  title: string
  onSelect: (branch: Branch) => void
  onCheckout: (branch: Branch) => void
  onMenu: (branch: Branch, event: MouseEvent) => void
  onDrop: BranchDrop
}

/** A branch in the list: click to find it in the graph, double-click to check out, drag onto another to merge or rebase. */
function BranchItem({ branch, title, onSelect, onCheckout, onMenu, onDrop }: BranchItemProps) {
  const t = useT()
  const { props, over } = useBranchDnd({ name: branch.name, kind: branch.kind }, onDrop)
  const local = branch.kind === 'local'
  return (
    <li
      {...props}
      className={`sidebar-item${local && branch.isHead ? ' head' : ''}${over ? ' drop-over' : ''}`}
      {...keyboardActivatable(() => onSelect(branch))}
      onClick={() => onSelect(branch)}
      onDoubleClick={() => onCheckout(branch)}
      onContextMenu={(event) => onMenu(branch, event)}
      title={title}
    >
      <span className="item-name">{branch.name}</span>
      {local && branch.ahead > 0 && <span className="count ahead">↑{branch.ahead}</span>}
      {local && branch.behind > 0 && <span className="count behind">↓{branch.behind}</span>}
      {local && branch.upstreamGone && <span className="count gone">{t('sidebar.gone')}</span>}
    </li>
  )
}
