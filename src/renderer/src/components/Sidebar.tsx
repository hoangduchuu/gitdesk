import type { MouseEvent } from 'react'
import type { BranchDrop } from '../branchDrag'
import { useBranchDnd } from '../branchDrag'
import type { Branch, Remote, Stash, Tag } from '../../../shared/model'
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
}

export function Sidebar(props: Props) {
  const t = useT()
  const { branches, stashes, tags, remotes, selectedStash, onSelectBranch, onCheckout, onSelectStash } = props
  const { onSelectTag, onBranchMenu, onTagMenu, onStashMenu, onBranchDrop, onRemoteMenu, onAddRemote, onPublish } = props
  const local = branches.filter((branch) => branch.kind === 'local')
  const remote = branches.filter((branch) => branch.kind === 'remote')

  return (
    <nav className="sidebar" aria-label={t('sidebar.label')}>
      <h3 className="sidebar-heading"><Icon name="local" size={14} />{t('sidebar.local', { count: local.length })}</h3>
      <ul className="sidebar-list">
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
      </ul>

      <h3 className="sidebar-heading"><Icon name="remote" size={14} />{t('sidebar.remote', { count: remote.length })}</h3>
      <ul className="sidebar-list">
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
      </ul>

      <h3 className="sidebar-heading">
        <Icon name="link" size={14} />
        {t('sidebar.remotes', { count: remotes.length })}
        <button type="button" className="sidebar-add" onClick={onAddRemote} title={t('sidebar.addRemote')} aria-label={t('sidebar.addRemote')}>
          <Icon name="stage" size={14} />
        </button>
      </h3>
      <ul className="sidebar-list">
        {remotes.length === 0 && (
          <li className="sidebar-empty">
            <button type="button" className="link" onClick={onPublish}>
              {t('sidebar.publish')}
            </button>
          </li>
        )}
        {remotes.map((remote) => (
          <li key={remote.name} className="sidebar-item" onContextMenu={(event) => onRemoteMenu(remote, event)} title={`${maskUrl(remote.fetchUrl)}\n${t('sidebar.rightClickActions')}`}>
            <span className="item-name">{remote.name}</span>
            <span className="count remote-url">{maskUrl(remote.fetchUrl)}</span>
          </li>
        ))}
      </ul>

      <h3 className="sidebar-heading"><Icon name="tag" size={14} />{t('sidebar.tags', { count: tags.length })}</h3>
      <ul className="sidebar-list">
        {tags.length === 0 && <li className="sidebar-empty">{t('sidebar.noTags')}</li>}
        {tags.map((tag) => (
          <li
            key={tag.name}
            className="sidebar-item"
            onClick={() => onSelectTag(tag)}
            onContextMenu={(event) => onTagMenu(tag, event)}
            title={tag.message ?? t('sidebar.rightClickActions')}
          >
            <span className="item-name">{tag.name}</span>
            {tag.annotated && <span className="count">{t('sidebar.annotated')}</span>}
          </li>
        ))}
      </ul>

      <h3 className="sidebar-heading"><Icon name="stash" size={14} />{t('sidebar.stashes', { count: stashes.length })}</h3>
      <ul className="sidebar-list">
        {stashes.length === 0 && <li className="sidebar-empty">{t('sidebar.noStashes')}</li>}
        {stashes.map((stash) => (
          <li
            key={stash.hash}
            className={`sidebar-item${stash.ref === selectedStash ? ' selected' : ''}`}
            onClick={() => onSelectStash(stash)}
            onContextMenu={(event) => onStashMenu(stash, event)}
          >
            <span className="item-name" title={stash.message}>
              {stash.message}
            </span>
            <span className="count">{stash.ref.replace('stash@', '')}</span>
          </li>
        ))}
      </ul>
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
