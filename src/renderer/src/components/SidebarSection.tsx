import type { ReactNode } from 'react'
import { useSectionCollapsed, toggleSection } from '../hooks/useCollapsedSections'
import { useT } from '../i18n'
import { Icon, type IconName } from '../icons'

interface Props {
  /** Stable name the folded state is remembered under. */
  id: string
  icon: IconName
  title: string
  /** Buttons on the right of the heading; they work whether the section is folded or not. */
  actions?: ReactNode
  /** Show the rows even if the section is folded (a search is looking through them). */
  forceOpen?: boolean
  /** The rows: `<li>` elements. */
  children: ReactNode
}

/** A sidebar heading that folds its list. The heading keeps showing the count when folded. */
export function SidebarSection({ id, icon, title, actions, forceOpen = false, children }: Props) {
  const t = useT()
  const folded = useSectionCollapsed(id)
  const open = forceOpen || !folded
  return (
    <>
      <h3 className="sidebar-heading">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          aria-controls={`sidebar-section-${id}`}
          title={open ? t('sidebar.fold') : t('sidebar.unfold')}
          onClick={() => toggleSection(id)}
        >
          <svg className={`chevron${open ? ' open' : ''}`} viewBox="0 0 16 16" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
          <Icon name={icon} size={14} />
          {title}
        </button>
        {actions}
      </h3>
      {open && (
        <ul className="sidebar-list" id={`sidebar-section-${id}`}>
          {children}
        </ul>
      )}
    </>
  )
}
