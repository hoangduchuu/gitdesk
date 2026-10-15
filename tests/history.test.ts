import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { checkoutCommit, cherryPick, resetTo, revertCommit } from '../src/main/git/history'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'a.txt', 'one\n', 'first')
})
afterEach(() => removeDir(repo))

const head = () => git(repo, 'rev-parse', 'HEAD').trim()
const subjects = () => git(repo, 'log', '--format=%s').trim().split('\n')
const read = (file: string) => readFileSync(join(repo, file), 'utf8')

describe('cherryPick', () => {
  test('copies commits from another branch in history order', async () => {
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'b.txt', 'b\n', 'add b')
    const b = head()
    commitFile(repo, 'c.txt', 'c\n', 'add c')
    const c = head()
    git(repo, 'checkout', '-q', 'main')

    // Given newest first (graph order), they are applied oldest first.
    expect(await cherryPick(repo, [c, b])).toEqual({ conflicts: false })

    expect(subjects()).toEqual(['add c', 'add b', 'first'])
  })

  test('stops on conflicts as a cherry-pick in progress', async () => {
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'a.txt', 'theirs\n', 'change a')
    const change = head()
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'a.txt', 'ours\n', 'main change')

    expect(await cherryPick(repo, [change])).toEqual({ conflicts: true })
    expect((await readStatus(repo)).operation).toBe('cherry-pick')
  })
})

describe('revertCommit', () => {
  test('adds a commit undoing the change', async () => {
    commitFile(repo, 'a.txt', 'two\n', 'second')
    await revertCommit(repo, head())
    expect(read('a.txt')).toBe('one\n')
    expect(subjects()[0]).toBe('Revert "second"')
  })

  test('reverts a merge commit against its first parent', async () => {
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'b.txt', 'b\n', 'add b')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'c.txt', 'c\n', 'add c')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge topic', 'topic')

    expect(await revertCommit(repo, head())).toEqual({ conflicts: false })
    expect(git(repo, 'ls-files').trim().split('\n')).toEqual(['a.txt', 'c.txt'])
  })
})

describe('resetTo', () => {
  const twoMore = () => {
    const first = head()
    commitFile(repo, 'a.txt', 'two\n', 'second')
    return first
  }

  test('soft keeps the changes staged', async () => {
    const first = twoMore()
    await resetTo(repo, first, 'soft')
    expect(head()).toBe(first)
    expect((await readStatus(repo)).staged).toEqual([{ path: 'a.txt', kind: 'modified' }])
  })

  test('mixed keeps the changes unstaged', async () => {
    const first = twoMore()
    await resetTo(repo, first, 'mixed')
    const status = await readStatus(repo)
    expect(status.staged).toEqual([])
    expect(status.unstaged).toEqual([{ path: 'a.txt', kind: 'modified' }])
  })

  test('hard discards the changes', async () => {
    const first = twoMore()
    writeFile(repo, 'a.txt', 'dirty\n')
    await resetTo(repo, first, 'hard')
    expect(read('a.txt')).toBe('one\n')
  })
})

describe('checkoutCommit', () => {
  test('detaches HEAD at the commit', async () => {
    const first = head()
    commitFile(repo, 'a.txt', 'two\n', 'second')
    await checkoutCommit(repo, first)
    const status = await readStatus(repo)
    expect(status.branch).toBeNull()
    expect(head()).toBe(first)
  })
})
