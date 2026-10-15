import { readFile, writeFile } from 'node:fs/promises'
import type { ConflictDetail, ConflictSide, MergeOutcome } from '../../shared/model'
import { runGit } from './exec'
import { insideRepo } from './paths'
import { cleanupRebaseFiles } from './rebase-files'
import { currentOperation, readStatus } from './status'

export async function hasUnmergedFiles(repo: string): Promise<boolean> {
  const out = await runGit(repo, ['diff', '--name-only', '--diff-filter=U'])
  return out.trim() !== ''
}

/**
 * Run a merge-like command (merge, pull, stash apply). Stopping on conflicts is a
 * normal outcome the user resolves next, so it is reported instead of thrown.
 */
export async function allowConflicts(repo: string, run: () => Promise<unknown>): Promise<MergeOutcome> {
  try {
    await run()
    return { conflicts: false }
  } catch (error) {
    if (await hasUnmergedFiles(repo)) return { conflicts: true }
    throw error
  }
}

/** Stage numbers in the index during a conflict: 1 = common base, 2 = ours (HEAD), 3 = theirs. */
const STAGE = { base: 1, ours: 2, theirs: 3 } as const

const readStage = async (repo: string, stage: number, path: string): Promise<string | null> => {
  try {
    return await runGit(repo, ['show', `:${stage}:${path}`])
  } catch {
    return null // that side deleted the file, or there is no common base
  }
}

const readWorking = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

const looksBinary = (...contents: Array<string | null>): boolean =>
  contents.some((content) => content !== null && content.includes('\0'))

export async function readConflict(repo: string, path: string): Promise<ConflictDetail> {
  const status = await readStatus(repo)
  const entry = status.conflicted.find((file) => file.path === path)
  if (!entry) throw new Error(`${path} is not in conflict`)

  const [working, base, ours, theirs] = await Promise.all([
    readWorking(insideRepo(repo, path)),
    readStage(repo, STAGE.base, path),
    readStage(repo, STAGE.ours, path),
    readStage(repo, STAGE.theirs, path)
  ])
  return { path, kind: entry.kind, working, base, ours, theirs, binary: looksBinary(working, ours, theirs) }
}

/** Save the user's merged content and mark the file resolved. */
export async function resolveConflict(repo: string, path: string, content: string): Promise<void> {
  await writeFile(insideRepo(repo, path), content, 'utf8')
  await runGit(repo, ['add', '--', path])
}

/** Resolve by taking one side's whole file; if that side deleted it, the file is removed. */
export async function resolveConflictWithSide(repo: string, path: string, side: ConflictSide): Promise<void> {
  const content = await readStage(repo, side === 'ours' ? STAGE.ours : STAGE.theirs, path)
  if (content === null) {
    await runGit(repo, ['rm', '-q', '--', path])
    return
  }
  await runGit(repo, ['checkout', `--${side}`, '--', path])
  await runGit(repo, ['add', '--', path])
}

const cleanupWhenIdle = async (repo: string): Promise<void> => {
  if ((await currentOperation(repo)) === null) await cleanupRebaseFiles(repo)
}

/**
 * Finish the merge, rebase, cherry-pick or revert once every conflict is resolved.
 * A rebase or multi-commit cherry-pick can stop again on the next conflict.
 */
export async function continueOperation(repo: string): Promise<MergeOutcome> {
  if (await hasUnmergedFiles(repo)) throw new Error('Resolve all conflicted files first')
  const operation = await currentOperation(repo)
  if (operation === null) throw new Error('No merge, rebase, cherry-pick or revert is in progress')
  const args = operation === 'merge' ? ['commit', '--no-edit'] : [operation, '--continue']
  // GIT_EDITOR=true accepts the prepared message instead of opening an editor.
  const outcome = await allowConflicts(repo, () => runGit(repo, args, { env: { GIT_EDITOR: 'true' } }))
  await cleanupWhenIdle(repo)
  return outcome
}

export async function abortOperation(repo: string): Promise<void> {
  const operation = await currentOperation(repo)
  if (operation === null) throw new Error('No merge, rebase, cherry-pick or revert is in progress')
  await runGit(repo, [operation, '--abort'])
  await cleanupWhenIdle(repo)
}
