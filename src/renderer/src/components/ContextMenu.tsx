import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'

export type MenuItem =
  | { kind: 'action'; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: IconName }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

export interface MenuRequest {
  x: number
  y: number
  items: MenuItem[]
}

export const action = (
  label: string,
  onSelect: () => void,
  options: { danger?: boolean; disabled?: boolean; icon?: IconName } = {}
): MenuItem => ({
  kind: 'action',
  label,
  onSelect,
  ...options
})
export const separator: MenuItem = { kind: 'separator' }
export const heading = (label: string): MenuItem => ({ kind: 'heading', label })

const EDGE_MARGIN = 8

/** Right-click menu; closes on outside click, Escape, scroll or window blur. */
export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: request.x, top: request.y })

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.min(request.x, window.innerWidth - width - EDGE_MARGIN),
      top: Math.min(request.y, window.innerHeight - height - EDGE_MARGIN)
    })
  }, [request])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])

  return (
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      style={position}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {request.items.map((item, index) => {
        if (item.kind === 'separator') return <div key={index} className="menu-separator" role="separator" />
        if (item.kind === 'heading') return <div key={index} className="menu-heading">{item.label}</div>
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <span className="menu-icon">{item.icon && <Icon name={item.icon} size={14} />}</span>
            <span className="menu-label">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
