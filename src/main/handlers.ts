import type { GitDeskApi, RepoMethod } from '../shared/api'
import type { Result } from '../shared/types'
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  mergeBranch,
  readBranches,
  renameBranch
} from './git/branches'
import {
  abortOperation,
  continueOperation,
  readConflict,
  resolveConflict,
  resolveConflictWithSide
} from './git/conflict'
import { readCommitFiles, readDiff, readStashFiles } from './git/diff'
import { checkoutCommit, cherryPick, resetTo, revertCommit } from './git/history'
import { applySelection } from './git/partial'
import { interactiveRebase, readRebaseCommits } from './git/rebase'
import { createTag, deleteRemoteTag, deleteTag, pushTag, readTags } from './git/tags'
import { readLog } from './git/log'
import { fetch, pull, push } from './git/remote'
import { readStashes, requireStashRef, stashApply, stashDrop, stashPop, stashPush } from './git/stash'
import { readStatus } from './git/status'
import { commit, discard, gitIdentity, stage, unstage } from './git/worktree'
import type { ProfileStore } from './profiles'
import type { TerminalManager } from './terminal'
import {
  requireBoolean,
  requireBranchKind,
  requireDiffTarget,
  requireFileChanges,
  requireHash,
  requireHashes,
  requireNullableString,
  requireProfileInput,
  requireRebaseSteps,
  requireResetMode,
  requireSelectionRequest,
  requireInteger,
  requireNullableHash,
  requirePaths,
  requireRepoPath,
  requireSide,
  requireString
} from './validate'

const MAX_LOG_LIMIT = 50_000
const MAX_TERMINAL_SIZE = 1000
/** Pasting more than this at once is refused rather than flooding the shell. */
const MAX_TERMINAL_INPUT = 1_000_000

type Data<M extends RepoMethod> = Awaited<ReturnType<GitDeskApi[M]>> extends Result<infer T> ? T : never

/** One handler per bridged method. Arguments are untrusted and validated here. */
export type RepoHandlers = {
  [M in RepoMethod]: (repo: string, ...args: unknown[]) => Promise<Data<M>>
}

const stashRef = (value: unknown): string => {
  const ref = requireString(value, 'stash reference')
  requireStashRef(ref)
  return ref
}

const done = async (work: Promise<unknown>): Promise<null> => {
  await work
  return null
}

/** IPC handlers; profiles live in `profiles`, shells in `terminals`. */
export const createHandlers = (profiles: ProfileStore, terminals: TerminalManager): RepoHandlers => ({
  getLog: async (repo, limit) => readLog(repo, requireInteger(limit, 'log limit', 1, MAX_LOG_LIMIT)),
  getStatus: async (repo) => readStatus(repo),
  getBranches: async (repo) => readBranches(repo),
  getStashes: async (repo) => readStashes(repo),
  getCommitFiles: async (repo, hash) => readCommitFiles(repo, requireHash(hash)),
  getStashFiles: async (repo, ref) => readStashFiles(repo, stashRef(ref)),
  getDiff: async (repo, target) => {
    const checked = requireDiffTarget(repo, target)
    if (checked.kind === 'stash') requireStashRef(checked.ref)
    return readDiff(repo, checked)
  },

  stage: async (repo, paths) => done(stage(repo, requirePaths(repo, paths))),
  unstage: async (repo, paths) => done(unstage(repo, requirePaths(repo, paths))),
  discard: async (repo, changes) => done(discard(repo, requireFileChanges(repo, changes))),
  commit: async (repo, message, amend) =>
    done(
      commit(repo, requireString(message, 'commit message'), requireBoolean(amend, 'amend flag'), await profiles.repoProfile(repo))
    ),

  createBranch: async (repo, name, startPoint, checkout) =>
    done(
      createBranch(
        repo,
        requireString(name, 'branch name'),
        requireNullableHash(startPoint),
        requireBoolean(checkout, 'checkout flag')
      )
    ),
  checkoutBranch: async (repo, name, kind) =>
    done(checkoutBranch(repo, requireString(name, 'branch name'), requireBranchKind(kind))),
  deleteBranch: async (repo, name, force) =>
    done(deleteBranch(repo, requireString(name, 'branch name'), requireBoolean(force, 'force flag'))),
  mergeBranch: async (repo, name) => mergeBranch(repo, requireString(name, 'branch name')),

  fetch: async (repo) => done(fetch(repo)),
  pull: async (repo) => pull(repo),
  push: async (repo) => done(push(repo)),

  stashPush: async (repo, message, includeUntracked) =>
    done(
      stashPush(repo, requireString(message, 'stash message'), requireBoolean(includeUntracked, 'untracked flag'))
    ),
  stashApply: async (repo, ref) => stashApply(repo, stashRef(ref)),
  stashPop: async (repo, ref) => stashPop(repo, stashRef(ref)),
  stashDrop: async (repo, ref) => done(stashDrop(repo, stashRef(ref))),

  cherryPick: async (repo, hashes) => cherryPick(repo, requireHashes(hashes)),
  revertCommit: async (repo, hash) => revertCommit(repo, requireHash(hash)),
  resetTo: async (repo, hash, mode) => done(resetTo(repo, requireHash(hash), requireResetMode(mode))),
  checkoutCommit: async (repo, hash) => done(checkoutCommit(repo, requireHash(hash))),

  getTags: async (repo) => readTags(repo),
  createTag: async (repo, name, hash, message) =>
    done(
      createTag(repo, requireString(name, 'tag name'), requireHash(hash), requireNullableString(message, 'tag message'))
    ),
  deleteTag: async (repo, name) => done(deleteTag(repo, requireString(name, 'tag name'))),
  pushTag: async (repo, name) => done(pushTag(repo, requireString(name, 'tag name'))),
  deleteRemoteTag: async (repo, name) => done(deleteRemoteTag(repo, requireString(name, 'tag name'))),
  renameBranch: async (repo, from, to) =>
    done(renameBranch(repo, requireString(from, 'branch name'), requireString(to, 'branch name'))),
  deleteRemoteBranch: async (repo, name) => done(deleteRemoteBranch(repo, requireString(name, 'branch name'))),

  applySelection: async (repo, request) => done(applySelection(repo, requireSelectionRequest(repo, request))),

  getRebaseCommits: async (repo, base) => readRebaseCommits(repo, requireHash(base)),
  interactiveRebase: async (repo, base, steps) => interactiveRebase(repo, requireHash(base), requireRebaseSteps(steps)),

  getProfiles: async (repo) => {
    const [list, selected, identity] = await Promise.all([profiles.list(), profiles.repoProfile(repo), gitIdentity(repo)])
    return { profiles: list, selectedId: selected?.id ?? null, gitIdentity: identity }
  },
  saveProfile: async (_repo, input) => profiles.save(requireProfileInput(input)),
  deleteProfile: async (_repo, id) => done(profiles.remove(requireString(id, 'profile id'))),
  setRepoProfile: async (repo, id) => done(profiles.setRepoProfile(repo, requireNullableString(id, 'profile id'))),

  terminalStart: async (repo, cols, rows) =>
    terminals.start(repo, requireInteger(cols, 'columns', 2, MAX_TERMINAL_SIZE), requireInteger(rows, 'rows', 2, MAX_TERMINAL_SIZE)),
  terminalWrite: async (_repo, id, data) => {
    const text = requireString(data, 'terminal input')
    if (text.length > MAX_TERMINAL_INPUT) throw new Error('Terminal input is too large')
    terminals.write(requireInteger(id, 'terminal id', 1, Number.MAX_SAFE_INTEGER), text)
    return null
  },
  terminalResize: async (_repo, id, cols, rows) => {
    terminals.resize(
      requireInteger(id, 'terminal id', 1, Number.MAX_SAFE_INTEGER),
      requireInteger(cols, 'columns', 2, MAX_TERMINAL_SIZE),
      requireInteger(rows, 'rows', 2, MAX_TERMINAL_SIZE)
    )
    return null
  },
  terminalStop: async (_repo, id) => {
    terminals.stop(requireInteger(id, 'terminal id', 1, Number.MAX_SAFE_INTEGER))
    return null
  },

  readConflict: async (repo, path) => readConflict(repo, requireRepoPath(repo, path)),
  resolveConflict: async (repo, path, content) =>
    done(resolveConflict(repo, requireRepoPath(repo, path), requireString(content, 'file content'))),
  resolveConflictWithSide: async (repo, path, side) =>
    done(resolveConflictWithSide(repo, requireRepoPath(repo, path), requireSide(side))),
  continueOperation: async (repo) => continueOperation(repo),
  abortOperation: async (repo) => done(abortOperation(repo))
})
