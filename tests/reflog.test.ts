import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readReflog } from '../src/main/git/reflog'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

const head = () => git(repo, 'rev-parse', 'HEAD').trim()

describe('readReflog', () => {
  test('is empty for a repository without commits', async () => {
    expect(await readReflog(repo, 50)).toEqual([])
  })

  test('still reports a folder that is not a repository', async () => {
    const plain = tempDir()
    try {
      await expect(readReflog(plain, 50)).rejects.toThrow(/not a git repository/)
    } finally {
      removeDir(plain)
    }
  })

  test('lists HEAD movements newest first', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'first')
    const first = head()
    commitFile(repo, 'a.txt', 'two\n', 'second')
    const second = head()
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')

    const entries = await readReflog(repo, 50)

    expect(entries.map((entry) => entry.selector)).toEqual(['HEAD@{0}', 'HEAD@{1}', 'HEAD@{2}'])
    expect(entries.map((entry) => entry.hash)).toEqual([first, second, first])
    expect(entries[0]!.action).toBe('reset: moving to HEAD~1')
    expect(entries[1]!.action).toBe('commit: second')
    expect(entries[2]!.action).toMatch(/^commit \(initial\): first/)
    expect(entries[0]!.time).toBeGreaterThan(1_600_000_000)
  })

  test('keeps the commit that a hard reset made unreachable', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'first')
    commitFile(repo, 'a.txt', 'two\n', 'lost')
    const lost = head()
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')

    expect((await readReflog(repo, 50)).some((entry) => entry.hash === lost)).toBe(true)
  })

  test('respects the limit', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'first')
    commitFile(repo, 'a.txt', 'two\n', 'second')
    commitFile(repo, 'a.txt', 'three\n', 'third')

    expect(await readReflog(repo, 2)).toHaveLength(2)
  })

  test('keeps branch switches with their message', async () => {
    commitFile(repo, 'a.txt', 'one\n', 'first')
    git(repo, 'checkout', '-q', '-b', 'topic')

    expect((await readReflog(repo, 50))[0]!.action).toBe('checkout: moving from main to topic')
  })
})
