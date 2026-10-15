import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch,
  readBranches
} from '../src/main/git/branches'
import { fetch, pull, push } from '../src/main/git/remote'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

/** A bare "origin", a local clone, and a second clone acting as another developer. */
const withRemote = () => {
  const origin = tempDir('gitdesk-origin-')
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  const seed = initRepo()
  commitFile(seed, 'a.txt', 'one\n', 'first')
  git(seed, 'remote', 'add', 'origin', origin)
  git(seed, 'push', '-q', '-u', 'origin', 'main')
  const local = tempDir('gitdesk-local-')
  git(local, 'clone', '-q', origin, '.')
  dirs.push(origin, seed, local)
  return { origin, seed, local }
}

describe('local branches', () => {
  let repo: string
  beforeEach(() => {
    repo = initRepo()
    dirs.push(repo)
    commitFile(repo, 'a.txt', 'one\n')
  })

  test('creates, lists, checks out and deletes a branch', async () => {
    await createBranch(repo, 'feature/x', null, false)
    let branches = await readBranches(repo)
    expect(branches.map((b) => [b.name, b.kind, b.isHead])).toEqual([
      ['feature/x', 'local', false],
      ['main', 'local', true]
    ])

    await checkoutBranch(repo, 'feature/x', 'local')
    expect((await readStatus(repo)).branch).toBe('feature/x')

    await checkoutBranch(repo, 'main', 'local')
    await deleteBranch(repo, 'feature/x', false)
    branches = await readBranches(repo)
    expect(branches.map((b) => b.name)).toEqual(['main'])
  })

  test('creates and checks out a branch at a start point in one step', async () => {
    const first = git(repo, 'rev-parse', 'HEAD').trim()
    commitFile(repo, 'b.txt', 'two\n')
    await createBranch(repo, 'old', first, true)
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(first)
    expect((await readStatus(repo)).branch).toBe('old')
  })

  test('rejects invalid branch names before running git', async () => {
    await expect(createBranch(repo, 'bad name', null, false)).rejects.toThrow('not a valid branch name')
    await expect(createBranch(repo, '-delete', null, false)).rejects.toThrow('not a valid branch name')
  })

  test('refuses to delete an unmerged branch unless forced', async () => {
    await createBranch(repo, 'wip', null, true)
    commitFile(repo, 'w.txt', 'w\n')
    await checkoutBranch(repo, 'main', 'local')
    await expect(deleteBranch(repo, 'wip', false)).rejects.toThrow()
    await deleteBranch(repo, 'wip', true)
    expect((await readBranches(repo)).map((b) => b.name)).toEqual(['main'])
  })

  test('merges cleanly or stops on conflicts', async () => {
    await createBranch(repo, 'clean', null, true)
    commitFile(repo, 'c.txt', 'c\n')
    await checkoutBranch(repo, 'main', 'local')
    expect(await mergeBranch(repo, 'clean')).toEqual({ conflicts: false })

    await createBranch(repo, 'clash', null, true)
    commitFile(repo, 'a.txt', 'theirs\n')
    await checkoutBranch(repo, 'main', 'local')
    commitFile(repo, 'a.txt', 'ours\n')
    expect(await mergeBranch(repo, 'clash')).toEqual({ conflicts: true })
    expect((await readStatus(repo)).operation).toBe('merge')
  })
})

describe('remote branches and sync', () => {
  test('pushes a new branch with upstream, fetches and pulls changes', async () => {
    const { seed, local } = withRemote()

    await createBranch(local, 'topic', null, true)
    commitFile(local, 't.txt', 't\n')
    await push(local)
    let branches = await readBranches(local)
    expect(branches.find((b) => b.name === 'topic')?.upstream).toBe('origin/topic')
    expect(branches.some((b) => b.name === 'origin/topic' && b.kind === 'remote')).toBe(true)

    // another developer pushes to main
    commitFile(seed, 'a.txt', 'one\nupstream\n', 'upstream change')
    git(seed, 'push', '-q', 'origin', 'main')

    await checkoutBranch(local, 'main', 'local')
    await fetch(local)
    expect((await readStatus(local)).behind).toBe(1)
    expect(await pull(local)).toEqual({ conflicts: false })
    expect(git(local, 'log', '-1', '--format=%s').trim()).toBe('upstream change')

    branches = await readBranches(local)
    expect(branches.find((b) => b.name === 'main')).toMatchObject({ ahead: 0, behind: 0 })
  })

  test('checks out a remote branch as a tracking local branch', async () => {
    const { seed, local } = withRemote()
    git(seed, 'checkout', '-q', '-b', 'remote-only')
    commitFile(seed, 'r.txt', 'r\n')
    git(seed, 'push', '-q', 'origin', 'remote-only')

    await fetch(local)
    await checkoutBranch(local, 'origin/remote-only', 'remote')

    const status = await readStatus(local)
    expect(status.branch).toBe('remote-only')
    expect(status.upstream).toBe('origin/remote-only')
  })

  test('pull stops on conflicts with a divergent upstream', async () => {
    const { seed, local } = withRemote()
    commitFile(seed, 'a.txt', 'theirs\n')
    git(seed, 'push', '-q', 'origin', 'main')
    commitFile(local, 'a.txt', 'ours\n')

    expect(await pull(local)).toEqual({ conflicts: true })
    expect((await readStatus(local)).conflicted).toEqual([{ path: 'a.txt', kind: 'both-modified' }])
  })

  test('push explains when there is no remote', async () => {
    const repo = initRepo()
    dirs.push(repo)
    commitFile(repo, 'a.txt', 'one\n')
    await expect(push(repo)).rejects.toThrow('No remote')
  })
})
