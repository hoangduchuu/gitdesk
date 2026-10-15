import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseStatus, readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

describe('parseStatus', () => {
  test('parses branch headers, ordinary, renamed, unmerged and untracked entries', () => {
    const raw = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 a a src/staged.ts',
      '1 .M N... 100644 100644 100644 a a src/edited.ts',
      '1 MM N... 100644 100644 100644 a a both.ts',
      '2 R. N... 100644 100644 100644 a a R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      'u DU N... 100644 000000 100644 100644 a b c gone-here.ts',
      '? notes.txt',
      ''
    ].join('\0')

    const status = parseStatus(raw)

    expect(status.branch).toBe('main')
    expect(status.upstream).toBe('origin/main')
    expect([status.ahead, status.behind]).toEqual([2, 1])
    expect(status.staged).toEqual([
      { path: 'src/staged.ts', kind: 'modified' },
      { path: 'both.ts', kind: 'modified' },
      { path: 'new name.ts', origPath: 'old name.ts', kind: 'renamed' }
    ])
    expect(status.unstaged).toEqual([
      { path: 'src/edited.ts', kind: 'modified' },
      { path: 'both.ts', kind: 'modified' },
      { path: 'notes.txt', kind: 'untracked' }
    ])
    expect(status.conflicted).toEqual([
      { path: 'conflict.ts', kind: 'both-modified' },
      { path: 'gone-here.ts', kind: 'deleted-by-us' }
    ])
  })

  test('reports detached HEAD and unborn branches', () => {
    expect(parseStatus('# branch.oid abc\0# branch.head (detached)\0').branch).toBeNull()
    const unborn = parseStatus('# branch.oid (initial)\0# branch.head main\0')
    expect(unborn.unborn).toBe(true)
    expect(unborn.branch).toBe('main')
  })
})

describe('readStatus', () => {
  let repo: string
  beforeEach(() => {
    repo = initRepo()
  })
  afterEach(() => removeDir(repo))

  test('reads a fresh repository as unborn and clean', async () => {
    const status = await readStatus(repo)
    expect(status).toMatchObject({ branch: 'main', unborn: true, operation: null })
    expect(status.staged).toEqual([])
  })

  test('lists staged, unstaged, deleted and untracked files', async () => {
    commitFile(repo, 'a.txt', 'a')
    commitFile(repo, 'b.txt', 'b')
    writeFile(repo, 'a.txt', 'changed')
    git(repo, 'add', 'a.txt')
    unlinkSync(join(repo, 'b.txt'))
    writeFile(repo, 'dir/new.txt', 'new')

    const status = await readStatus(repo)

    expect(status.staged).toEqual([{ path: 'a.txt', kind: 'modified' }])
    expect(status.unstaged).toEqual([
      { path: 'b.txt', kind: 'deleted' },
      { path: 'dir/new.txt', kind: 'untracked' }
    ])
  })

  test('detects a merge in progress with its conflicted files', async () => {
    commitFile(repo, 'f.txt', 'base\n')
    git(repo, 'checkout', '-q', '-b', 'other')
    commitFile(repo, 'f.txt', 'theirs\n')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'f.txt', 'ours\n')
    try {
      git(repo, 'merge', '-q', 'other')
    } catch {
      // expected: conflict
    }

    const status = await readStatus(repo)

    expect(status.operation).toBe('merge')
    expect(status.conflicted).toEqual([{ path: 'f.txt', kind: 'both-modified' }])
  })
})
