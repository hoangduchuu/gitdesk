import type { MergeOutcome } from '../../shared/model'
import { allowConflicts } from './conflict'
import { runGit, type RunOptions } from './exec'
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
