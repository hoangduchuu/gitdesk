import type { MergeOutcome, Stash } from '../../shared/model'
import { allowConflicts } from './conflict'
import { hasRevision } from './diff'
import { runGit } from './exec'

const FIELD = '\x1f'
const STASH_REF = /^stash@\{\d+\}$/

export function requireStashRef(ref: string): void {
  if (!STASH_REF.test(ref)) throw new Error(`Invalid stash reference: ${ref}`)
}

export async function readStashes(repo: string): Promise<Stash[]> {
  const out = await runGit(repo, ['stash', 'list', '-z', '--format=%gd%x1f%H%x1f%at%x1f%P%x1f%gs'])
  return out
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [ref = '', hash = '', time = '0', parents = '', message = ''] = record.split(FIELD)
      // First parent is the commit HEAD pointed at when the stash was made.
      return { ref, hash, time: Number(time), base: parents.split(' ')[0] ?? '', message }
    })
}

const latestStash = async (repo: string): Promise<string | null> =>
  (await hasRevision(repo, 'refs/stash')) ? (await runGit(repo, ['rev-parse', 'refs/stash'])).trim() : null

export async function stashPush(repo: string, message: string, includeUntracked: boolean): Promise<void> {
  const before = await latestStash(repo)
  const label = message.trim()
  await runGit(repo, [
    'stash',
    'push',
    ...(includeUntracked ? ['--include-untracked'] : []),
    ...(label === '' ? [] : ['-m', label])
  ])
  // git exits 0 even when it had nothing to save.
  if ((await latestStash(repo)) === before) throw new Error('No local changes to stash')
}

export function stashApply(repo: string, ref: string): Promise<MergeOutcome> {
  requireStashRef(ref)
  return allowConflicts(repo, () => runGit(repo, ['stash', 'apply', ref]))
}

/** Apply and remove the stash; on conflicts git keeps the stash so nothing is lost. */
export function stashPop(repo: string, ref: string): Promise<MergeOutcome> {
  requireStashRef(ref)
  return allowConflicts(repo, () => runGit(repo, ['stash', 'pop', ref]))
}

export async function stashDrop(repo: string, ref: string): Promise<void> {
  requireStashRef(ref)
  await runGit(repo, ['stash', 'drop', ref])
}
