import type { MouseEvent } from 'react'
import type { Branch, Stash, Tag } from '../../../shared/model'
import { useT } from '../i18n'
import { Icon } from '../icons'

interface Props {
  branches: readonly Branch[]
  stashes: readonly Stash[]
  tags: readonly Tag[]
  selectedStash: string | null
  onSelectBranch: (branch: Branch) => void
  onCheckout: (branch: Branch) => void
  onSelectStash: (stash: Stash) => void
  onSelectTag: (tag: Tag) => void
  onBranchMenu: (branch: Branch, event: MouseEvent) => void
  onTagMenu: (tag: Tag, event: MouseEvent) => void
  onStashMenu: (stash: Stash, event: MouseEvent) => void
}

export function Sidebar(props: Props) {
  const t = useT()
  const { branches, stashes, tags, selectedStash, onSelectBranch, onCheckout, onSelectStash } = props
  const { onSelectTag, onBranchMenu, onTagMenu, onStashMenu } = props
  const local = branches.filter((branch) => branch.kind === 'local')
  const remote = branches.filter((branch) => branch.kind === 'remote')

  return (
    <nav className="sidebar" aria-label={t('sidebar.label')}>
      <h3 className="sidebar-heading"><Icon name="local" size={14} />{t('sidebar.local', { count: local.length })}</h3>
      <ul className="sidebar-list">
        {local.map((branch) => (
          <li
            key={branch.name}
            className={`sidebar-item${branch.isHead ? ' head' : ''}`}
            onClick={() => onSelectBranch(branch)}
            onDoubleClick={() => onCheckout(branch)}
            onContextMenu={(event) => onBranchMenu(branch, event)}
            title={t('sidebar.checkoutHint')}
          >
            <span className="item-name">{branch.name}</span>
            {branch.ahead > 0 && <span className="count ahead">↑{branch.ahead}</span>}
            {branch.behind > 0 && <span className="count behind">↓{branch.behind}</span>}
            {branch.upstreamGone && <span className="count gone">{t('sidebar.gone')}</span>}
          </li>
        ))}
      </ul>

      <h3 className="sidebar-heading"><Icon name="remote" size={14} />{t('sidebar.remote', { count: remote.length })}</h3>
      <ul className="sidebar-list">
        {remote.length === 0 && <li className="sidebar-empty">{t('sidebar.noRemoteBranches')}</li>}
        {remote.map((branch) => (
          <li
            key={branch.name}
            className="sidebar-item"
            onClick={() => onSelectBranch(branch)}
            onDoubleClick={() => onCheckout(branch)}
            onContextMenu={(event) => onBranchMenu(branch, event)}
            title={t('sidebar.checkoutLocalHint')}
          >
            <span className="item-name">{branch.name}</span>
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
