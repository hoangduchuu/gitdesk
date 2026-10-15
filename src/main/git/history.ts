import type { ResetMode } from '../../shared/api'
import type { MergeOutcome } from '../../shared/model'
import { allowConflicts } from './conflict'
import { runGit } from './exec'


const parentCount = async (repo: string, hash: string): Promise<number> =>
  (await runGit(repo, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ').length - 1

/** Apply commits onto HEAD. They arrive newest first (graph order) and are applied oldest first. */
export function cherryPick(repo: string, hashes: readonly string[]): Promise<MergeOutcome> {
  if (hashes.length === 0) throw new Error('No commits selected')
  return allowConflicts(repo, () => runGit(repo, ['cherry-pick', ...[...hashes].reverse()]))
}

/** Add a commit that undoes `hash`; a merge is reverted against its first parent. */
export async function revertCommit(repo: string, hash: string): Promise<MergeOutcome> {
  const mainline = (await parentCount(repo, hash)) > 1 ? ['-m', '1'] : []
  return allowConflicts(repo, () => runGit(repo, ['revert', '--no-edit', ...mainline, hash]))
}

export async function resetTo(repo: string, hash: string, mode: ResetMode): Promise<void> {
  await runGit(repo, ['reset', `--${mode}`, hash])
}

export async function checkoutCommit(repo: string, hash: string): Promise<void> {
  await runGit(repo, ['switch', '--detach', hash])
}
