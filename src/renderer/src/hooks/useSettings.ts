import { useSyncExternalStore } from 'react'
import { PALETTES, type PaletteName } from '../palettes'

export type GraphLineWidth = 'thin' | 'normal' | 'thick'
export type Theme = 'dark' | 'light'
export type Language = 'en' | 'vi'

export interface Settings {
  graphLineWidth: GraphLineWidth
  graphPalette: PaletteName
  theme: Theme
  language: Language
}

/** Stroke width in pixels for each graph line setting. */
export const LINE_WIDTH_PX: Record<GraphLineWidth, number> = { thin: 1.5, normal: 2, thick: 3 }

const STORAGE_KEY = 'gitdesk.settings'
const THEMES: readonly Theme[] = ['dark', 'light']
const LANGUAGES: readonly Language[] = ['en', 'vi']

/** First launch follows the system language: Vietnamese on a Vietnamese system, English otherwise. */
const systemLanguage = (): Language => (navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en')

const defaults = (): Settings => ({ graphLineWidth: 'thin', graphPalette: 'vivid', theme: 'dark', language: systemLanguage() })

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const readStored = (): Settings => {
  const base = defaults()
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    return {
      graphLineWidth: pick(parsed.graphLineWidth, Object.keys(LINE_WIDTH_PX) as GraphLineWidth[], base.graphLineWidth),
      graphPalette: pick(parsed.graphPalette, Object.keys(PALETTES) as PaletteName[], base.graphPalette),
      theme: pick(parsed.theme, THEMES, base.theme),
      language: pick(parsed.language, LANGUAGES, base.language)
    }
  } catch {
    return base
  }
}

const listeners = new Set<() => void>()
let settings: Settings = readStored()

/** Theme and language are applied to the document so CSS and screen readers follow them. */
const applyToDocument = (): void => {
  document.documentElement.dataset['theme'] = settings.theme
  document.documentElement.lang = settings.language
}
applyToDocument()

export function updateSettings(change: Partial<Settings>): void {
  settings = { ...settings, ...change }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be unavailable; the change then lasts for this session only.
  }
  applyToDocument()
  listeners.forEach((listener) => listener())
}

/** App settings, shared by every component and remembered between launches. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => settings
  )
}
