import type { GitDeskApi, GitDeskEvents } from '../../shared/api'
import type { Result } from '../../shared/types'

export const api = (): GitDeskApi & GitDeskEvents => window.gitdesk

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
