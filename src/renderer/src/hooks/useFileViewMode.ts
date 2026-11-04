import { useSyncExternalStore } from 'react'

export type FileViewMode = 'tree' | 'path'

const STORAGE_KEY = 'gitdesk.fileViewMode'
const listeners = new Set<() => void>()

const readStored = (): FileViewMode => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'path' ? 'path' : 'tree'
  } catch {
    return 'tree'
  }
}

let mode: FileViewMode = readStored()

export function setFileViewMode(next: FileViewMode): void {
  mode = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
  for (const listener of listeners) listener()
}

/** Tree or path view for every file list; shared app-wide and remembered between launches. */
export function useFileViewMode(): FileViewMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => mode
  )
}
