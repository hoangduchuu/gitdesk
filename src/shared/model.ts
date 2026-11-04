import type { Commit } from './types'

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'

export interface FileChange {
  path: string
  /** Previous path for renames and copies. */
  origPath?: string
  kind: ChangeKind
}

export type ConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'deleted-by-us'
  | 'deleted-by-them'

export interface ConflictedFile {
  path: string
  kind: ConflictKind
}

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface WorkingTreeStatus {
  /** Current branch, or null when HEAD is detached. */
  branch: string | null
  /** True before the first commit exists. */
  unborn: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: ConflictedFile[]
  operation: Operation | null
}

export interface Branch {
  /** Short name, e.g. `main` or `origin/main`. */
  name: string
  kind: 'local' | 'remote'
  hash: string
  isHead: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** The upstream branch no longer exists on the remote. */
  upstreamGone: boolean
}

export interface ReflogEntry {
  /** Commit HEAD pointed at after this action. */
  hash: string
  /** Position selector such as `HEAD@{3}`. */
  selector: string
  /** What happened, e.g. `commit: add b` or `reset: moving to HEAD~1`. */
  action: string
  /** Unix seconds */
  time: number
}

export type SearchMode = 'message' | 'author' | 'content' | 'path'

/** One commit in a file's history, with the name the file had in it. */
export interface FileHistoryEntry {
  commit: Commit
  path: string
}

/** One checked-out working tree of a repository (`git worktree list`). */
export interface Worktree {
  path: string
  /** Commit checked out there; empty for a bare repository. */
  head: string
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null
  /** The original working tree, the one that holds the `.git` folder. It cannot be removed. */
  main: boolean
  locked: boolean
  /** Its folder is gone: `git worktree prune` would forget it. */
  prunable: boolean
}

export interface BlameLine {
  /** 1-based line number in the blamed file. */
  line: number
  /** Commit that last changed the line; all zeros for uncommitted changes. */
  hash: string
  author: string
  /** Unix seconds */
  time: number
  /** First line of that commit's message. */
  summary: string
  /** The file's path in that commit (differs from the current path after a rename). */
  path: string
  /** The oldest commit shown: the line may be older than the history git was asked about. */
  boundary: boolean
  text: string
}

export interface Tag {
  name: string
  /** Commit the tag points at. */
  hash: string
  annotated: boolean
  /** Annotation subject; null for lightweight tags. */
  message: string | null
}

export interface Stash {
  /** `stash@{n}` */
  ref: string
  hash: string
  /** Unix seconds */
  time: number
  /** Commit the stash was made on (its first parent). */
  base: string
  message: string
}

export interface StashFile extends FileChange {
  /** File was untracked when stashed (stored in the stash's third parent). */
  untracked: boolean
}

export type DiffTarget =
  | { kind: 'working'; path: string; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string; path: string; origPath?: string }
  | { kind: 'stash'; ref: string; path: string; origPath?: string; untracked: boolean }

export type ConflictSide = 'ours' | 'theirs'

export interface ConflictDetail {
  path: string
  kind: ConflictKind
  /** Working-tree file with conflict markers; null when deleted. */
  working: string | null
  ours: string | null
  theirs: string | null
  base: string | null
  binary: boolean
}

/** Outcome of operations that can stop on conflicts instead of failing. */
export interface MergeOutcome {
  conflicts: boolean
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseStep {
  hash: string
  action: RebaseAction
  /** New message, required for `reword`. */
  message?: string
}

/** A commit identity the user can switch between. */
/** How commits made with a profile are signed. */
export interface ProfileSigning {
  format: 'ssh' | 'openpgp'
  /** ssh: a key file path (e.g. `~/.ssh/id_ed25519.pub`) or a public key held by ssh-agent. openpgp: a key id. */
  key: string
}

export interface Profile {
  id: string
  name: string
  email: string
  /** Absent = commits are not signed by GitDesk (git's own `commit.gpgsign` still applies). */
  signing?: ProfileSigning
}

export type ProfileInput = Omit<Profile, 'id'> & { id?: string }

export interface ProfileState {
  profiles: Profile[]
  /** Profile this repository commits with; null means git's own user.name/user.email. */
  selectedId: string | null
  /** What git itself would use in this repository, for the "Git config" choice. */
  gitIdentity: { name: string | null; email: string | null }
}

/** What the user must do to approve a GitHub sign-in in the browser (OAuth device flow). */
export interface GithubDeviceLogin {
  userCode: string
  verificationUri: string
  /** Seconds until the code stops working. */
  expiresIn: number
}

/** The git provider a profile is connected to. The token itself never leaves the main process. */
export type ProfileAuth =
  | { kind: 'github'; login: string }
  | { kind: 'token'; host: string; username: string }

export interface ProfileAuthState {
  /** False when the build has no GitHub OAuth client ID, so browser sign-in cannot start. */
  githubConfigured: boolean
  /** Profile id -> its connection; profiles without one are not listed. */
  byProfile: Record<string, ProfileAuth>
}

export type GitflowKind = 'feature' | 'release' | 'hotfix'

/** Git Flow naming. Saved in git config under `gitflow.*`, so the git-flow command line agrees. */
export interface GitflowConfig {
  main: string
  develop: string
  /** Branch prefixes, e.g. `feature/`. */
  feature: string
  release: string
  hotfix: string
  /** Prefix for the tag made when finishing a release or hotfix; may be empty. */
  versionTag: string
}

export interface GitflowState {
  initialized: boolean
  /** The saved settings, or the defaults to start from. */
  config: GitflowConfig
  /** Local Git Flow branches by kind, names without the prefix. */
  open: Record<GitflowKind, string[]>
  /** The Git Flow branch that is checked out, if any. */
  current: { kind: GitflowKind; name: string } | null
}

export interface Remote {
  name: string
  /** URL as stored in the repository's config (git's `insteadOf` rewrites are not applied). */
  fetchUrl: string
  /** Where pushes go; differs from fetchUrl only when a separate push URL is configured. */
  pushUrl: string
}

export interface RemoteState {
  remotes: Remote[]
  /** How the profile this repository commits as is connected to a git provider; null when it is not. */
  connection: ProfileAuth | null
  /** Name of that profile, to tell the user which one to connect. */
  profileName: string | null
}

export type GitProvider = 'github' | 'gitlab' | 'gitea' | 'bitbucket'

/** Create a repository on a git provider, add it as a remote and push the current branch to it. */
export interface PublishInput {
  /** Name of the remote to add, e.g. `origin`. */
  remote: string
  provider: GitProvider
  /** Repository name on the provider. */
  name: string
  description: string
  private: boolean
}

export interface PublishResult {
  remote: string
  /** Address of the new repository in a browser. */
  webUrl: string
}

/** An open pull request on GitHub. */
export interface PullRequest {
  number: number
  title: string
  /** Login of the person who opened it. */
  author: string
  /** Branch with the changes. */
  head: string
  /** Branch they are meant to be merged into. */
  base: string
  /** Address in a browser. */
  url: string
  draft: boolean
}

export interface CreatePullRequestInput {
  title: string
  body: string
  head: string
  base: string
  draft: boolean
}

export interface RewordResult extends MergeOutcome {
  /** The commit was already on a remote branch, so pushing the rewritten history needs a force push. */
  published: boolean
}

/** Who made a commit and who recorded it; the two differ after a rebase, cherry-pick or a web merge. */
/** Result of checking a commit's signature on this computer. */
export type SignatureStatus = 'none' | 'good' | 'unverified' | 'bad'

export interface CommitDetails {
  /** Whether the commit is signed, and if so whether this computer can vouch for the signer. */
  signature: SignatureStatus
  hash: string
  authorName: string
  authorEmail: string
  /** Unix seconds */
  authorTime: number
  committerName: string
  committerEmail: string
  /** Unix seconds */
  committerTime: number
}

export interface UpdateInfo {
  current: string
  latest: string
  /** A newer release with a downloadable app exists. */
  available: boolean
  releaseUrl: string
  dmgUrl: string | null
}
