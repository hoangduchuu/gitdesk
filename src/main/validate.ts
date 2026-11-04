import type { ResetMode, SelectionRequest } from '../shared/api'
import type {
  Branch,
  CreatePullRequestInput,
  ChangeKind,
  ConflictSide,
  DiffTarget,
  FileChange,
  GitflowConfig,
  GitflowKind,
  GitProvider,
  ProfileInput,
  PublishInput,
  RebaseAction,
  RebaseStep,
  SearchMode
} from '../shared/model'
import { insideRepo } from './git/paths'

// Everything arriving over IPC is untrusted: check shapes before it reaches git.

const fail = (what: string): never => {
  throw new Error(`Invalid ${what}`)
}

export const requireString = (value: unknown, what: string): string =>
  typeof value === 'string' ? value : fail(what)

export const requireBoolean = (value: unknown, what: string): boolean =>
  typeof value === 'boolean' ? value : fail(what)

export const requireInteger = (value: unknown, what: string, min: number, max: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fail(what)

const HASH = /^[0-9a-f]{7,64}$/
const SEARCH_MODES: readonly SearchMode[] = ['message', 'author', 'content', 'path']
export const requireSearchMode = (value: unknown): SearchMode =>
  SEARCH_MODES.includes(value as SearchMode) ? (value as SearchMode) : fail('search mode')

export const MAX_SEARCH_QUERY = 500
export const requireSearchQuery = (value: unknown): string => {
  const query = requireString(value, 'search text')
  return query.trim() === '' || query.length > MAX_SEARCH_QUERY || query.includes('\0') ? fail('search text') : query
}

const BRANCH_REF = /^[A-Za-z0-9._/-]{1,255}$/
const requireBranchName = (value: unknown, what: string): string => {
  const name = requireString(value, what)
  return BRANCH_REF.test(name) && !name.startsWith('-') && !name.includes('..') ? name : fail(what)
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
export const requirePullRequestInput = (value: unknown): CreatePullRequestInput => {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object') return fail('pull request')
  const title = requireString(input['title'], 'pull request title').trim()
  const body = requireString(input['body'], 'pull request description')
  if (title === '' || title.length > 256 || CONTROL.test(title) || title.includes('\n')) return fail('pull request title')
  if (body.length > 65_536 || CONTROL.test(body)) return fail('pull request description')
  return {
    title,
    body,
    head: requireBranchName(input['head'], 'pull request branch'),
    base: requireBranchName(input['base'], 'pull request base branch'),
    draft: requireBoolean(input['draft'], 'draft flag')
  }
}

export const requireHash = (value: unknown): string => {
  const hash = requireString(value, 'commit hash')
  return HASH.test(hash) ? hash : fail('commit hash')
}

export const requireRepoPath = (repo: string, value: unknown): string => {
  const path = requireString(value, 'path')
  insideRepo(repo, path)
  return path
}

export const requirePaths = (repo: string, value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) fail('path list')
  return (value as unknown[]).map((path) => requireRepoPath(repo, path))
}

const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'untracked']

export const requireFileChanges = (repo: string, value: unknown): FileChange[] => {
  if (!Array.isArray(value) || value.length === 0) fail('file list')
  return (value as unknown[]).map((item) => {
    const change = item as Partial<FileChange> | null
    if (!change || !CHANGE_KINDS.includes(change.kind as ChangeKind)) fail('file change')
    return { path: requireRepoPath(repo, change!.path), kind: change!.kind as ChangeKind }
  })
}

export const requireBranchKind = (value: unknown): Branch['kind'] =>
  value === 'local' || value === 'remote' ? value : fail('branch kind')

export const requireSide = (value: unknown): ConflictSide =>
  value === 'ours' || value === 'theirs' ? value : fail('conflict side')

export const requireNullableHash = (value: unknown): string | null => (value === null ? null : requireHash(value))

const optionalPath = (repo: string, value: unknown): string | undefined =>
  value === undefined ? undefined : requireRepoPath(repo, value)

export const requireDiffTarget = (repo: string, value: unknown): DiffTarget => {
  const target = value as Record<string, unknown> | null
  if (!target || typeof target !== 'object') return fail('diff target')
  const path = requireRepoPath(repo, target['path'])
  switch (target['kind']) {
    case 'working':
      return {
        kind: 'working',
        path,
        staged: requireBoolean(target['staged'], 'staged flag'),
        untracked: requireBoolean(target['untracked'], 'untracked flag')
      }
    case 'commit': {
      const origPath = optionalPath(repo, target['origPath'])
      return { kind: 'commit', hash: requireHash(target['hash']), path, ...(origPath ? { origPath } : {}) }
    }
    case 'stash': {
      const origPath = optionalPath(repo, target['origPath'])
      return {
        kind: 'stash',
        ref: requireString(target['ref'], 'stash reference'),
        path,
        untracked: requireBoolean(target['untracked'], 'untracked flag'),
        ...(origPath ? { origPath } : {})
      }
    }
    default:
      return fail('diff target kind')
  }
}

export const requireHashes = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) fail('commit list')
  return (value as unknown[]).map(requireHash)
}

const RESET_MODES: readonly ResetMode[] = ['soft', 'mixed', 'hard']
export const requireResetMode = (value: unknown): ResetMode =>
  RESET_MODES.includes(value as ResetMode) ? (value as ResetMode) : fail('reset mode')

export const requireNullableString = (value: unknown, what: string): string | null =>
  value === null ? null : requireString(value, what)

const requireLineIndexes = (value: unknown): number[] | null => {
  if (value === null) return null
  if (!Array.isArray(value) || value.length === 0) return fail('line selection')
  return (value as unknown[]).map((index) => requireInteger(index, 'line index', 0, 1_000_000))
}

export const requireSelectionRequest = (repo: string, value: unknown): SelectionRequest => {
  const request = value as Record<string, unknown> | null
  if (!request || typeof request !== 'object') return fail('selection')
  const source = request['source']
  const action = request['action']
  if (source !== 'unstaged' && source !== 'staged') return fail('selection source')
  if (action !== 'stage' && action !== 'unstage' && action !== 'discard') return fail('selection action')
  const selections = request['selections']
  if (!Array.isArray(selections) || selections.length === 0) return fail('hunk selection')
  return {
    path: requireRepoPath(repo, request['path']),
    source,
    action,
    selections: (selections as unknown[]).map((item) => {
      const selection = item as Record<string, unknown> | null
      if (!selection || typeof selection !== 'object') return fail('hunk selection')
      return {
        hunk: requireInteger(selection['hunk'], 'hunk index', 0, 1_000_000),
        lines: requireLineIndexes(selection['lines'])
      }
    }),
    expectedDiff: requireString(request['expectedDiff'], 'expected diff')
  }
}

const REBASE_ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop']
export const requireRebaseSteps = (value: unknown): RebaseStep[] => {
  if (!Array.isArray(value) || value.length === 0) fail('rebase plan')
  return (value as unknown[]).map((item) => {
    const step = item as Record<string, unknown> | null
    if (!step || typeof step !== 'object' || !REBASE_ACTIONS.includes(step['action'] as RebaseAction)) {
      return fail('rebase step')
    }
    const message = step['message']
    return {
      hash: requireHash(step['hash']),
      action: step['action'] as RebaseAction,
      ...(message === undefined ? {} : { message: requireString(message, 'commit message') })
    }
  })
}

export const requireProfileInput = (value: unknown): ProfileInput => {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object') return fail('profile')
  const id = input['id']
  return {
    ...(id === undefined ? {} : { id: requireString(id, 'profile id') }),
    name: requireString(input['name'], 'profile name'),
    email: requireString(input['email'], 'profile email')
  }
}

export const requireGitflowKind = (value: unknown): GitflowKind =>
  value === 'feature' || value === 'release' || value === 'hotfix' ? value : fail('Git Flow branch type')

export const requireGitflowConfig = (value: unknown): GitflowConfig => {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object') return fail('Git Flow settings')
  const field = (key: keyof GitflowConfig): string => requireString(input[key], `Git Flow ${key}`)
  return {
    main: field('main').trim(),
    develop: field('develop').trim(),
    feature: field('feature').trim(),
    release: field('release').trim(),
    hotfix: field('hotfix').trim(),
    versionTag: field('versionTag').trim()
  }
}

export const requirePublishInput = (value: unknown): PublishInput => {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object') return fail('publish request')
  const provider = input['provider']
  if (provider !== 'github' && provider !== 'gitlab' && provider !== 'gitea' && provider !== 'bitbucket') return fail('git provider')
  return {
    remote: requireString(input['remote'], 'remote name').trim(),
    provider: provider satisfies GitProvider,
    name: requireString(input['name'], 'repository name').trim(),
    description: requireString(input['description'], 'description').trim(),
    private: requireBoolean(input['private'], 'visibility')
  }
}
