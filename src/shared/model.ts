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
export interface Profile {
  id: string
  name: string
  email: string
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
