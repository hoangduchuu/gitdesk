import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseGitmodules, parseSubmoduleStatus } from '../../shared/submodule-parse'
import type { Submodule } from '../../shared/model'
import { runGit, type RunOptions } from './exec'

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** The repository's submodules with their state; empty when it has none. */
export async function readSubmodules(repo: string): Promise<Submodule[]> {
  const lines = parseSubmoduleStatus(await runGit(repo, ['submodule', 'status']))
  if (lines.length === 0) return []
  const configured = (await exists(join(repo, '.gitmodules')))
    ? parseGitmodules(await runGit(repo, ['config', '--file', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.(path|url)$'], { okExitCodes: [1] }))
    : new Map()
  return Promise.all(
    lines.map(async (line): Promise<Submodule> => {
      const entry = configured.get(line.path)
      // Only a checked-out submodule can have local changes; an empty folder reports the parent's status.
      const dirty =
        line.state !== 'uninitialized' &&
        (await exists(join(repo, line.path, '.git'))) &&
        (await runGit(join(repo, line.path), ['status', '--porcelain']).catch(() => '')).trim() !== ''
      return { ...line, name: entry?.name ?? null, url: entry?.url ?? null, dirty }
    })
  )
}

/**
 * Clone what is missing and check out the recorded commits, for one submodule or all of them
 * (nested ones included). Local changes inside a submodule are never overwritten: git refuses.
 */
export async function updateSubmodules(repo: string, path: string | null, options: RunOptions = {}): Promise<void> {
  if (path !== null && !(await readSubmodules(repo)).some((submodule) => submodule.path === path)) {
    throw new Error('That folder is not a submodule of this repository')
  }
  await runGit(repo, ['submodule', 'update', '--init', '--recursive', ...(path === null ? [] : ['--', path])], options)
}
