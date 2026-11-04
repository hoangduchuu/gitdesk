import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseWorktrees } from '../../shared/worktree-parse'
import type { Worktree } from '../../shared/model'
import { runGit } from './exec'

export async function readWorktrees(repo: string): Promise<Worktree[]> {
  return parseWorktrees(await runGit(repo, ['worktree', 'list', '--porcelain']))
}

/** The path with symlinks resolved (git reports real paths: /var is /private/var on macOS); a folder that does not exist yet is resolved through its parent. */
const real = (path: string): string => {
  const full = resolve(path)
  try {
    return realpathSync(full)
  } catch {
    const parent = dirname(full)
    return parent === full ? full : join(real(parent), full.slice(parent.length + 1))
  }
}

const samePath = (a: string, b: string): boolean => real(a) === real(b)

/**
 * Check out `branch` in a new folder next to the others. With `create`, `branch` is a new branch
 * started from the current HEAD; otherwise it must be an existing local branch that no other
 * worktree has checked out (git refuses that itself).
 */
export async function addWorktree(repo: string, path: string, branch: string, create: boolean): Promise<void> {
  if (!isAbsolute(path)) throw new Error('Choose a full folder path for the worktree')
  const listed = await readWorktrees(repo)
  if (listed.some((worktree) => samePath(worktree.path, path))) throw new Error('A worktree already exists in that folder')
  const gitDir = real((await runGit(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
  const inside = relative(gitDir, real(path))
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) throw new Error('A worktree cannot be inside the .git folder')
  // Reject names git would not accept as a branch (also anything starting with "-").
  await runGit(repo, ['check-ref-format', '--branch', branch])
  await runGit(repo, create ? ['worktree', 'add', '-b', branch, '--', path] : ['worktree', 'add', '--', path, branch])
}

/** The worktree of `repo` in this folder, if there is one. */
export async function findWorktree(repo: string, path: string): Promise<Worktree | null> {
  return (await readWorktrees(repo)).find((worktree) => samePath(worktree.path, path)) ?? null
}

/** Remove a linked worktree's folder. Local changes there are only discarded with `force`. */
export async function removeWorktree(repo: string, path: string, force: boolean): Promise<void> {
  const target = await findWorktree(repo, path)
  if (!target) throw new Error('That folder is not a worktree of this repository')
  if (target.main) throw new Error('The main working tree cannot be removed')
  await runGit(repo, ['worktree', 'remove', ...(force ? ['--force', '--force'] : []), '--', target.path])
}

/** Forget worktrees whose folders no longer exist. */
export async function pruneWorktrees(repo: string): Promise<void> {
  await runGit(repo, ['worktree', 'prune'])
}
