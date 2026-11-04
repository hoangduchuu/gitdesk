import { useSyncExternalStore } from 'react'

export interface PaneWidths {
  sidebar: number
  details: number
}

export const DEFAULT_WIDTHS: PaneWidths = { sidebar: 230, details: 360 }
const KEY = 'gitdesk.paneWidths'
const listeners = new Set<() => void>()

const read = (): PaneWidths => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PaneWidths>
    const ok = (value: unknown, fallback: number): number => (typeof value === 'number' && value > 0 && value < 2000 ? value : fallback)
    return { sidebar: ok(parsed.sidebar, DEFAULT_WIDTHS.sidebar), details: ok(parsed.details, DEFAULT_WIDTHS.details) }
  } catch {
    return DEFAULT_WIDTHS
  }
}

let widths = read()

const setWidths = (change: Partial<PaneWidths>): void => {
  widths = { ...widths, ...change }
  try {
    localStorage.setItem(KEY, JSON.stringify(widths))
  } catch {
    // Not remembered between launches when storage is unavailable.
  }
  for (const listener of listeners) listener()
}

/** Sidebar and details-panel widths, shared by every tab and remembered between launches. */
export function usePaneWidths(): [PaneWidths, (change: Partial<PaneWidths>) => void] {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => widths
  )
  return [current, setWidths]
}
