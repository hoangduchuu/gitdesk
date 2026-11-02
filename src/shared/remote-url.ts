import type { GitProvider, ProfileAuth } from './model'

/** Hide a password or token embedded in a remote URL (`https://user:secret@host/x`) before showing it. */
export const maskUrl = (url: string): string => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:\s]*):[^/@\s]*@/, '$1:***@')

/** The provider a connection most likely belongs to; the user can still change it. */
export const guessProvider = (connection: ProfileAuth): GitProvider => {
  if (connection.kind === 'github') return 'github'
  const host = connection.host.toLowerCase()
  if (host === 'github.com') return 'github'
  if (host === 'bitbucket.org') return 'bitbucket'
  return host.includes('gitlab') ? 'gitlab' : 'gitea'
}

export interface RemoteAddress {
  host: string
  /** Everything before the repository name (an organization, or nested groups on GitLab). */
  owner: string
  repo: string
}

/** Host, owner and name from a remote address (https, ssh://, git@host:path); null for local paths and anything else. */
export const parseRemoteUrl = (url: string): RemoteAddress | null => {
  const text = url.trim()
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^/@]*@)?([^/:@]+)(?::\d+)?\/(.+)$/.exec(text)
  const scpLike = /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+)$/.exec(text)
  const match = withScheme ?? (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? null : scpLike)
  if (!match) return null
  const parts = match[2]!.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  return { host: match[1]!.toLowerCase(), owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1]! }
}
