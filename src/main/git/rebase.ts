import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MergeOutcome, RebaseStep } from '../../shared/model'
import type { Commit } from '../../shared/types'
import { allowConflicts } from './conflict'
import { GitError, runGit } from './exec'
import { readCommits } from './log'
import { cleanupRebaseFiles, rebaseWorkDir } from './rebase-files'
import { readStatus } from './status'
/** git never opens an editor for these commands. */
const NO_EDITOR = { GIT_EDITOR: 'true' } as const

const isAncestor = async (repo: string, base: string): Promise<boolean> => {
  try {
    await runGit(repo, ['merge-base', '--is-ancestor', base, 'HEAD'])
    return true
  } catch (error) {
    // Exit code 1 means "not an ancestor"; anything else is a real failure.
    if (error instanceof GitError && error.exitCode === 1) return false
    throw error
  }
}

/** Commits that an interactive rebase onto `base` would replay, oldest first. */
export async function readRebaseCommits(repo: string, base: string): Promise<Commit[]> {
  if (!(await isAncestor(repo, base))) throw new Error('The selected commit is not an ancestor of HEAD')
  const commits = await readCommits(repo, ['--reverse', '--topo-order', `${base}..HEAD`])
  if (commits.length === 0) throw new Error('There are no commits after the selected commit')
  if (commits.some((commit) => commit.parents.length > 1)) {
    throw new Error('The range contains merge commits; interactive rebase would flatten them')
  }
  return commits
}

/** Quote for the POSIX shell git uses to run `exec` lines. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

const validateSteps = (steps: readonly RebaseStep[], commits: readonly Commit[]): void => {
  const expected = new Set(commits.map((commit) => commit.hash))
  const given = new Set(steps.map((step) => step.hash))
  if (steps.length !== expected.size || given.size !== expected.size || [...given].some((hash) => !expected.has(hash))) {
    throw new Error('The plan must list every commit after the base exactly once')
  }
  const firstKept = steps.find((step) => step.action !== 'drop')
  if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')) {
    throw new Error('The first kept commit cannot be squashed into a previous one')
  }
  for (const step of steps) {
    if (step.action === 'reword' && (step.message ?? '').trim() === '') throw new Error('A reworded commit needs a message')
  }
}

const todoLines = async (steps: readonly RebaseStep[], dir: string): Promise<string[]> => {
  const lines: string[] = []
  for (const [index, step] of steps.entries()) {
    if (step.action !== 'reword') {
      lines.push(`${step.action} ${step.hash}`)
      continue
    }
    const messageFile = join(dir, `message-${index}.txt`)
    await writeFile(messageFile, `${step.message!.trim()}\n`, 'utf8')
    lines.push(`pick ${step.hash}`, `exec git commit --amend --quiet -F ${shellQuote(messageFile)}`)
  }
  return lines
}

/** Replay the commits after `base` following `steps` (in the order given, oldest first). */
export async function interactiveRebase(repo: string, base: string, steps: readonly RebaseStep[]): Promise<MergeOutcome> {
  const status = await readStatus(repo)
  if (status.operation !== null) throw new Error(`Finish the ${status.operation} in progress first`)
  if (status.staged.length > 0 || status.unstaged.some((change) => change.kind !== 'untracked')) {
    throw new Error('Commit or stash your changes before rebasing')
  }
  validateSteps(steps, await readRebaseCommits(repo, base))

  await cleanupRebaseFiles(repo)
  const dir = await rebaseWorkDir(repo)
  await mkdir(dir, { recursive: true })
  const todo = join(dir, 'todo')
  await writeFile(todo, `${(await todoLines(steps, dir)).join('\n')}\n`, 'utf8')

  const outcome = await allowConflicts(repo, () =>
    runGit(repo, ['rebase', '-i', base], {
      // git runs the sequence editor through the shell with the todo path appended.
      env: { ...NO_EDITOR, GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todo)}` }
    })
  )
  if (!outcome.conflicts) await cleanupRebaseFiles(repo)
  return outcome
}
