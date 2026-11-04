/// <reference types="vite/client" />
import type { GitDeskApi, GitDeskEvents } from '../../shared/api'

declare global {
  /** Injected at build time from package.json. */
  const __APP_VERSION__: string

  interface Window {
    gitdesk: GitDeskApi & GitDeskEvents
  }
}
