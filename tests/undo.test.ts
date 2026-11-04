import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { undoLastAction } from '../src/main/git/undo'
import { checkoutOrigin, undoKindOf } from '../src/shared/undo'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'a.txt', 'one\n', 'first')
})
afterEach(() => removeDir(repo))

const head = () => git(repo, 'rev-parse', 'HEAD').trim()
const status = () => git(repo, 'status', '--porcelain').trim()

describe('undoKindOf', () => {
  test.each([
    ['commit: add b', 'commit'],
    ['commit (amend): add b', 'commit'],
    ['reset: moving to HEAD~1', 'reset'],
    ['checkout: moving from main to topic', 'checkout'],
    ['commit (initial): first', null],
    ['commit (merge): Merge branch x', null],
    ['merge topic: Fast-forward', null],
    ['rebase (finish): returning to refs/heads/main', null]
  ])('%s -> %s', (action, kind) => expect(undoKindOf(action)).toBe(kind))

  test('knows where a checkout came from', () => {
    expect(checkoutOrigin('checkout: moving from main to topic')).toEqual({ name: 'main', detached: false })
    expect(checkoutOrigin(`checkout: moving from ${'a'.repeat(40)} to main`)).toEqual({ name: 'a'.repeat(40), detached: true })
  })
})

describe('undoLastAction', () => {
  test('undoes a commit but keeps its changes staged', async () => {
    const first = head()
    commitFile(repo, 'b.txt', 'bee\n', 'add b')

    await undoLastAction(repo)

    expect(head()).toBe(first)
    expect(status()).toBe('A  b.txt')
  })

  test('undoes an amend back to the commit it replaced', async () => {
    commitFile(repo, 'b.txt', 'bee\n', 'add b')
    const before = head()
    writeFile(repo, 'b.txt', 'bee!\n')
    git(repo, 'commit', '-q', '-a', '--amend', '-m', 'add b (amended)')

    await undoLastAction(repo)

    expect(head()).toBe(before)
    expect(status()).toBe('M  b.txt')
  })

  test('undoes a hard reset by moving HEAD back', async () => {
    commitFile(repo, 'a.txt', 'two\n', 'second')
    const second = head()
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')

    await undoLastAction(repo)

    expect(head()).toBe(second)
  })

  test('refuses to undo a reset when local changes are in the way, and changes nothing', async () => {
    commitFile(repo, 'a.txt', 'two\n', 'second')
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')
    const afterReset = head()
    writeFile(repo, 'a.txt', 'my edit\n')

    await expect(undoLastAction(repo)).rejects.toThrow()

    expect(head()).toBe(afterReset)
    expect(git(repo, 'show', ':a.txt')).toBe('one\n')
    expect(status()).toBe('M a.txt')
  })

  test('undoes a branch switch', async () => {
    git(repo, 'checkout', '-q', '-b', 'topic')

    await undoLastAction(repo)

    expect(git(repo, 'branch', '--show-current').trim()).toBe('main')
  })

  test('undoes a switch away from a detached HEAD', async () => {
    const first = head()
    git(repo, 'checkout', '-q', '--detach')
    git(repo, 'checkout', '-q', 'main')

    await undoLastAction(repo)

    expect(git(repo, 'branch', '--show-current').trim()).toBe('')
    expect(head()).toBe(first)
  })

  test('refuses actions it cannot take back', async () => {
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'b.txt', 'bee\n', 'on topic')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge topic', 'topic')

    await expect(undoLastAction(repo)).rejects.toThrow('Cannot undo')
  })

  test('has nothing to undo right after the first commit', async () => {
    await expect(undoLastAction(repo)).rejects.toThrow('Nothing to undo')
  })
})
