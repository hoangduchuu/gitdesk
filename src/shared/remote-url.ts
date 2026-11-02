import type { GitProvider, ProfileAuth } from './model'

/** Hide a password or token embedded in a remote URL (`https://user:secret@host/x`) before showing it. */
export const maskUrl = (url: string): string => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:\s]*):[^/@\s]*@/, '$1:***@')

/** The provider a connection most likely belongs to; the user can still change it. */
export const guessProvider = (connection: ProfileAuth): GitProvider => {
  if (connection.kind === 'github') return 'github'
  const host = connection.host.toLowerCase()
  if (host === 'github.com') return 'github'
  return host.includes('gitlab') ? 'gitlab' : 'gitea'
}
