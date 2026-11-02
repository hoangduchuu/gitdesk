import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { push } from '../src/main/git/remote'
import { rewordCommit } from '../src/main/git/reword'
import { isPushRejected } from '../src/shared/push-error'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

let origin: string
let local: string
let other: string

beforeEach(() => {
  origin = tempDir('gitdesk-origin-')
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  const seed = initRepo()
  commitFile(seed, 'a.txt', 'one\n', 'first')
  git(seed, 'remote', 'add', 'origin', origin)
  git(seed, 'push', '-q', '-u', 'origin', 'main')
  local = tempDir('gitdesk-local-')
  git(local, 'clone', '-q', origin, '.')
  other = tempDir('gitdesk-other-')
  git(other, 'clone', '-q', origin, '.')
  dirs.push(origin, seed, local, other)
})

const remoteHead = (): string => git(origin, 'rev-parse', 'main').trim()
const localHead = (): string => git(local, 'rev-parse', 'HEAD').trim()

describe('force push', () => {
  test('a rewritten branch is rejected by a normal push, and replaced by a force push', async () => {
    commitFile(local, 'b.txt', 'b\n', 'second')
    await push(local)
    await rewordCommit(local, localHead(), 'second, reworded', null)

    let rejected = ''
    await push(local).catch((error: Error) => (rejected = error.message))
    expect(isPushRejected(rejected), rejected).toBe(true)
    expect(remoteHead()).not.toBe(localHead())

    await push(local, {}, true)
    expect(remoteHead()).toBe(localHead())
  })

  test('refuses to overwrite commits someone else pushed since the last fetch', async () => {
    commitFile(local, 'b.txt', 'b\n', 'mine')
    await push(local)
    await rewordCommit(local, localHead(), 'mine, reworded', null)

    git(other, 'pull', '-q')
    commitFile(other, 'theirs.txt', 't\n', 'theirs')
    git(other, 'push', '-q')
    const theirs = remoteHead()

    let lease = ''
    await push(local, {}, true).catch((error: Error) => (lease = error.message))
    expect(lease).toMatch(/stale info|rejected/)
    expect(isPushRejected(lease)).toBe(false) // a force push is not offered again: it would not help
    expect(remoteHead()).toBe(theirs)
  })

  test('also refuses after fetching their work without merging it in', async () => {
    commitFile(local, 'b.txt', 'b\n', 'mine')
    await push(local)
    await rewordCommit(local, localHead(), 'mine, reworded', null)
    git(other, 'pull', '-q')
    commitFile(other, 'theirs.txt', 't\n', 'theirs')
    git(other, 'push', '-q')
    git(local, 'fetch', '-q') // the lease now matches, but their commit was never integrated

    await expect(push(local, {}, true)).rejects.toThrow()
    expect(git(origin, 'log', '--format=%s', 'main').trim().split('\n')).toContain('theirs')

    git(local, 'rebase', '-q', 'origin/main') // integrate it, then forcing is fine
    await push(local, {}, true)
    expect(remoteHead()).toBe(localHead())
    expect(git(origin, 'log', '--format=%s', 'main').trim().split('\n')).toContain('theirs')
  })

  test('without an upstream a forced push just publishes the branch', async () => {
    git(local, 'switch', '-q', '-c', 'topic')
    commitFile(local, 'c.txt', 'c\n', 'topic work')
    await push(local, {}, true)
    expect(git(origin, 'rev-parse', 'topic').trim()).toBe(localHead())
    expect(git(local, 'rev-parse', '--abbrev-ref', 'topic@{upstream}').trim()).toBe('origin/topic')
  })
})

describe('isPushRejected', () => {
  test('recognises a rejected non-fast-forward, not hook or lease failures', () => {
    expect(isPushRejected(' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs')).toBe(true)
    expect(isPushRejected(' ! [rejected]        main -> main (fetch first)')).toBe(true)
    expect(isPushRejected(' ! [rejected]        main -> main (stale info)')).toBe(false)
    expect(isPushRejected(' ! [remote rejected] main -> main (pre-receive hook declined)')).toBe(false)
    expect(isPushRejected('fatal: Authentication failed')).toBe(false)
  })
})
