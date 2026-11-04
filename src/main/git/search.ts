import type { SearchMode } from '../../shared/model'
import type { Commit } from '../../shared/types'
import { readCommits } from './log'

/**
 * Search the whole history of every branch and tag (not just the commits the graph has loaded).
 * The query is always taken literally: `a.c` does not match `abc`, and no pathspec or option
 * syntax in it is interpreted, because each mode hands it to git as part of one argument.
 *
 * - `message`: commit message contains the text (case-insensitive)
 * - `author`: author name or email contains the text (case-insensitive)
 * - `content`: the commit added or removed that exact text somewhere (git's pickaxe, `-S`)
 * - `path`: the commit touched this file, or any file inside this folder
 */
export function searchCommits(repoPath: string, mode: SearchMode, query: string, limit: number): Promise<Commit[]> {
  if (query === '') throw new Error('Nothing to search for')
  // --exclude only affects the --all that comes after it.
  const base = ['--exclude=refs/stash', '--all', `--max-count=${limit}`]
  switch (mode) {
    case 'message':
      return readCommits(repoPath, ['--fixed-strings', '--regexp-ignore-case', `--grep=${query}`, ...base])
    case 'author':
      return readCommits(repoPath, ['--fixed-strings', '--regexp-ignore-case', `--author=${query}`, ...base])
    case 'content':
      return readCommits(repoPath, [`-S${query}`, ...base])
    case 'path':
      return readCommits(repoPath, [...base, '--', `:(literal)${query}`])
  }
}
