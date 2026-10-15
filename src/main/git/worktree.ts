import type { FileChange } from '../../shared/model'
import { hasRevision } from './diff'
import { runGit } from './exec'

export async function stage(repo: string, paths: readonly string[]): Promise<void> {
  // -A also stages deletions of the given paths.
  await runGit(repo, ['add', '-A', '--', ...paths])
}

export async function unstage(repo: string, paths: readonly string[]): Promise<void> {
  if (await hasRevision(repo, 'HEAD')) {
    await runGit(repo, ['restore', '--staged', '--', ...paths])
    return
  }
  // Before the first commit there is no HEAD to restore from.
  await runGit(repo, ['rm', '--cached', '-r', '-q', '--', ...paths])
}

/** Throw away working-tree changes. Staged changes are kept. */
export async function discard(repo: string, changes: readonly FileChange[]): Promise<void> {
  const untracked = changes.filter((change) => change.kind === 'untracked').map((change) => change.path)
  const tracked = changes.filter((change) => change.kind !== 'untracked').map((change) => change.path)
  if (tracked.length > 0) await runGit(repo, ['restore', '--worktree', '--', ...tracked])
  if (untracked.length > 0) await runGit(repo, ['clean', '-f', '-q', '--', ...untracked])
}

export interface Identity {
  name: string
  email: string
}

/**
 * Commit, optionally as `identity`. It is passed through the environment for this one
 * command, which also overrides any GIT_AUTHOR_* variables already set, and never touches
 * the repository's config. On --amend git keeps the original author and updates the committer.
 */
export async function commit(repo: string, message: string, amend: boolean, identity: Identity | null): Promise<void> {
  const trimmed = message.trim()
  if (trimmed === '') throw new Error('Commit message is empty')
  const env = identity
    ? {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email
      }
    : undefined
  await runGit(repo, ['commit', '-q', ...(amend ? ['--amend'] : []), '-m', trimmed], env ? { env } : {})
}

/** user.name / user.email as git resolves them in this repository (null when unset). */
export async function gitIdentity(repo: string): Promise<{ name: string | null; email: string | null }> {
  const read = async (key: string): Promise<string | null> =>
    (await runGit(repo, ['config', '--get', key], { okExitCodes: [1] })).trim() || null
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  return { name, email }
}
