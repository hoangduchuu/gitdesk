/// <reference types="vite/client" />
import type { GitDeskApi, GitDeskEvents } from '../../shared/api'

declare global {
  interface Window {
    gitdesk: GitDeskApi & GitDeskEvents
  }
}
