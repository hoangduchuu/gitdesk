import type { GitDeskApi, RepoMethod } from '../shared/api'
import type { Result } from '../shared/types'
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  mergeBranch,
  mergeBranchInto,
  rebaseBranch,
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
import { readCommitFiles, readDiff, readFileSides, readStashFiles } from './git/diff'
import { checkoutCommit, cherryPick, resetTo, revertCommit } from './git/history'
import { applySelection } from './git/partial'
import { interactiveRebase, readRebaseCommits } from './git/rebase'
import { finishGitflow, initGitflow, readGitflow, startGitflow } from './git/gitflow'
import { createTag, deleteRemoteTag, deleteTag, pushTag, readTags } from './git/tags'
import { readCommitDetails, readFileHistory, readLog } from './git/log'
import { readReflog } from './git/reflog'
import { readBlame } from './git/blame'
import { rewordCommit } from './git/reword'
import { addRemote, fetch, pull, push, readRemotes, removeRemote, setRemoteUrl } from './git/remote'
import { publishRepository } from './publish'
import { readStashes, requireStashRef, stashApply, stashDrop, stashPop, stashPush } from './git/stash'
import { readStatus } from './git/status'
import { commit, discard, gitIdentity, stage, unstage } from './git/worktree'
import type { AvatarService } from './avatars'
import type { Credentials } from './credentials'
import type { ProfileStore } from './profiles'
import type { TerminalManager } from './terminal'
import {
  requireBoolean,
  requireBranchKind,
  requireDiffTarget,
  requireFileChanges,
  requireGitflowConfig,
  requireGitflowKind,
  requireHash,
  requireHashes,
  requireNullableString,
  requireProfileInput,
  requirePublishInput,
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
/** A commit has an author and a committer; a few more leaves room for the caller. */
const MAX_AVATAR_EMAILS = 8
/** People asked about at once by the commit graph. */
const MAX_AVATAR_PEOPLE = 24
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
export const createHandlers = (
  profiles: ProfileStore,
  terminals: TerminalManager,
  /** Provider connections of the profiles; without it git runs with the user's own credentials. */
  credentials: Pick<Credentials, 'gitEnv' | 'remove' | 'status' | 'accessFor'> | null = null,
  /** Looks up author pictures; without it none are shown. */
  avatars: Pick<AvatarService, 'lookup' | 'lookupPeople'> | null = null
): RepoHandlers => {
  /** Remote commands authenticate as the profile the repository commits with. */
  const remoteEnv = async (repo: string): Promise<Record<string, string>> =>
    credentials ? credentials.gitEnv((await profiles.repoProfile(repo))?.id ?? null) : {}
  return {
  getLog: async (repo, limit) => readLog(repo, requireInteger(limit, 'log limit', 1, MAX_LOG_LIMIT)),
  getStatus: async (repo) => readStatus(repo),
  getBranches: async (repo) => readBranches(repo),
  getStashes: async (repo) => readStashes(repo),
  getFileHistory: async (repo, path, limit) =>
    readFileHistory(repo, requireRepoPath(repo, path), requireInteger(limit, 'history limit', 1, MAX_LOG_LIMIT)),
  getBlame: async (repo, path, rev) => readBlame(repo, requireRepoPath(repo, path), requireNullableHash(rev)),
  getReflog: async (repo, limit) => readReflog(repo, requireInteger(limit, 'reflog limit', 1, MAX_LOG_LIMIT)),
  getCommitDetails: async (repo, hash) => readCommitDetails(repo, requireHash(hash)),
  getAvatars: async (repo, hash, emails, gravatar) => {
    const commitHash = requireHash(hash)
    const list = Array.isArray(emails) ? emails.map((email) => requireString(email, 'email')) : []
    if (!Array.isArray(emails) || list.length > MAX_AVATAR_EMAILS || list.some((email) => email.length > 320)) throw new Error('Invalid emails')
    const useGravatar = requireBoolean(gravatar, 'Gravatar flag')
    if (!avatars) return Object.fromEntries(list.map((email) => [email, null]))
    const remotes = await readRemotes(repo)
    const remote = remotes.find((candidate) => candidate.name === 'origin') ?? remotes[0]
    const profile = await profiles.repoProfile(repo)
    return avatars.lookup({
      remoteUrl: remote?.fetchUrl ?? null,
      hash: commitHash,
      emails: list,
      gravatar: useGravatar,
      access: credentials ? await credentials.accessFor(profile?.id ?? null) : null
    })
  },
  getPeopleAvatars: async (repo, people, gravatar) => {
    if (!Array.isArray(people) || people.length > MAX_AVATAR_PEOPLE) throw new Error('Invalid people')
    const list = people.map((person: unknown) => {
      const entry = person as { email?: unknown; hash?: unknown } | null
      const email = requireString(entry?.email, 'email')
      if (email.length > 320) throw new Error('Invalid email')
      return { email, hash: requireHash(entry?.hash) }
    })
    const useGravatar = requireBoolean(gravatar, 'Gravatar flag')
    if (!avatars) return Object.fromEntries(list.map((person) => [person.email, null]))
    const remotes = await readRemotes(repo)
    const remote = remotes.find((candidate) => candidate.name === 'origin') ?? remotes[0]
    const profile = await profiles.repoProfile(repo)
    return avatars.lookupPeople({
      remoteUrl: remote?.fetchUrl ?? null,
      people: list,
      gravatar: useGravatar,
      access: credentials ? await credentials.accessFor(profile?.id ?? null) : null
    })
  },
  getCommitFiles: async (repo, hash) => readCommitFiles(repo, requireHash(hash)),
  getStashFiles: async (repo, ref) => readStashFiles(repo, stashRef(ref)),
  getDiff: async (repo, target, ignoreWhitespace) => {
    const checked = requireDiffTarget(repo, target)
    if (checked.kind === 'stash') requireStashRef(checked.ref)
    return readDiff(repo, checked, { ignoreWhitespace: ignoreWhitespace === true })
  },
  getFileSides: async (repo, target) => {
    const checked = requireDiffTarget(repo, target)
    if (checked.kind === 'stash') requireStashRef(checked.ref)
    return readFileSides(repo, checked)
  },

  stage: async (repo, paths) => done(stage(repo, requirePaths(repo, paths))),
  unstage: async (repo, paths) => done(unstage(repo, requirePaths(repo, paths))),
  discard: async (repo, changes) => done(discard(repo, requireFileChanges(repo, changes))),
  commit: async (repo, message, amend) =>
    done(
      commit(repo, requireString(message, 'commit message'), requireBoolean(amend, 'amend flag'), await profiles.repoProfile(repo))
    ),

  rewordCommit: async (repo, hash, message) =>
    rewordCommit(repo, requireHash(hash), requireString(message, 'commit message'), await profiles.repoProfile(repo)),

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
  mergeBranchInto: async (repo, source, target) =>
    mergeBranchInto(repo, requireString(source, 'branch name'), requireString(target, 'branch name')),
  rebaseBranch: async (repo, branch, onto) =>
    rebaseBranch(repo, requireString(branch, 'branch name'), requireString(onto, 'branch name')),
  mergeBranch: async (repo, name) => mergeBranch(repo, requireString(name, 'branch name')),

  getRemotes: async (repo) => {
    const [remotes, profile] = await Promise.all([readRemotes(repo), profiles.repoProfile(repo)])
    const connection = profile && credentials ? ((await credentials.status()).byProfile[profile.id] ?? null) : null
    return { remotes, connection, profileName: profile?.name ?? null }
  },
  addRemote: async (repo, name, url) => done(addRemote(repo, requireString(name, 'remote name').trim(), requireString(url, 'remote URL'))),
  setRemoteUrl: async (repo, name, url) => done(setRemoteUrl(repo, requireString(name, 'remote name'), requireString(url, 'remote URL'))),
  removeRemote: async (repo, name) => done(removeRemote(repo, requireString(name, 'remote name'))),
  publishRepository: async (repo, input) => {
    const request = requirePublishInput(input)
    const profile = await profiles.repoProfile(repo)
    const access = credentials ? await credentials.accessFor(profile?.id ?? null) : null
    if (access === null) {
      throw new Error('Connect the profile this repository commits as to GitHub or a git server first (Profiles), then choose it under "Commit as".')
    }
    return publishRepository(repo, request, access, await remoteEnv(repo))
  },

  fetch: async (repo) => done(fetch(repo, { env: await remoteEnv(repo) })),
  pull: async (repo) => pull(repo, { env: await remoteEnv(repo) }),
  push: async (repo, force) => done(push(repo, { env: await remoteEnv(repo) }, requireBoolean(force, 'force flag'))),

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

  getGitflow: async (repo) => readGitflow(repo),
  initGitflow: async (repo, config) => done(initGitflow(repo, requireGitflowConfig(config))),
  startGitflow: async (repo, kind, name) =>
    done(startGitflow(repo, requireGitflowKind(kind), requireString(name, 'branch name').trim())),
  finishGitflow: async (repo, kind, name, deleteBranch, tagMessage) =>
    finishGitflow(repo, requireGitflowKind(kind), requireString(name, 'branch name').trim(), {
      deleteBranch: requireBoolean(deleteBranch, 'delete flag'),
      tagMessage: requireNullableString(tagMessage, 'tag message')
    }),

  getProfiles: async (repo) => {
    const [list, selected, identity] = await Promise.all([profiles.list(), profiles.repoProfile(repo), gitIdentity(repo)])
    return { profiles: list, selectedId: selected?.id ?? null, gitIdentity: identity }
  },
  saveProfile: async (_repo, input) => profiles.save(requireProfileInput(input)),
  deleteProfile: async (_repo, id) => {
    const profileId = requireString(id, 'profile id')
    await profiles.remove(profileId)
    await credentials?.remove(profileId)
    return null
  },
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
  }
}
