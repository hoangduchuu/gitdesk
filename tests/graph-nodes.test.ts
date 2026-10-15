import { describe, expect, test } from 'vitest'
import { buildGraphNodes, WIP_HASH } from '../src/shared/graph-nodes'
import type { Stash, WorkingTreeStatus } from '../src/shared/model'
import type { Commit } from '../src/shared/types'

const commit = (hash: string, parents: string[] = [], head = false): Commit => ({
  hash,
  parents,
  authorName: 'Alice Smith',
  authorEmail: 'a@x',
  authorTime: 0,
  refs: head ? [{ name: 'main', kind: 'head' }] : [],
  subject: hash,
  body: ''
})

const stash = (hash: string, base: string): Stash => ({ ref: `stash@{0}`, hash, time: 0, base, message: hash })

const status = (overrides: Partial<WorkingTreeStatus> = {}): WorkingTreeStatus => ({
  branch: 'main',
  unborn: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  conflicted: [],
  operation: null,
  ...overrides
})

const COMMITS = [commit('c', ['b']), commit('b', ['a'], true), commit('a')]

describe('buildGraphNodes', () => {
  test('puts the WIP node directly above HEAD, with change counts per file', () => {
    const nodes = buildGraphNodes(
      COMMITS,
      [],
      status({
        staged: [{ path: 'x.ts', kind: 'modified' }, { path: 'new.ts', kind: 'added' }],
        unstaged: [
          { path: 'x.ts', kind: 'modified' },
          { path: 'gone.ts', kind: 'deleted' },
          { path: 'u.ts', kind: 'untracked' }
        ],
        conflicted: [{ path: 'c.ts', kind: 'both-modified' }]
      })
    )

    expect(nodes.map((n) => n.hash)).toEqual(['c', WIP_HASH, 'b', 'a'])
    expect(nodes[1]).toEqual({
      kind: 'wip',
      hash: WIP_HASH,
      parents: ['b'],
      changes: { added: 2, modified: 1, deleted: 1, conflicted: 1 }
    })
  })

  test('puts the WIP node above stashes made on HEAD', () => {
    const nodes = buildGraphNodes(COMMITS, [stash('s', 'b')], status({ unstaged: [{ path: 'x', kind: 'modified' }] }))
    expect(nodes.map((n) => n.hash)).toEqual(['c', WIP_HASH, 's', 'b', 'a'])
  })

  test('has no WIP node for a clean working tree', () => {
    expect(buildGraphNodes(COMMITS, [], status()).map((n) => n.kind)).toEqual(['commit', 'commit', 'commit'])
  })

  test('places each stash directly above the commit it was made on, newest first', () => {
    const nodes = buildGraphNodes(COMMITS, [stash('s2', 'a'), stash('s1', 'a'), stash('s0', 'c')], status())

    expect(nodes.map((n) => n.hash)).toEqual(['s0', 'c', 'b', 's2', 's1', 'a'])
    expect(nodes[3]).toMatchObject({ kind: 'stash', parents: ['a'] })
  })

  test('leaves out stashes whose base commit is not loaded', () => {
    const nodes = buildGraphNodes(COMMITS, [stash('old', 'not-loaded')], status())
    expect(nodes.some((n) => n.kind === 'stash')).toBe(false)
  })

  test('gives a WIP node no parent before the first commit', () => {
    const nodes = buildGraphNodes([], [], status({ unborn: true, unstaged: [{ path: 'a', kind: 'untracked' }] }))
    expect(nodes).toEqual([
      { kind: 'wip', hash: WIP_HASH, parents: [], changes: { added: 1, modified: 0, deleted: 0, conflicted: 0 } }
    ])
  })
})
