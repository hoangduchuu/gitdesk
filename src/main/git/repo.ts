import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { RepoInfo } from '../../shared/types'
import { GitError, runGit } from './exec'

const currentBranch = async (repoPath: string): Promise<string | null> => {
  try {
    const out = await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'])
    return out.trim() || null
  } catch (error) {
    // Exit code 1 means a detached HEAD, which is a valid state.
    if (error instanceof GitError && error.exitCode === 1) return null
    throw error
  }
}

/** Resolve any folder inside a working tree to its repository root. */
export async function resolveRepo(folder: string): Promise<RepoInfo> {
  if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`)
  const top = (await runGit(folder, ['rev-parse', '--show-toplevel'])).trim()
  return { path: top, name: basename(top), head: await currentBranch(top) }
}
