import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readDiff, readStashFiles } from '../src/main/git/diff'
import { readStashes, stashApply, stashDrop, stashPop, stashPush } from '../src/main/git/stash'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'a.txt', 'base\n')
})
afterEach(() => removeDir(repo))

const read = (file: string) => readFileSync(join(repo, file), 'utf8')

describe('stash', () => {
  test('keeps several stashes newest first with their messages', async () => {
    writeFile(repo, 'a.txt', 'first change\n')
    await stashPush(repo, 'first', false)
    writeFile(repo, 'a.txt', 'second change\n')
    await stashPush(repo, 'second', false)

    const stashes = await readStashes(repo)

    expect(stashes.map((s) => s.ref)).toEqual(['stash@{0}', 'stash@{1}'])
    expect(stashes.map((s) => s.message)).toEqual(['On main: second', 'On main: first'])
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    expect(stashes.map((s) => s.base)).toEqual([head, head])
    expect(read('a.txt')).toBe('base\n')
  })

  test('applies an older stash without removing it, pops and drops', async () => {
    writeFile(repo, 'a.txt', 'older\n')
    await stashPush(repo, 'older', false)
    writeFile(repo, 'b.txt', 'newer\n')
    await stashPush(repo, 'newer', true)

    expect(await stashApply(repo, 'stash@{1}')).toEqual({ conflicts: false })
    expect(read('a.txt')).toBe('older\n')
    expect(await readStashes(repo)).toHaveLength(2)

    expect(await stashPop(repo, 'stash@{0}')).toEqual({ conflicts: false })
    expect(read('b.txt')).toBe('newer\n')
    expect((await readStashes(repo)).map((s) => s.message)).toEqual(['On main: older'])

    await stashDrop(repo, 'stash@{0}')
    expect(await readStashes(repo)).toEqual([])
  })

  test('stashes untracked files only when asked', async () => {
    writeFile(repo, 'new.txt', 'untracked\n')
    writeFile(repo, 'a.txt', 'tracked edit\n')

    await stashPush(repo, 'tracked only', false)
    expect(existsSync(join(repo, 'new.txt'))).toBe(true)

    await stashPush(repo, 'with untracked', true)
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
  })

  test('lists and diffs tracked and untracked files of a stash', async () => {
    writeFile(repo, 'a.txt', 'base\nmore\n')
    writeFile(repo, 'new.txt', 'fresh\n')
    await stashPush(repo, 'mixed', true)

    const files = await readStashFiles(repo, 'stash@{0}')
    expect(files).toEqual([
      { path: 'a.txt', kind: 'modified', untracked: false },
      { path: 'new.txt', kind: 'added', untracked: true }
    ])

    const tracked = await readDiff(repo, { kind: 'stash', ref: 'stash@{0}', path: 'a.txt', untracked: false })
    expect(tracked).toContain('+more')
    const untracked = await readDiff(repo, { kind: 'stash', ref: 'stash@{0}', path: 'new.txt', untracked: true })
    expect(untracked).toContain('+fresh')
  })

  test('lists files of older stashes that have no untracked files', async () => {
    writeFile(repo, 'a.txt', 'tracked only\n')
    await stashPush(repo, 'tracked only', false)
    writeFile(repo, 'n.txt', 'new\n')
    await stashPush(repo, 'with untracked', true)

    // stash@{1} has no third parent; git's `stash@{1}^3^{commit}` wrongly resolves to the stash itself.
    expect(await readStashFiles(repo, 'stash@{1}')).toEqual([{ path: 'a.txt', kind: 'modified', untracked: false }])
    expect(await readStashFiles(repo, 'stash@{0}')).toEqual([{ path: 'n.txt', kind: 'added', untracked: true }])
  })

  test('reports when there is nothing to stash', async () => {
    await expect(stashPush(repo, 'nothing', true)).rejects.toThrow('No local changes')
  })

  test('stops on conflicts and keeps the stash when popping', async () => {
    writeFile(repo, 'a.txt', 'stashed\n')
    await stashPush(repo, 'clash', false)
    commitFile(repo, 'a.txt', 'committed meanwhile\n')

    expect(await stashPop(repo, 'stash@{0}')).toEqual({ conflicts: true })
    expect((await readStatus(repo)).conflicted).toEqual([{ path: 'a.txt', kind: 'both-modified' }])
    expect(await readStashes(repo)).toHaveLength(1)
  })

  test('rejects malformed stash refs', async () => {
    await expect(stashDrop(repo, '--all')).rejects.toThrow('Invalid stash')
  })
})
