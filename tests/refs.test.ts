import { describe, expect, test } from 'vitest'
import { groupRefs, parseDecorations } from '../src/shared/refs'

describe('parseDecorations', () => {
  test('tells local branches with slashes apart from remote branches', () => {
    expect(
      parseDecorations([
        'HEAD -> refs/heads/main',
        'refs/remotes/origin/main',
        'refs/heads/feature/x',
        'tag: refs/tags/v1.0'
      ])
    ).toEqual([
      { name: 'main', kind: 'head' },
      { name: 'origin/main', kind: 'remote' },
      { name: 'feature/x', kind: 'branch' },
      { name: 'v1.0', kind: 'tag' }
    ])
  })

  test('hides remote HEAD pointers and unknown refs, keeps a detached HEAD', () => {
    expect(parseDecorations(['refs/remotes/origin/HEAD', 'refs/notes/x', 'HEAD'])).toEqual([
      { name: 'HEAD', kind: 'head' }
    ])
  })
})

describe('groupRefs', () => {
  test('merges a local branch with its remote counterpart and lists HEAD first', () => {
    expect(
      groupRefs([
        { name: 'origin/feature/x', kind: 'remote' },
        { name: 'v1.0', kind: 'tag' },
        { name: 'feature/x', kind: 'branch' },
        { name: 'main', kind: 'head' },
        { name: 'origin/main', kind: 'remote' },
        { name: 'upstream/only', kind: 'remote' }
      ])
    ).toEqual([
      { label: 'main', kind: 'branch', isHead: true, local: true, remote: true },
      { label: 'feature/x', kind: 'branch', isHead: false, local: true, remote: true },
      { label: 'upstream/only', kind: 'branch', isHead: false, local: false, remote: true },
      { label: 'v1.0', kind: 'tag', isHead: false, local: false, remote: false }
    ])
  })

  test('keeps a detached HEAD as its own label', () => {
    expect(groupRefs([{ name: 'HEAD', kind: 'head' }])).toEqual([
      { label: 'HEAD', kind: 'branch', isHead: true, local: false, remote: false }
    ])
  })
})
