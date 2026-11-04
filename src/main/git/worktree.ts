import type { FileChange } from '../../shared/model'
import { hasRevision } from './diff'
import type { ProfileSigning } from '../../shared/model'
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
  /** Sign the commit like this; git's own settings apply when absent. */
  signing?: ProfileSigning
}

/**
 * `-c` options that make one git command sign. `gpg.ssh.program` is spelled out because
 * Apple's git has no default for it and fails with "cannot run : No such file" (unless the
 * user already configured one).
 */
export async function signingOptions(repo: string, signing: ProfileSigning | undefined): Promise<string[]> {
  if (!signing) return []
  const options = ['-c', `gpg.format=${signing.format}`, '-c', 'commit.gpgsign=true']
  // A public key typed in (not a file) must be marked as such for git; it then has to be loaded in ssh-agent.
  const key = signing.format === 'ssh' && /^(ssh-|ecdsa-|sk-)/.test(signing.key) ? `key::${signing.key}` : signing.key
  options.push('-c', `user.signingkey=${key}`)
  if (signing.format === 'ssh') options.push(...(await sshProgramOptions(repo)))
  return options
}

/** `-c gpg.ssh.program=ssh-keygen` unless the user configured a program. */
export async function sshProgramOptions(repo: string): Promise<string[]> {
  const configured = (await runGit(repo, ['config', '--get', 'gpg.ssh.program'], { okExitCodes: [1] })).trim()
  return configured === '' ? ['-c', 'gpg.ssh.program=ssh-keygen'] : []
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
  const signing = await signingOptions(repo, identity?.signing)
  try {
    await runGit(repo, [...signing, 'commit', '-q', ...(amend ? ['--amend'] : []), '-m', trimmed], env ? { env } : {})
  } catch (error) {
    if (signing.length > 0 && error instanceof Error && !error.message.includes('nothing to commit')) {
      throw new Error(`Signing the commit failed: ${error.message.trim()}\n\nCheck the signing key of this profile (Profiles). An ssh key must be a file git can read or be loaded in ssh-agent.`)
    }
    throw error
  }
}

/** user.name / user.email as git resolves them in this repository (null when unset). */
export async function gitIdentity(repo: string): Promise<{ name: string | null; email: string | null }> {
  const read = async (key: string): Promise<string | null> =>
    (await runGit(repo, ['config', '--get', key], { okExitCodes: [1] })).trim() || null
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  return { name, email }
}
