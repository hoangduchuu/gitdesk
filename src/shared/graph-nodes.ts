import type { ChangeKind, Stash, WorkingTreeStatus } from './model'
import type { Commit } from './types'

export const WIP_HASH = '__wip__'

export interface WipCounts {
  added: number
  modified: number
  deleted: number
  conflicted: number
}

export type GraphNode =
  | { kind: 'wip'; hash: typeof WIP_HASH; parents: string[]; changes: WipCounts }
  | { kind: 'commit'; hash: string; parents: string[]; commit: Commit }
  | { kind: 'stash'; hash: string; parents: string[]; stash: Stash }

const countKind = (kind: ChangeKind): keyof WipCounts =>
  kind === 'added' || kind === 'untracked' ? 'added' : kind === 'deleted' ? 'deleted' : 'modified'

/** Count each changed file once, whether it is staged, unstaged or both. */
const wipCounts = (status: WorkingTreeStatus): WipCounts => {
  const seen = new Map<string, keyof WipCounts>()
  for (const change of [...status.staged, ...status.unstaged]) {
    if (!seen.has(change.path)) seen.set(change.path, countKind(change.kind))
  }
  const counts: WipCounts = { added: 0, modified: 0, deleted: 0, conflicted: status.conflicted.length }
  for (const kind of seen.values()) counts[kind]++
  return counts
}

const headHash = (commits: readonly Commit[]): string | null =>
  commits.find((commit) => commit.refs.some((ref) => ref.kind === 'head'))?.hash ?? null

/**
 * Commits in graph order, with a WIP node (when there are changes) directly above HEAD and
 * each stash right above the commit it was made on. Stashes whose base commit is not loaded
 * are left out; without a loaded HEAD the WIP node goes on top.
 */
export function buildGraphNodes(
  commits: readonly Commit[],
  stashes: readonly Stash[],
  status: WorkingTreeStatus | null
): GraphNode[] {
  const changes = status ? wipCounts(status) : null
  const hasWip = changes !== null && changes.added + changes.modified + changes.deleted + changes.conflicted > 0
  const head = headHash(commits)
  const wip = (): GraphNode => ({ kind: 'wip', hash: WIP_HASH, parents: head ? [head] : [], changes: changes! })

  const stashesByBase = new Map<string, Stash[]>()
  for (const stash of stashes) {
    stashesByBase.set(stash.base, [...(stashesByBase.get(stash.base) ?? []), stash])
  }

  const nodes: GraphNode[] = hasWip && head === null ? [wip()] : []
  for (const commit of commits) {
    if (hasWip && commit.hash === head) nodes.push(wip())
    for (const stash of stashesByBase.get(commit.hash) ?? []) {
      nodes.push({ kind: 'stash', hash: stash.hash, parents: [stash.base], stash })
    }
    nodes.push({ kind: 'commit', hash: commit.hash, parents: commit.parents, commit })
  }
  return nodes
}
