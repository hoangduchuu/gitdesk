import type { RewordResult } from '../../shared/model'
import { abortOperation } from './conflict'
import { GitError, runGit } from './exec'
import { interactiveRebase, readRebaseCommits } from './rebase'
import { currentOperation, readStatus } from './status'
import { signingOptions, type Identity } from './worktree'

const isAncestorOfHead = async (repo: string, hash: string): Promise<boolean> => {
  try {
    await runGit(repo, ['merge-base', '--is-ancestor', hash, 'HEAD'])
    return true
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false
    throw error
  }
}

/** Is the commit already on a remote branch? Then rewriting it needs a force push. */
const isPublished = async (repo: string, hash: string): Promise<boolean> => {
  const out = await runGit(repo, ['for-each-ref', '--contains', hash, '--format=%(refname)', 'refs/remotes'])
  return out.split('\n').some((ref) => ref !== '' && !ref.endsWith('/HEAD'))
}

/**
 * Change the message of a commit on the current branch. The newest commit is amended; an older
 * one is reworded through a rebase that replays everything after it unchanged. Authors, dates
 * and file contents are kept; the rewritten commits get new hashes.
 */
export async function rewordCommit(repo: string, hash: string, message: string, identity: Identity | null): Promise<RewordResult> {
  const text = message.trim()
  if (text === '') throw new Error('Commit message is empty')
  if (text.includes('\0')) throw new Error('Invalid commit message')
  const status = await readStatus(repo)
  if (status.operation !== null) throw new Error(`Finish the ${status.operation} in progress first`)
  if (status.branch === null) throw new Error('Check out a branch first: a detached HEAD would leave the rewritten commits unreachable')

  const full = (await runGit(repo, ['rev-parse', '--verify', '-q', `${hash}^{commit}`])).trim()
  if (!(await isAncestorOfHead(repo, full))) {
    throw new Error('That commit is not on the current branch. Check out its branch first.')
  }
  const published = await isPublished(repo, full)

  if (full === (await runGit(repo, ['rev-parse', 'HEAD'])).trim()) {
    const env = identity ? { GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email } : undefined
    // --only without paths changes the message alone: staged changes stay staged for the next commit.
    await runGit(repo, [...(await signingOptions(repo, identity?.signing)), 'commit', '-q', '--amend', '--only', '--allow-empty', '-m', text], env ? { env } : {})
    return { conflicts: false, published }
  }

  const parents = (await runGit(repo, ['rev-list', '--parents', '-n', '1', full])).trim().split(' ').slice(1)
  if (parents.length === 0) throw new Error('The first commit of a repository cannot be reworded here')
  if (parents.length > 1) throw new Error('A merge commit cannot be reworded here')
  const base = parents[0]!
  const commits = await readRebaseCommits(repo, base)
  try {
    const outcome = await interactiveRebase(
      repo,
      base,
      commits.map((commit) => (commit.hash === full ? { hash: commit.hash, action: 'reword' as const, message: text } : { hash: commit.hash, action: 'pick' as const }))
    )
    return { ...outcome, published }
  } catch (error) {
    // Replaying unchanged commits cannot conflict, so a stop here is a failure (a hook that refused
    // the new message, say): put the branch back as it was instead of leaving a rebase half done.
    if ((await currentOperation(repo)) === 'rebase') await abortOperation(repo).catch(() => undefined)
    throw error
  }
}
