import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addWorktree, pruneWorktrees, readWorktrees, removeWorktree } from '../src/main/git/worktrees'
import { parseWorktrees } from '../src/shared/worktree-parse'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

describe('parseWorktrees', () => {
  test('reads branches, detached heads, locks and prunable entries; the first is main', () => {
    const text = [
      'worktree /w/main\nHEAD aaa\nbranch refs/heads/main',
      'worktree /w/feature\nHEAD bbb\nbranch refs/heads/feature/x\nlocked because',
      'worktree /w/detached\nHEAD ccc\ndetached',
      'worktree /w/gone\nHEAD ddd\nbranch refs/heads/old\nprunable gitdir file points to non-existent location',
      ''
    ].join('\n\n')

    expect(parseWorktrees(text)).toEqual([
      { path: '/w/main', head: 'aaa', branch: 'main', main: true, locked: false, prunable: false },
      { path: '/w/feature', head: 'bbb', branch: 'feature/x', main: false, locked: true, prunable: false },
      { path: '/w/detached', head: 'ccc', branch: null, main: false, locked: false, prunable: false },
      { path: '/w/gone', head: 'ddd', branch: 'old', main: false, locked: false, prunable: true }
    ])
  })

  test('is empty for empty output', () => {
    expect(parseWorktrees('')).toEqual([])
  })
})

let repo: string
let area: string
beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'a.txt', 'one\n', 'first')
  area = tempDir('gitdesk-worktrees-')
})
afterEach(() => {
  removeDir(repo)
  removeDir(area)
})

describe('worktrees', () => {
  test('lists just the main working tree at first', async () => {
    const list = await readWorktrees(repo)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ branch: 'main', main: true })
  })

  test('adds one with a new branch, with the files checked out', async () => {
    const path = join(area, 'feature')
    await addWorktree(repo, path, 'feature', true)

    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    const list = await readWorktrees(repo)
    expect(list.map((worktree) => worktree.branch)).toEqual(['main', 'feature'])
    expect(list[1]!.main).toBe(false)
  })

  test('adds one for an existing branch', async () => {
    git(repo, 'branch', 'topic')
    await addWorktree(repo, join(area, 'topic'), 'topic', false)

    expect((await readWorktrees(repo)).map((worktree) => worktree.branch)).toContain('topic')
  })

  test('refuses a branch another worktree already has, and a taken folder', async () => {
    await expect(addWorktree(repo, join(area, 'again'), 'main', false)).rejects.toThrow()
    await addWorktree(repo, join(area, 'one'), 'one', true)
    await expect(addWorktree(repo, join(area, 'one'), 'two', true)).rejects.toThrow('already exists')
  })

  test('refuses relative paths, paths inside .git and option-like branch names', async () => {
    await expect(addWorktree(repo, 'relative/dir', 'x', true)).rejects.toThrow('full folder path')
    await expect(addWorktree(repo, join(repo, '.git', 'wt'), 'x', true)).rejects.toThrow('.git folder')
    await expect(addWorktree(repo, join(area, 'opt'), '--detach', true)).rejects.toThrow()
  })

  test('removes a clean one, but not the main one or an unknown folder', async () => {
    const path = join(area, 'feature')
    await addWorktree(repo, path, 'feature', true)

    await removeWorktree(repo, path, false)

    expect(existsSync(path)).toBe(false)
    expect(await readWorktrees(repo)).toHaveLength(1)
    await expect(removeWorktree(repo, repo, false)).rejects.toThrow('main working tree')
    await expect(removeWorktree(repo, area, false)).rejects.toThrow('not a worktree')
  })

  test('keeps one with local changes unless forced', async () => {
    const path = join(area, 'feature')
    await addWorktree(repo, path, 'feature', true)
    writeFile(path, 'a.txt', 'edited\n')

    await expect(removeWorktree(repo, path, false)).rejects.toThrow()
    expect(existsSync(path)).toBe(true)

    await removeWorktree(repo, path, true)
    expect(existsSync(path)).toBe(false)
  })

  test('prune forgets a worktree whose folder was deleted', async () => {
    const path = join(area, 'feature')
    await addWorktree(repo, path, 'feature', true)
    removeDir(path)
    expect((await readWorktrees(repo)).some((worktree) => worktree.prunable)).toBe(true)

    await pruneWorktrees(repo)

    expect(await readWorktrees(repo)).toHaveLength(1)
  })
})
