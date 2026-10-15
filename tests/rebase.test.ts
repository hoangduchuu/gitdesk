import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { continueOperation } from '../src/main/git/conflict'
import { interactiveRebase, readRebaseCommits } from '../src/main/git/rebase'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir } from './helpers/repo'

let repo: string
let base: string
let c1: string
let c2: string
let c3: string

beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'base.txt', 'base\n', 'base')
  base = git(repo, 'rev-parse', 'HEAD').trim()
  commitFile(repo, 'one.txt', '1\n', 'one')
  c1 = git(repo, 'rev-parse', 'HEAD').trim()
  commitFile(repo, 'two.txt', '2\n', 'two')
  c2 = git(repo, 'rev-parse', 'HEAD').trim()
  commitFile(repo, 'three.txt', '3\n', 'three')
  c3 = git(repo, 'rev-parse', 'HEAD').trim()
})
afterEach(() => removeDir(repo))

const subjects = () => git(repo, 'log', '--format=%s').trim().split('\n')

describe('readRebaseCommits', () => {
  test('lists commits after the base, oldest first', async () => {
    const commits = await readRebaseCommits(repo, base)
    expect(commits.map((c) => c.subject)).toEqual(['one', 'two', 'three'])
  })

  test('refuses a base that is not an ancestor of HEAD', async () => {
    git(repo, 'checkout', '-q', '-b', 'side', base)
    commitFile(repo, 'side.txt', 's\n', 'side')
    const side = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', 'main')
    await expect(readRebaseCommits(repo, side)).rejects.toThrow('not an ancestor')
  })
})

describe('interactiveRebase', () => {
  test('reorders, drops, squashes and rewords commits', async () => {
    const outcome = await interactiveRebase(repo, base, [
      { hash: c3, action: 'reword', message: 'three, reworded' },
      { hash: c1, action: 'pick' },
      { hash: c2, action: 'squash' }
    ])

    expect(outcome).toEqual({ conflicts: false })
    expect(git(repo, 'log', '--format=%s', '-n', '2').trim().split('\n')).toEqual(['one', 'three, reworded'])
    // squash keeps both messages in the combined commit
    expect(git(repo, 'log', '-1', '--format=%B')).toContain('two')
    expect(git(repo, 'ls-files').trim().split('\n').sort()).toEqual(['base.txt', 'one.txt', 'three.txt', 'two.txt'])
  })

  test('drops a commit', async () => {
    await interactiveRebase(repo, base, [
      { hash: c1, action: 'pick' },
      { hash: c2, action: 'drop' },
      { hash: c3, action: 'pick' }
    ])
    expect(subjects()).toEqual(['three', 'one', 'base'])
  })

  test('requires every commit in the range exactly once', async () => {
    await expect(
      interactiveRebase(repo, base, [
        { hash: c1, action: 'pick' },
        { hash: c3, action: 'pick' }
      ])
    ).rejects.toThrow('every commit')
  })

  test('refuses to squash into nothing', async () => {
    await expect(
      interactiveRebase(repo, base, [
        { hash: c1, action: 'squash' },
        { hash: c2, action: 'pick' },
        { hash: c3, action: 'pick' }
      ])
    ).rejects.toThrow('first')
  })

  test('refuses a range containing merge commits', async () => {
    git(repo, 'checkout', '-q', '-b', 'side', c1)
    commitFile(repo, 'side.txt', 's\n', 'side')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    await expect(readRebaseCommits(repo, base)).rejects.toThrow('merge commits')
  })

  test('stops on conflicts, and a pending reword still applies after continue', async () => {
    // c2 and a reordered edit to the same file conflict
    commitFile(repo, 'two.txt', '2 changed\n', 'change two')
    const c4 = git(repo, 'rev-parse', 'HEAD').trim()

    const outcome = await interactiveRebase(repo, base, [
      { hash: c1, action: 'pick' },
      { hash: c4, action: 'reword', message: 'change two, reworded' },
      { hash: c2, action: 'pick' },
      { hash: c3, action: 'pick' }
    ])
    expect(outcome.conflicts).toBe(true)
    expect((await readStatus(repo)).operation).toBe('rebase')

    // resolve: c4 applied before c2 created two.txt -> take the incoming version
    git(repo, 'checkout', '--theirs', '--', 'two.txt')
    git(repo, 'add', 'two.txt')
    // the pending reword runs, then c2 conflicts in turn: reported, not thrown
    expect(await continueOperation(repo)).toEqual({ conflicts: true })
    git(repo, 'checkout', '--theirs', '--', 'two.txt')
    git(repo, 'add', 'two.txt')
    expect(await continueOperation(repo)).toEqual({ conflicts: false })

    expect((await readStatus(repo)).operation).toBeNull()
    expect(subjects()).toContain('change two, reworded')
    expect(existsSync(join(git(repo, 'rev-parse', '--absolute-git-dir').trim(), 'gitdesk-rebase'))).toBe(false)
  })
})
