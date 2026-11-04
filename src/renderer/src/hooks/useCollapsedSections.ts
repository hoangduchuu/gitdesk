import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'gitdesk.collapsedSections'
const listeners = new Set<() => void>()

const readStored = (): ReadonlySet<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

let collapsed: ReadonlySet<string> = readStored()

/** Fold or unfold a sidebar section; the choice is remembered between launches and shared by all tabs. */
export function toggleSection(id: string): void {
  const next = new Set(collapsed)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
  for (const listener of listeners) listener()
}

export function useSectionCollapsed(id: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => collapsed.has(id)
  )
}
