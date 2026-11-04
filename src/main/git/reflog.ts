import type { ReflogEntry } from '../../shared/model'
import { GitError, runGit } from './exec'

const FIELD = '\x1f'
const FORMAT = ['%H', '%gd', '%gs', '%ct'].join('%x1f')

/** Where HEAD has been, newest first. Empty for a repository without commits. */
export async function readReflog(repoPath: string, limit: number): Promise<ReflogEntry[]> {
  const out = await runGit(repoPath, ['reflog', 'show', '-z', `--format=${FORMAT}`, `--max-count=${limit}`, 'HEAD', '--']).catch(
    (error: unknown) => {
      // An unborn HEAD has no reflog: git reports an error instead of an empty list.
      if (error instanceof GitError && error.stderr.includes("bad revision 'HEAD'")) return ''
      throw error
    }
  )
  return out
    .split('\0')
    .filter((record) => record.length > 0)
    .flatMap((record): ReflogEntry[] => {
      const [hash, selector, action, time] = record.split(FIELD)
      if (!hash || !selector || action === undefined || time === undefined) return []
      return [{ hash, selector, action, time: Number(time) }]
    })
}
