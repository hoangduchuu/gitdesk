import { parseBlame } from '../../shared/blame-parse'
import type { BlameLine } from '../../shared/model'
import { runGit } from './exec'

/**
 * Who last changed each line of `path`, as of `rev` (the working tree, with uncommitted lines
 * attributed to the all-zero hash, when null). `-M` and `-C` make lines moved or copied
 * within the file or to a new file credit the commit that first wrote them.
 */
export async function readBlame(repoPath: string, path: string, rev: string | null): Promise<BlameLine[]> {
  const out = await runGit(repoPath, ['blame', '--porcelain', '-M', '-C', ...(rev === null ? [] : [rev]), '--', path])
  return parseBlame(out)
}
