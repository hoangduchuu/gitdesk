import type { KeyboardEvent } from 'react'

/** Makes a clickable non-button element reachable by Tab and activatable with Enter or Space. */
export const keyboardActivatable = (onActivate: () => void): { tabIndex: 0; onKeyDown: (event: KeyboardEvent) => void } => ({
  tabIndex: 0,
  onKeyDown: (event) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }
})
