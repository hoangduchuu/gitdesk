import { useState, type DragEvent, type MouseEvent } from 'react'
import { useT } from '../i18n'
import { Icon } from '../icons'
import type { Tab } from '../tabs'

interface Props {
  tabs: Tab[]
  activeId: number
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  onOpen: () => void
  /** Drag-and-drop reorder: the dragged tab takes the target tab's place. */
  onMove: (draggedId: number, targetId: number) => void
}

/** On macOS the window buttons sit inside this bar, so it leaves room for them. */
const IS_MAC = navigator.userAgent.includes('Macintosh')

/** GitKraken-style tab strip: one tab per repository, plus empty "New Tab" pages. */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onOpen, onMove }: Props) {
  const t = useT()
  const [dragged, setDragged] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const endDrag = (): void => {
    setDragged(null)
    setDropTarget(null)
  }
  const dropOn = (id: number) => (event: DragEvent) => {
    event.preventDefault()
    if (dragged !== null) onMove(dragged, id)
    endDrag()
  }
  const closeOnMiddleClick = (id: number) => (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault()
      onClose(id)
    }
  }

  return (
    <nav className={`tab-bar${IS_MAC ? ' mac' : ''}`} aria-label={t('tabs.label')}>
      <button type="button" className="tab-bar-button" onClick={onOpen} title={t('toolbar.open')}>
        <Icon name="open" size={16} />
      </button>
      <div className="tab-list" role="tablist">
        {tabs.map((tab) => {
          const label = tab.repo?.name ?? t('tabs.newTab')
          const selected = tab.id === activeId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected}
              tabIndex={0}
              className={`tab${selected ? ' active' : ''}${tab.id === dragged ? ' dragging' : ''}${
                tab.id === dropTarget && dragged !== null && dragged !== tab.id ? ' drop-target' : ''
              }`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                setDragged(tab.id)
              }}
              onDragOver={(event) => {
                if (dragged === null) return
                event.preventDefault()
                setDropTarget(tab.id)
              }}
              onDragLeave={() => setDropTarget((current) => (current === tab.id ? null : current))}
              onDrop={dropOn(tab.id)}
              onDragEnd={endDrag}
              title={tab.repo?.path ?? label}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect(tab.id)}
              onAuxClick={closeOnMiddleClick(tab.id)}
            >
              {tab.repo && <Icon name="branch" size={13} />}
              <span className="tab-label">{label}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={t('tabs.close', { name: label })}
                title={t('tabs.close', { name: label })}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )
        })}
        <button type="button" className="tab-bar-button" onClick={onNew} title={t('tabs.new')} aria-label={t('tabs.new')}>
          <Icon name="stage" size={16} />
        </button>
      </div>
    </nav>
  )
}
