import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ChangeKind,
  ConflictKind,
  FileChange,
  Operation,
  WorkingTreeStatus
} from '../../shared/model'
import { runGit } from './exec'

const CHANGE_KINDS: Record<string, ChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
}

const CONFLICT_KINDS: Record<string, ConflictKind> = {
  UU: 'both-modified',
  AA: 'both-added',
  DD: 'both-deleted',
  AU: 'added-by-us',
  UA: 'added-by-them',
  DU: 'deleted-by-us',
  UD: 'deleted-by-them'
}

/** Fields before the path in porcelain v2 entries: type, XY, sub, modes, hashes (and score for renames). */
const PATH_FIELD = { ordinary: 8, renamed: 9, unmerged: 10 } as const

const change = (code: string, path: string, origPath?: string): FileChange | null => {
  const kind = CHANGE_KINDS[code]
  if (!kind) return null
  return origPath === undefined ? { path, kind } : { path, origPath, kind }
}

const fieldsFrom = (entry: string, index: number): string => entry.split(' ').slice(index).join(' ')

type Parsed = Omit<WorkingTreeStatus, 'operation'>

/** Parse `git status --porcelain=v2 --branch -z` output. */
export function parseStatus(raw: string): Parsed {
  const status: Parsed = {
    branch: null,
    unborn: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicted: []
  }
  const tokens = raw.split('\0')

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]!
    if (entry === '') continue
    const [type, xy = ''] = entry.split(' ')

    if (type === '#') {
      const [, key, ...rest] = entry.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.unborn = value === '(initial)'
      if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      if (key === 'branch.upstream') status.upstream = value
      if (key === 'branch.ab') {
        const [ahead = '+0', behind = '-0'] = rest
        status.ahead = Number(ahead.slice(1))
        status.behind = Number(behind.slice(1))
      }
      continue
    }

    if (type === '?') {
      status.unstaged.push({ path: entry.slice(2), kind: 'untracked' })
      continue
    }

    if (type === 'u') {
      const kind = CONFLICT_KINDS[xy]
      if (kind) status.conflicted.push({ path: fieldsFrom(entry, PATH_FIELD.unmerged), kind })
      continue
    }

    if (type === '1' || type === '2') {
      const isRename = type === '2'
      const path = fieldsFrom(entry, isRename ? PATH_FIELD.renamed : PATH_FIELD.ordinary)
      // With -z the original path of a rename is the next NUL-separated token.
      const origPath = isRename ? tokens[++i] : undefined
      const staged = change(xy[0] ?? '.', path, origPath)
      const unstaged = change(xy[1] ?? '.', path)
      if (staged) status.staged.push(staged)
      if (unstaged) status.unstaged.push(unstaged)
    }
  }
  return status
}

const OPERATION_MARKERS: ReadonlyArray<[string, Operation]> = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert']
]

export const gitDir = async (repo: string): Promise<string> =>
  (await runGit(repo, ['rev-parse', '--absolute-git-dir'])).trim()

export async function currentOperation(repo: string): Promise<Operation | null> {
  const dir = await gitDir(repo)
  const hit = OPERATION_MARKERS.find(([marker]) => existsSync(join(dir, marker)))
  return hit ? hit[1] : null
}

export async function readStatus(repo: string): Promise<WorkingTreeStatus> {
  const [raw, operation] = await Promise.all([
    runGit(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
    currentOperation(repo)
  ])
  return { ...parseStatus(raw), operation }
}
