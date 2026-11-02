import type { MergeOutcome, Remote } from '../../shared/model'
import { allowConflicts } from './conflict'
import { GitError, runGit, type RunOptions } from './exec'
import { readStatus } from './status'

const PREFERRED_REMOTE = 'origin'

export async function fetch(repo: string, options: RunOptions = {}): Promise<void> {
  await runGit(repo, ['fetch', '--all', '--prune'], options)
}

/** Respect the user's pull.rebase setting; default to a merge when it is unset. */
const pullStrategy = async (repo: string): Promise<string[]> => {
  const configured = await runGit(repo, ['config', '--get', 'pull.rebase'], { okExitCodes: [1] })
  return configured.trim() === '' ? ['--no-rebase'] : []
}

export async function pull(repo: string, options: RunOptions = {}): Promise<MergeOutcome> {
  const strategy = await pullStrategy(repo)
  return allowConflicts(repo, () => runGit(repo, ['pull', '--no-edit', ...strategy], options))
}

/** `origin` when it exists, otherwise the first configured remote. */
export const defaultRemote = async (repo: string): Promise<string> => {
  const remotes = (await runGit(repo, ['remote'])).split('\n').filter((name) => name !== '')
  if (remotes.length === 0) throw new Error('No remote is configured for this repository')
  return remotes.includes(PREFERRED_REMOTE) ? PREFERRED_REMOTE : remotes[0]!
}

/** Push the current branch, publishing it with an upstream the first time. */
export async function push(repo: string, options: RunOptions = {}): Promise<void> {
  const status = await readStatus(repo)
  if (status.branch === null) throw new Error('Cannot push a detached HEAD; create a branch first')
  if (status.upstream !== null) {
    await runGit(repo, ['push'], options)
    return
  }
  await runGit(repo, ['push', '-u', await defaultRemote(repo), 'HEAD'], options)
}

const remoteNames = async (repo: string): Promise<string[]> =>
  (await runGit(repo, ['remote'])).split('\n').filter((name) => name !== '')

/** The configured remotes with their URLs exactly as written in the repository's config. */
export async function readRemotes(repo: string): Promise<Remote[]> {
  const names = await remoteNames(repo)
  const configured = await runGit(repo, ['config', '--local', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'], {
    okExitCodes: [1]
  })
  const urls = new Map<string, string>()
  const pushUrls = new Map<string, string>()
  for (const line of configured.split('\n')) {
    const match = /^remote\.(.+)\.(url|pushurl) (.*)$/.exec(line)
    if (!match) continue
    const target = match[2] === 'url' ? urls : pushUrls
    if (!target.has(match[1]!)) target.set(match[1]!, match[3]!)
  }
  return names.map((name) => {
    const fetchUrl = urls.get(name) ?? ''
    return { name, fetchUrl, pushUrl: pushUrls.get(name) ?? fetchUrl }
  })
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** `ext::` and similar helpers run programs; they are never a repository address. */
const TRANSPORT_HELPER = /^[A-Za-z][A-Za-z0-9+.-]*::/

/** A remote address: https, ssh, git@host:path, a local path... but nothing git could read as an option or a helper. */
export function requireRemoteUrl(value: string): string {
  const url = value.trim()
  if (url === '' || url.length > 2048 || CONTROL_CHARS.test(url) || url.startsWith('-') || TRANSPORT_HELPER.test(url)) {
    throw new Error('Invalid remote URL')
  }
  return url
}

async function requireRemoteName(repo: string, name: string): Promise<void> {
  const invalid = new Error(`"${name}" is not a valid remote name`)
  if (name === '' || name.startsWith('-')) throw invalid
  try {
    await runGit(repo, ['check-ref-format', `refs/remotes/${name}/x`])
  } catch (error) {
    if (error instanceof GitError) throw invalid
    throw error
  }
}

const requireExistingRemote = async (repo: string, name: string): Promise<void> => {
  if (!(await remoteNames(repo)).includes(name)) throw new Error(`There is no remote named ${name}`)
}

export async function addRemote(repo: string, name: string, url: string): Promise<void> {
  await requireRemoteName(repo, name)
  const address = requireRemoteUrl(url)
  if ((await remoteNames(repo)).includes(name)) throw new Error(`A remote named ${name} already exists`)
  await runGit(repo, ['remote', 'add', name, address])
}

export async function setRemoteUrl(repo: string, name: string, url: string): Promise<void> {
  await requireExistingRemote(repo, name)
  await runGit(repo, ['remote', 'set-url', name, requireRemoteUrl(url)])
}

/** Remove the remote and its remote-tracking branches from this repository; nothing changes on the server. */
export async function removeRemote(repo: string, name: string): Promise<void> {
  await requireExistingRemote(repo, name)
  await runGit(repo, ['remote', 'remove', name])
}

/** Push the current branch to a named remote and make it the branch's upstream. */
export async function pushTo(repo: string, remote: string, options: RunOptions = {}): Promise<void> {
  const status = await readStatus(repo)
  if (status.branch === null) throw new Error('Cannot push a detached HEAD; create a branch first')
  await requireExistingRemote(repo, remote)
  await runGit(repo, ['push', '-u', remote, 'HEAD'], options)
}
