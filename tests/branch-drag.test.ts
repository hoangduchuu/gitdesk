import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { branchDropActions, canDropBranch, type DragBranch } from '../src/shared/branch-drag'
import { mergeBranchInto, rebaseBranch } from '../src/main/git/branches'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

const local = (name: string): DragBranch => ({ name, kind: 'local' })
const remote = (name: string): DragBranch => ({ name, kind: 'remote' })

describe('what a drop can do', () => {
  test('ignores a branch dropped on itself and remote-on-remote', () => {
    expect(canDropBranch(local('a'), local('a'))).toBe(false)
    expect(canDropBranch(local('a'), local('b'))).toBe(true)
    expect(canDropBranch(local('a'), remote('origin/b'))).toBe(true)
    expect(canDropBranch(remote('origin/a'), local('b'))).toBe(true)
    expect(canDropBranch(remote('origin/a'), remote('origin/b'))).toBe(false)
  })

  test('merge needs a local target, rebase a local source', () => {
    expect(branchDropActions(local('a'), local('b'))).toEqual(['merge', 'rebase'])
    expect(branchDropActions(local('a'), remote('origin/b'))).toEqual(['rebase'])
    expect(branchDropActions(remote('origin/a'), local('b'))).toEqual(['merge'])
  })
})

describe('merge and rebase by drag and drop', () => {
  let repo: string
  beforeEach(() => {
    repo = initRepo()
    dirs.push(repo)
    commitFile(repo, 'base.txt', 'base\n', 'base')
    git(repo, 'switch', '-q', '-c', 'feature')
    commitFile(repo, 'f.txt', 'f\n', 'feature work')
    git(repo, 'switch', '-q', 'main')
    commitFile(repo, 'm.txt', 'm\n', 'main work')
  })

  const subjects = (ref: string): string[] => git(repo, 'log', '--format=%s', ref).trim().split('\n')
  const branch = async (): Promise<string | null> => (await readStatus(repo)).branch

  test('merges into the branch that is already checked out', async () => {
    expect(await mergeBranchInto(repo, 'feature', 'main')).toEqual({ conflicts: false })
    expect(await branch()).toBe('main')
    expect(subjects('main')).toContain('feature work')
  })

  test('merges into another branch by checking it out first', async () => {
    git(repo, 'switch', '-q', '-c', 'other', 'main~1')
    git(repo, 'switch', '-q', 'main')
    expect(await mergeBranchInto(repo, 'main', 'other')).toEqual({ conflicts: false })
    expect(await branch()).toBe('other')
    expect(subjects('other')).toContain('main work')
  })

  test('merges a remote branch into a local one', async () => {
    const origin = tempDir('gitdesk-origin-')
    dirs.push(origin)
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'push', '-q', 'origin', 'feature')
    git(repo, 'fetch', '-q')
    await mergeBranchInto(repo, 'origin/feature', 'main')
    expect(subjects('main')).toContain('feature work')
  })

  test('stops on merge conflicts so they can be resolved', async () => {
    git(repo, 'switch', '-q', 'feature')
    commitFile(repo, 'same.txt', 'feature\n', 'feature same')
    git(repo, 'switch', '-q', 'main')
    commitFile(repo, 'same.txt', 'main\n', 'main same')
    expect(await mergeBranchInto(repo, 'feature', 'main')).toEqual({ conflicts: true })
    expect((await readStatus(repo)).conflicted).toHaveLength(1)
  })

  test('will not switch branches over uncommitted changes, and changes nothing', async () => {
    writeFile(repo, 'base.txt', 'dirty\n')
    await expect(mergeBranchInto(repo, 'main', 'feature')).rejects.toThrow(/Commit or stash/)
    expect(await branch()).toBe('main')
    // The target already being checked out needs no switch, so git decides about the changes.
    await expect(mergeBranchInto(repo, 'feature', 'main')).resolves.toEqual({ conflicts: false })
  })

  test('rebases a branch onto another, leaving linear history on top of it', async () => {
    expect(await rebaseBranch(repo, 'feature', 'main')).toEqual({ conflicts: false })
    expect(await branch()).toBe('feature') // git checks the rebased branch out
    expect(subjects('feature')).toEqual(['feature work', 'main work', 'base'])
    expect(git(repo, 'log', '-1', '--format=%P', 'feature').trim().split(' ')).toHaveLength(1)
  })

  test('rebasing the checked-out branch works too', async () => {
    git(repo, 'switch', '-q', 'feature')
    await rebaseBranch(repo, 'feature', 'main')
    expect(subjects('feature')).toEqual(['feature work', 'main work', 'base'])
  })

  test('stops on rebase conflicts; the rebase is left for continue or abort', async () => {
    git(repo, 'switch', '-q', 'feature')
    commitFile(repo, 'same.txt', 'feature\n', 'feature same')
    git(repo, 'switch', '-q', 'main')
    commitFile(repo, 'same.txt', 'main\n', 'main same')
    expect(await rebaseBranch(repo, 'feature', 'main')).toEqual({ conflicts: true })
    expect((await readStatus(repo)).operation).toBe('rebase')
  })

  test('will not rebase another branch over uncommitted changes', async () => {
    writeFile(repo, 'base.txt', 'dirty\n')
    await expect(rebaseBranch(repo, 'feature', 'main')).rejects.toThrow(/Commit or stash/)
    expect(await branch()).toBe('main')
  })

  test('rejects unknown branches, a remote branch as the one being rebased, and the same branch twice', async () => {
    await expect(mergeBranchInto(repo, 'ghost', 'main')).rejects.toThrow(/not a branch/)
    await expect(mergeBranchInto(repo, 'feature', 'ghost')).rejects.toThrow(/not a local branch/)
    await expect(mergeBranchInto(repo, 'main', 'main')).rejects.toThrow(/different/)
    await expect(rebaseBranch(repo, 'origin/feature', 'main')).rejects.toThrow(/not a local branch/)
    await expect(rebaseBranch(repo, 'feature', 'feature')).rejects.toThrow(/different/)
    await expect(mergeBranchInto(repo, '--all', 'main')).rejects.toThrow()
  })
})
