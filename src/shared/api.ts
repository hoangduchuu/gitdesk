import type { HunkSelection } from './partial-patch'
import type {
  Branch,
  ConflictDetail,
  ConflictSide,
  DiffTarget,
  FileChange,
  GithubDeviceLogin,
  GitflowConfig,
  GitflowKind,
  GitflowState,
  MergeOutcome,
  Profile,
  ProfileAuth,
  ProfileAuthState,
  ProfileInput,
  ProfileState,
  PublishInput,
  PublishResult,
  RemoteState,
  RewordResult,
  RebaseStep,
  Stash,
  StashFile,
  Tag,
  WorkingTreeStatus
} from './model'
import type { Commit, RepoInfo, Result } from './types'

type Async<T> = Promise<Result<T>>

export type ResetMode = 'soft' | 'mixed' | 'hard'

/** Stage, unstage or discard selected hunks/lines of one tracked file. */
export interface SelectionRequest {
  path: string
  source: 'unstaged' | 'staged'
  action: 'stage' | 'unstage' | 'discard'
  selections: HunkSelection[]
  /** The diff text the selection was made on; refused if the file changed since. */
  expectedDiff: string
}

/** API exposed to the renderer through the preload bridge. Every call takes the repo path first. */
export interface GitDeskApi {
  openRepoDialog(): Async<RepoInfo | null>
  /** Tabs restored from the last session, plus any repository passed with --repo=<path>. */
  getWorkspace(): Async<Workspace>
  getRecentRepos(): Async<RecentRepo[]>
  /** Reopen a repository from the recent list or saved tabs, without a dialog. */
  openRecentRepo(path: string): Async<RepoInfo>
  /** Remember the open tabs (repository paths, left to right) and the selected one. */
  saveTabs(paths: string[], active: number): Async<null>

  /** How each commit profile is connected to a git provider, for fetch, pull and push. */
  getProfileAuth(): Async<ProfileAuthState>
  /** Begin a GitHub browser sign-in: opens github.com and returns the code to enter there. */
  githubLoginStart(): Async<GithubDeviceLogin>
  /** Resolves once the code is approved; connects that profile to the GitHub account. */
  githubLoginComplete(profileId: string): Async<ProfileAuth>
  githubLoginCancel(): Async<null>
  /** Connect a profile to any HTTPS git server (GitLab, Gitea, self-hosted...) with an access token. */
  setProfileToken(profileId: string, host: string, username: string, token: string): Async<ProfileAuth>
  removeProfileAuth(profileId: string): Async<null>

  getLog(repo: string, limit: number): Async<Commit[]>
  getStatus(repo: string): Async<WorkingTreeStatus>
  getBranches(repo: string): Async<Branch[]>
  getStashes(repo: string): Async<Stash[]>
  getCommitFiles(repo: string, hash: string): Async<FileChange[]>
  getStashFiles(repo: string, ref: string): Async<StashFile[]>
  getDiff(repo: string, target: DiffTarget): Async<string>

  stage(repo: string, paths: string[]): Async<null>
  unstage(repo: string, paths: string[]): Async<null>
  discard(repo: string, changes: FileChange[]): Async<null>
  commit(repo: string, message: string, amend: boolean): Async<null>
  /** Change the message of a commit on the current branch (rewrites it and everything after it). */
  rewordCommit(repo: string, hash: string, message: string): Async<RewordResult>

  createBranch(repo: string, name: string, startPoint: string | null, checkout: boolean): Async<null>
  checkoutBranch(repo: string, name: string, kind: Branch['kind']): Async<null>
  deleteBranch(repo: string, name: string, force: boolean): Async<null>
  mergeBranch(repo: string, name: string): Async<MergeOutcome>
  /** Drag and drop: merge `source` into the local branch `target` (checking it out first if needed). */
  mergeBranchInto(repo: string, source: string, target: string): Async<MergeOutcome>
  /** Drag and drop: rebase the local branch `branch` onto `onto`. */
  rebaseBranch(repo: string, branch: string, onto: string): Async<MergeOutcome>

  getRemotes(repo: string): Async<RemoteState>
  addRemote(repo: string, name: string, url: string): Async<null>
  setRemoteUrl(repo: string, name: string, url: string): Async<null>
  /** Forget a remote and its remote-tracking branches here; nothing changes on the server. */
  removeRemote(repo: string, name: string): Async<null>
  /** Create a repository on the profile's git provider, add it as a remote and push the current branch. */
  publishRepository(repo: string, input: PublishInput): Async<PublishResult>

  fetch(repo: string): Async<null>
  pull(repo: string): Async<MergeOutcome>
  /** `force` replaces the remote branch, but only if nobody pushed to it since the last fetch. */
  push(repo: string, force: boolean): Async<null>

  stashPush(repo: string, message: string, includeUntracked: boolean): Async<null>
  stashApply(repo: string, ref: string): Async<MergeOutcome>
  stashPop(repo: string, ref: string): Async<MergeOutcome>
  stashDrop(repo: string, ref: string): Async<null>

  cherryPick(repo: string, hashes: string[]): Async<MergeOutcome>
  revertCommit(repo: string, hash: string): Async<MergeOutcome>
  resetTo(repo: string, hash: string, mode: ResetMode): Async<null>
  checkoutCommit(repo: string, hash: string): Async<null>

  getTags(repo: string): Async<Tag[]>
  createTag(repo: string, name: string, hash: string, message: string | null): Async<null>
  deleteTag(repo: string, name: string): Async<null>
  pushTag(repo: string, name: string): Async<null>
  deleteRemoteTag(repo: string, name: string): Async<null>
  renameBranch(repo: string, from: string, to: string): Async<null>
  deleteRemoteBranch(repo: string, name: string): Async<null>

  applySelection(repo: string, request: SelectionRequest): Async<null>

  getRebaseCommits(repo: string, base: string): Async<Commit[]>
  interactiveRebase(repo: string, base: string, steps: RebaseStep[]): Async<MergeOutcome>

  getGitflow(repo: string): Async<GitflowState>
  initGitflow(repo: string, config: GitflowConfig): Async<null>
  startGitflow(repo: string, kind: GitflowKind, name: string): Async<null>
  /** Merge a feature, release or hotfix where it belongs (tagging releases and hotfixes). */
  finishGitflow(repo: string, kind: GitflowKind, name: string, deleteBranch: boolean, tagMessage: string | null): Async<MergeOutcome>

  getProfiles(repo: string): Async<ProfileState>
  saveProfile(repo: string, input: ProfileInput): Async<Profile>
  deleteProfile(repo: string, id: string): Async<null>
  /** Choose the profile this repository commits with; null = git's own config. */
  setRepoProfile(repo: string, id: string | null): Async<null>

  /** Start a shell in the repository folder; output arrives through onTerminalEvent. */
  terminalStart(repo: string, cols: number, rows: number): Async<number>
  terminalWrite(repo: string, id: number, data: string): Async<null>
  terminalResize(repo: string, id: number, cols: number, rows: number): Async<null>
  terminalStop(repo: string, id: number): Async<null>

  readConflict(repo: string, path: string): Async<ConflictDetail>
  resolveConflict(repo: string, path: string, content: string): Async<null>
  resolveConflictWithSide(repo: string, path: string, side: ConflictSide): Async<null>
  continueOperation(repo: string): Async<MergeOutcome>
  abortOperation(repo: string): Async<null>
}

/** Methods that do not act on an already opened repository. */
export const APP_METHODS = [
  'openRepoDialog',
  'getWorkspace',
  'getRecentRepos',
  'openRecentRepo',
  'saveTabs',
  'getProfileAuth',
  'githubLoginStart',
  'githubLoginComplete',
  'githubLoginCancel',
  'setProfileToken',
  'removeProfileAuth'
] as const

export type RepoMethod = Exclude<keyof GitDeskApi, (typeof APP_METHODS)[number]>

export const REPO_METHODS = [
  'getLog',
  'getStatus',
  'getBranches',
  'getStashes',
  'getCommitFiles',
  'getStashFiles',
  'getDiff',
  'stage',
  'unstage',
  'discard',
  'commit',
  'rewordCommit',
  'createBranch',
  'checkoutBranch',
  'deleteBranch',
  'mergeBranch',
  'mergeBranchInto',
  'rebaseBranch',
  'getRemotes',
  'addRemote',
  'setRemoteUrl',
  'removeRemote',
  'publishRepository',
  'fetch',
  'pull',
  'push',
  'stashPush',
  'stashApply',
  'stashPop',
  'stashDrop',
  'cherryPick',
  'revertCommit',
  'resetTo',
  'checkoutCommit',
  'getTags',
  'createTag',
  'deleteTag',
  'pushTag',
  'deleteRemoteTag',
  'renameBranch',
  'deleteRemoteBranch',
  'applySelection',
  'getRebaseCommits',
  'interactiveRebase',
  'getGitflow',
  'initGitflow',
  'startGitflow',
  'finishGitflow',
  'getProfiles',
  'saveProfile',
  'deleteProfile',
  'setRepoProfile',
  'terminalStart',
  'terminalWrite',
  'terminalResize',
  'terminalStop',
  'readConflict',
  'resolveConflict',
  'resolveConflictWithSide',
  'continueOperation',
  'abortOperation'
] as const satisfies readonly RepoMethod[]

export const channelFor = (method: keyof GitDeskApi): string => `gitdesk:${method}`

export interface RecentRepo {
  path: string
  name: string
}

export interface Workspace {
  tabs: RepoInfo[]
  /** Index into tabs of the selected tab, or -1. */
  active: number
}

/** Main -> renderer: a repository was opened from another launch of the app. */
export const REPO_OPENED_CHANNEL = 'gitdesk:repo-opened'

/** Main -> renderer: a tab command chosen from the app menu or its shortcut. */
export const MENU_COMMAND_CHANNEL = 'gitdesk:menu-command'

export type MenuCommand = 'newTab' | 'closeTab' | 'nextTab' | 'previousTab'

/** Main -> renderer: terminal output and exits. */
export const TERMINAL_EVENT_CHANNEL = 'gitdesk:terminal-event'

export type TerminalEvent = { kind: 'data'; id: number; data: string } | { kind: 'exit'; id: number; code: number }

/** Events the main process pushes to the renderer (not request/response). Each returns an unsubscribe function. */
export interface GitDeskEvents {
  onRepoOpened(listener: (result: Result<RepoInfo | null>) => void): () => void
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}

type UnlistedMethods = Exclude<RepoMethod, (typeof REPO_METHODS)[number]>
/** Compile-time check that every repo method is bridged. */
export const ALL_REPO_METHODS_LISTED: [UnlistedMethods] extends [never] ? true : never = true
