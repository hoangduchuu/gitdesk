import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { commit, discard, stage, unstage } from '../src/main/git/worktree'
import { readStatus } from '../src/main/git/status'
import { readDiff, readCommitFiles } from '../src/main/git/diff'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

describe('stage / unstage / commit', () => {
  test('stages files, commits them and leaves a clean tree', async () => {
    writeFile(repo, 'a.txt', 'hello\n')
    await stage(repo, ['a.txt'])
    expect((await readStatus(repo)).staged).toEqual([{ path: 'a.txt', kind: 'added' }])

    await commit(repo, 'first commit', false, null)

    const status = await readStatus(repo)
    expect(status.unborn).toBe(false)
    expect([...status.staged, ...status.unstaged]).toEqual([])
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('first commit')
  })

  test('unstages a file on an unborn branch and after the first commit', async () => {
    writeFile(repo, 'a.txt', 'one\n')
    await stage(repo, ['a.txt'])
    await unstage(repo, ['a.txt'])
    expect((await readStatus(repo)).staged).toEqual([])

    commitFile(repo, 'a.txt', 'one\n')
    writeFile(repo, 'a.txt', 'two\n')
    await stage(repo, ['a.txt'])
    await unstage(repo, ['a.txt'])
    const status = await readStatus(repo)
    expect(status.staged).toEqual([])
    expect(status.unstaged).toEqual([{ path: 'a.txt', kind: 'modified' }])
  })

  test('stages a deletion', async () => {
    commitFile(repo, 'a.txt', 'one\n')
    git(repo, 'rm', '-q', '--cached', 'a.txt')
    git(repo, 'reset', '-q')
    removeDir(join(repo, 'a.txt'))
    await stage(repo, ['a.txt'])
    expect((await readStatus(repo)).staged).toEqual([{ path: 'a.txt', kind: 'deleted' }])
  })

  test('amends the last commit message', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'typo')
    await commit(repo, 'fixed message', true, null)
    expect(git(repo, 'log', '--format=%s').trim()).toBe('fixed message')
  })

  test('commits as the chosen identity without touching the repository config', async () => {
    writeFile(repo, 'a.txt', 'x')
    await stage(repo, ['a.txt'])
    await commit(repo, 'as profile', false, { name: 'Văn Tiến', email: 'tien@company.com' })

    expect(git(repo, 'log', '-1', '--format=%an <%ae> / %cn <%ce>').trim()).toBe(
      'Văn Tiến <tien@company.com> / Văn Tiến <tien@company.com>'
    )
    expect(() => git(repo, 'config', '--local', 'user.email')).toThrow()
  })

  test('amending as a profile keeps the original author and records the profile as committer', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'typo')
    await commit(repo, 'fixed', true, { name: 'Other Person', email: 'other@x.com' })
    expect(git(repo, 'log', '-1', '--format=%an / %cn').trim()).toBe('Tester / Other Person')
  })

  test('rejects an empty commit message', async () => {
    writeFile(repo, 'a.txt', 'x')
    await stage(repo, ['a.txt'])
    await expect(commit(repo, '   ', false, null)).rejects.toThrow('Commit message is empty')
  })
})

describe('discard', () => {
  test('restores tracked files and deletes untracked ones', async () => {
    commitFile(repo, 'a.txt', 'original\n')
    writeFile(repo, 'a.txt', 'edited\n')
    writeFile(repo, 'new.txt', 'scratch\n')

    await discard(repo, [
      { path: 'a.txt', kind: 'modified' },
      { path: 'new.txt', kind: 'untracked' }
    ])

    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
  })
})

describe('readDiff', () => {
  test('diffs unstaged, staged and untracked working files', async () => {
    commitFile(repo, 'a.txt', 'one\n')
    writeFile(repo, 'a.txt', 'one\ntwo\n')
    writeFile(repo, 'new.txt', 'brand new\n')

    const unstaged = await readDiff(repo, { kind: 'working', path: 'a.txt', staged: false, untracked: false })
    expect(unstaged).toContain('+two')

    git(repo, 'add', 'a.txt')
    const staged = await readDiff(repo, { kind: 'working', path: 'a.txt', staged: true, untracked: false })
    expect(staged).toContain('+two')

    const untracked = await readDiff(repo, { kind: 'working', path: 'new.txt', staged: false, untracked: true })
    expect(untracked).toContain('+brand new')
  })

  test('lists and diffs files of root, normal and merge commits', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'root')
    const root = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', '-b', 'side')
    commitFile(repo, 'side.txt', 'side\n', 'side work')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'a.txt', 'one\ntwo\n', 'main work')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    const merge = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'mv', 'a.txt', 'renamed.txt')
    git(repo, 'commit', '-q', '-m', 'rename')
    const rename = git(repo, 'rev-parse', 'HEAD').trim()

    expect(await readCommitFiles(repo, root)).toEqual([{ path: 'a.txt', kind: 'added' }])
    // A merge shows what it brought in relative to its first parent.
    expect(await readCommitFiles(repo, merge)).toEqual([{ path: 'side.txt', kind: 'added' }])
    expect(await readCommitFiles(repo, rename)).toEqual([
      { path: 'renamed.txt', origPath: 'a.txt', kind: 'renamed' }
    ])

    const rootDiff = await readDiff(repo, { kind: 'commit', hash: root, path: 'a.txt' })
    expect(rootDiff).toContain('+one')
    const mergeDiff = await readDiff(repo, { kind: 'commit', hash: merge, path: 'side.txt' })
    expect(mergeDiff).toContain('+side')
  })
})
