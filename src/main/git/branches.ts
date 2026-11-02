import type { Branch, MergeOutcome } from '../../shared/model'
import { allowConflicts } from './conflict'
import { GitError, runGit } from './exec'
import { currentOperation } from './status'

const FIELDS = ['%(refname)', '%(objectname)', '%(HEAD)', '%(upstream:short)', '%(upstream:track,nobracket)']
const LOCAL = 'refs/heads/'
const REMOTE = 'refs/remotes/'

const parseTrack = (track: string): Pick<Branch, 'ahead' | 'behind' | 'upstreamGone'> => ({
  ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
  behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  upstreamGone: track === 'gone'
})

const parseBranch = (line: string): Branch | null => {
  const [ref = '', hash = '', head = '', upstream = '', track = ''] = line.split('\0')
  const kind = ref.startsWith(LOCAL) ? 'local' : ref.startsWith(REMOTE) ? 'remote' : null
  if (kind === null) return null
  const name = ref.slice(kind === 'local' ? LOCAL.length : REMOTE.length)
  if (kind === 'remote' && name.endsWith('/HEAD')) return null
  return { name, kind, hash, isHead: head === '*', upstream: upstream || null, ...parseTrack(track) }
}

export async function readBranches(repo: string): Promise<Branch[]> {
  const out = await runGit(repo, ['for-each-ref', `--format=${FIELDS.join('%00')}`, LOCAL, REMOTE])
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map(parseBranch)
    .filter((branch): branch is Branch => branch !== null)
}

/** Reject names git would refuse, and anything git could read as an option. */
async function requireBranchName(repo: string, name: string): Promise<void> {
  const invalid = new Error(`"${name}" is not a valid branch name`)
  if (name === '' || name.startsWith('-')) throw invalid
  try {
    await runGit(repo, ['check-ref-format', `${LOCAL}${name}`])
  } catch (error) {
    if (error instanceof GitError) throw invalid
    throw error
  }
}

const requireRevision = (revision: string): void => {
  if (revision === '' || revision.startsWith('-')) throw new Error(`Invalid revision: ${revision}`)
}

export async function createBranch(
  repo: string,
  name: string,
  startPoint: string | null,
  checkout: boolean
): Promise<void> {
  await requireBranchName(repo, name)
  if (startPoint !== null) requireRevision(startPoint)
  const start = startPoint === null ? [] : [startPoint]
  await runGit(repo, checkout ? ['switch', '-c', name, ...start] : ['branch', name, ...start])
}

export async function checkoutBranch(repo: string, name: string, kind: Branch['kind']): Promise<void> {
  requireRevision(name)
  if (kind === 'local') {
    await runGit(repo, ['switch', name])
    return
  }
  // origin/feature/x -> feature/x, tracking the remote branch.
  const localName = name.slice(name.indexOf('/') + 1)
  const existing = await readBranches(repo)
  if (existing.some((branch) => branch.kind === 'local' && branch.name === localName)) {
    await runGit(repo, ['switch', localName])
    return
  }
  await requireBranchName(repo, localName)
  await runGit(repo, ['switch', '-c', localName, '--track', name])
}

export async function deleteBranch(repo: string, name: string, force: boolean): Promise<void> {
  requireRevision(name)
  await runGit(repo, ['branch', force ? '-D' : '-d', name])
}

export async function renameBranch(repo: string, from: string, to: string): Promise<void> {
  requireRevision(from)
  await requireBranchName(repo, to)
  await runGit(repo, ['branch', '-m', from, to])
}

/** Delete `remote/branch` on the remote itself (e.g. `origin/feature/x`). */
export async function deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void> {
  requireRevision(remoteBranch)
  const slash = remoteBranch.indexOf('/')
  const remote = remoteBranch.slice(0, slash)
  const branch = remoteBranch.slice(slash + 1)
  const remotes = (await runGit(repo, ['remote'])).split('\n')
  if (slash <= 0 || branch === '' || !remotes.includes(remote)) {
    throw new Error(`${remoteBranch} is not a remote branch`)
  }
  await runGit(repo, ['push', remote, '--delete', branch])
}

export function mergeBranch(repo: string, name: string): Promise<MergeOutcome> {
  requireRevision(name)
  return allowConflicts(repo, () => runGit(repo, ['merge', '--no-edit', name]))
}

/** Refuse to switch branches while a merge is unfinished or tracked files have uncommitted changes. */
export async function requireCleanTree(repo: string, action: string): Promise<void> {
  if ((await currentOperation(repo)) !== null) throw new Error('Finish the merge, rebase or cherry-pick in progress first')
  if ((await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).trim() !== '') {
    throw new Error(`Commit or stash your changes before ${action}: it switches branches`)
  }
}

/** Branches a drag and drop can name: local ones, and remote ones as the source of a merge or the base of a rebase. */
const requireKnownBranch = (branches: readonly Branch[], name: string, kind: 'local' | 'any'): Branch => {
  requireRevision(name)
  const found = branches.find((branch) => branch.name === name && (kind === 'any' || branch.kind === 'local'))
  if (!found) throw new Error(kind === 'local' ? `${name} is not a local branch` : `${name} is not a branch`)
  return found
}

/** Merge `source` into the local branch `target`, switching to `target` first when it is not checked out. */
export async function mergeBranchInto(repo: string, source: string, target: string): Promise<MergeOutcome> {
  const branches = await readBranches(repo)
  requireKnownBranch(branches, source, 'any')
  const destination = requireKnownBranch(branches, target, 'local')
  if (source === target) throw new Error('Choose two different branches')
  if (!destination.isHead) {
    await requireCleanTree(repo, 'merging')
    await runGit(repo, ['switch', target])
  }
  return mergeBranch(repo, source)
}

/**
 * Replay the local branch `branch` on top of `onto` (a local or remote branch). Git checks
 * `branch` out for the rebase, so the tree must be clean; conflicts are reported, and the
 * usual continue and abort controls take over.
 */
export async function rebaseBranch(repo: string, branch: string, onto: string): Promise<MergeOutcome> {
  const branches = await readBranches(repo)
  const moving = requireKnownBranch(branches, branch, 'local')
  requireKnownBranch(branches, onto, 'any')
  if (branch === onto) throw new Error('Choose two different branches')
  if (!moving.isHead) await requireCleanTree(repo, 'rebasing')
  return allowConflicts(repo, () => runGit(repo, ['rebase', onto, branch]))
}
