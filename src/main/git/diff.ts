import type { ChangeKind, DiffTarget, FileChange, StashFile } from '../../shared/model'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_BLOB_BYTES, type FileBlob, type FileSides } from '../../shared/viewers'
import { runGit, runGitBytes } from './exec'

const DIFF_FLAGS = ['--no-color', '--no-ext-diff'] as const

const NAME_STATUS_KINDS: Record<string, ChangeKind> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
}

/** Parse `git diff --name-status -z` output. */
export function parseNameStatus(raw: string): FileChange[] {
  const tokens = raw.split('\0').filter((token) => token !== '')
  const changes: FileChange[] = []
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]!
    const kind = NAME_STATUS_KINDS[code[0] ?? '']
    if (code.startsWith('R') || code.startsWith('C')) {
      const origPath = tokens[++i]!
      const path = tokens[++i]!
      changes.push({ path, origPath, kind: kind! })
    } else if (kind) {
      changes.push({ path: tokens[++i]!, kind })
    }
  }
  return changes
}

/** Hash of the empty tree in this repository's object format (SHA-1 or SHA-256). */
export const emptyTree = async (repo: string): Promise<string> =>
  (await runGit(repo, ['hash-object', '-t', 'tree', '/dev/null'])).trim()

export async function hasRevision(repo: string, revision: string): Promise<boolean> {
  // No `^{commit}` peel: git resolves e.g. `stash@{1}^3^{commit}` to the stash itself even without a third parent.
  const out = await runGit(repo, ['rev-parse', '-q', '--verify', revision], { okExitCodes: [1] })
  return out.trim() !== ''
}

/** A commit's own hash followed by its parent hashes. */
const commitWithParents = async (repo: string, revision: string): Promise<string[]> =>
  (await runGit(repo, ['rev-list', '--parents', '-n', '1', revision])).trim().split(' ')

/**
 * A stash commit's parents are: 1 = HEAD when stashed, 2 = the index, 3 = untracked files (only with -u).
 * Resolving to hashes once also pins the stash while `stash@{n}` numbering shifts.
 */
const stashParts = async (repo: string, ref: string) => {
  const [stash, head, , untracked] = await commitWithParents(repo, ref)
  if (!stash || !head) throw new Error(`${ref} is not a stash`)
  return { stash, head, untracked: untracked ?? null }
}

/** The tree a commit is compared against: its first parent, or the empty tree for a root commit. */
const baseOf = async (repo: string, hash: string): Promise<string> => {
  const [, firstParent] = await commitWithParents(repo, hash)
  return firstParent ?? emptyTree(repo)
}

const changedFiles = async (repo: string, from: string, to: string): Promise<FileChange[]> =>
  parseNameStatus(await runGit(repo, ['diff', '-z', '--name-status', '-M', from, to]))

export async function readCommitFiles(repo: string, hash: string): Promise<FileChange[]> {
  return changedFiles(repo, await baseOf(repo, hash), hash)
}

export async function readStashFiles(repo: string, ref: string): Promise<StashFile[]> {
  const parts = await stashParts(repo, ref)
  const tracked = await changedFiles(repo, parts.head, parts.stash)
  const untracked = parts.untracked
    ? (await runGit(repo, ['ls-tree', '-r', '-z', '--name-only', parts.untracked]))
        .split('\0')
        .filter((path) => path !== '')
    : []
  return [
    ...tracked.map((change) => ({ ...change, untracked: false })),
    ...untracked.map((path): StashFile => ({ path, kind: 'added', untracked: true }))
  ]
}

const pathspec = (path: string, origPath?: string): string[] =>
  origPath ? ['--', origPath, path] : ['--', path]

const workingDiff = (repo: string, path: string, staged: boolean, untracked: boolean): Promise<string> => {
  if (untracked) {
    // --no-index exits with 1 when the files differ, which is always the case here.
    return runGit(repo, ['diff', ...DIFF_FLAGS, '--no-index', '--', '/dev/null', path], { okExitCodes: [1] })
  }
  return runGit(repo, ['diff', ...DIFF_FLAGS, ...(staged ? ['--cached'] : []), '--', path])
}

/** Unified diff text for one file of the working tree, a commit or a stash. */
export async function readDiff(repo: string, target: DiffTarget): Promise<string> {
  switch (target.kind) {
    case 'working':
      return workingDiff(repo, target.path, target.staged, target.untracked)
    case 'commit': {
      const base = await baseOf(repo, target.hash)
      return runGit(repo, ['diff', ...DIFF_FLAGS, '-M', base, target.hash, ...pathspec(target.path, target.origPath)])
    }
    case 'stash': {
      const parts = await stashParts(repo, target.ref)
      if (target.untracked) {
        if (!parts.untracked) throw new Error(`${target.ref} has no untracked files`)
        return runGit(repo, ['diff', ...DIFF_FLAGS, await emptyTree(repo), parts.untracked, '--', target.path])
      }
      return runGit(repo, [
        'diff',
        ...DIFF_FLAGS,
        '-M',
        parts.head,
        parts.stash,
        ...pathspec(target.path, target.origPath)
      ])
    }
  }
}

const toBlob = (size: number, bytes: Buffer): FileBlob => ({
  size,
  base64: bytes.subarray(0, MAX_BLOB_BYTES).toString('base64'),
  truncated: size > MAX_BLOB_BYTES
})

/** A blob at `rev:path` (or `:path` for the index); null when it does not exist there. */
async function gitBlob(repo: string, spec: string): Promise<FileBlob | null> {
  const size = (await runGit(repo, ['cat-file', '-s', spec], { okExitCodes: [128] })).trim()
  if (!/^\d+$/.test(size)) return null
  if (Number(size) > MAX_BLOB_BYTES) return { size: Number(size), base64: '', truncated: true }
  return toBlob(Number(size), await runGitBytes(repo, ['cat-file', 'blob', spec], MAX_BLOB_BYTES + 1024))
}

async function workingBlob(repo: string, path: string): Promise<FileBlob | null> {
  const file = join(repo, path)
  try {
    const { size } = await stat(file)
    if (size > MAX_BLOB_BYTES) return { size, base64: '', truncated: true }
    return toBlob(size, await readFile(file))
  } catch {
    return null
  }
}

/** The before/after bytes of one file for a diff target, for viewers of non-text content. */
export async function readFileSides(repo: string, target: DiffTarget): Promise<FileSides> {
  switch (target.kind) {
    case 'working': {
      if (target.untracked) return { old: null, new: await workingBlob(repo, target.path) }
      if (target.staged) {
        return { old: await gitBlob(repo, `HEAD:${target.path}`), new: await gitBlob(repo, `:${target.path}`) }
      }
      return { old: await gitBlob(repo, `:${target.path}`), new: await workingBlob(repo, target.path) }
    }
    case 'commit': {
      const base = await baseOf(repo, target.hash)
      return {
        old: await gitBlob(repo, `${base}:${target.origPath ?? target.path}`),
        new: await gitBlob(repo, `${target.hash}:${target.path}`)
      }
    }
    case 'stash': {
      const parts = await stashParts(repo, target.ref)
      if (target.untracked) {
        return { old: null, new: parts.untracked ? await gitBlob(repo, `${parts.untracked}:${target.path}`) : null }
      }
      return {
        old: await gitBlob(repo, `${parts.head}:${target.origPath ?? target.path}`),
        new: await gitBlob(repo, `${parts.stash}:${target.path}`)
      }
    }
  }
}
