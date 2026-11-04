import { checkoutOrigin, undoKindOf } from '../../shared/undo'
import { runGit } from './exec'
import { readReflog } from './reflog'

/**
 * Take back the newest HEAD movement, if it was a commit, a reset or a branch switch:
 * - commit: back to the previous commit, with its changes left staged (nothing is lost)
 * - reset: back to where HEAD was, but only if no local change is in the way (`--keep`)
 * - checkout: back to the branch or commit that was checked out before
 * Anything else (merge, rebase, pull...) is refused rather than guessed at.
 */
export async function undoLastAction(repoPath: string): Promise<void> {
  const [latest, previous] = await readReflog(repoPath, 2)
  if (!latest || !previous) throw new Error('Nothing to undo')
  switch (undoKindOf(latest.action)) {
    case 'commit':
      await runGit(repoPath, ['reset', '--soft', previous.hash])
      return
    case 'reset':
      await runGit(repoPath, ['reset', '--keep', previous.hash])
      return
    case 'checkout': {
      const origin = checkoutOrigin(latest.action)
      if (!origin) throw new Error('Nothing to undo')
      await runGit(repoPath, origin.detached ? ['switch', '--detach', origin.name] : ['switch', origin.name, '--'])
      return
    }
    default:
      throw new Error(`Cannot undo "${latest.action}"`)
  }
}
