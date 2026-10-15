import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  abortOperation,
  continueOperation,
  readConflict,
  resolveConflict,
  resolveConflictWithSide
} from '../src/main/git/conflict'
import { insideRepo } from '../src/main/git/paths'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

const read = (file: string) => readFileSync(join(repo, file), 'utf8')
const tryGit = (...args: string[]) => {
  try {
    git(repo, ...args)
  } catch {
    // conflicts make git exit non-zero
  }
}

/** main and `other` both change f.txt, then main merges other. */
const mergeConflict = () => {
  commitFile(repo, 'f.txt', 'base\n', 'base')
  git(repo, 'checkout', '-q', '-b', 'other')
  commitFile(repo, 'f.txt', 'theirs\n', 'theirs')
  git(repo, 'checkout', '-q', 'main')
  commitFile(repo, 'f.txt', 'ours\n', 'ours')
  tryGit('merge', 'other')
}

describe('readConflict', () => {
  test('returns base, ours, theirs and the working file with markers', async () => {
    mergeConflict()
    const detail = await readConflict(repo, 'f.txt')
    expect(detail).toMatchObject({ kind: 'both-modified', base: 'base\n', ours: 'ours\n', theirs: 'theirs\n', binary: false })
    expect(detail.working).toContain('<<<<<<< HEAD')
  })

  test('refuses files that are not in conflict', async () => {
    mergeConflict()
    await expect(readConflict(repo, 'nope.txt')).rejects.toThrow('not in conflict')
  })
})

describe('resolving a merge', () => {
  test('saves merged content, then continue creates the merge commit', async () => {
    mergeConflict()
    await resolveConflict(repo, 'f.txt', 'ours\ntheirs\n')
    expect((await readStatus(repo)).conflicted).toEqual([])

    await continueOperation(repo)

    expect((await readStatus(repo)).operation).toBeNull()
    expect(git(repo, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2)
    expect(read('f.txt')).toBe('ours\ntheirs\n')
  })

  test('takes a whole side', async () => {
    mergeConflict()
    await resolveConflictWithSide(repo, 'f.txt', 'theirs')
    expect(read('f.txt')).toBe('theirs\n')
    expect((await readStatus(repo)).conflicted).toEqual([])
  })

  test('taking the side that deleted the file removes it', async () => {
    commitFile(repo, 'f.txt', 'base\n')
    git(repo, 'checkout', '-q', '-b', 'other')
    git(repo, 'rm', '-q', 'f.txt')
    git(repo, 'commit', '-q', '-m', 'delete')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'f.txt', 'edited\n')
    tryGit('merge', 'other')
    expect((await readStatus(repo)).conflicted).toEqual([{ path: 'f.txt', kind: 'deleted-by-them' }])

    await resolveConflictWithSide(repo, 'f.txt', 'theirs')

    expect(existsSync(join(repo, 'f.txt'))).toBe(false)
    expect((await readStatus(repo)).conflicted).toEqual([])
  })

  test('continue refuses while conflicts remain; abort restores the branch', async () => {
    mergeConflict()
    await expect(continueOperation(repo)).rejects.toThrow('Resolve all conflicted files first')
    await abortOperation(repo)
    expect((await readStatus(repo)).operation).toBeNull()
    expect(read('f.txt')).toBe('ours\n')
  })
})

describe('resolving a rebase', () => {
  test('continues a rebase after resolution without opening an editor', async () => {
    commitFile(repo, 'f.txt', 'base\n')
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'f.txt', 'topic\n', 'topic change')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'f.txt', 'main\n', 'main change')
    git(repo, 'checkout', '-q', 'topic')
    tryGit('rebase', 'main')
    expect((await readStatus(repo)).operation).toBe('rebase')

    await resolveConflict(repo, 'f.txt', 'main\ntopic\n')
    await continueOperation(repo)

    expect((await readStatus(repo)).operation).toBeNull()
    expect(git(repo, 'log', '--format=%s').trim().split('\n')).toEqual([
      'topic change',
      'main change',
      'base\n'.trim()
    ])
  })
})

describe('insideRepo', () => {
  test('rejects paths escaping the repository', () => {
    expect(() => insideRepo(repo, '../outside.txt')).toThrow('outside the repository')
    expect(() => insideRepo(repo, '/etc/passwd')).toThrow('Invalid repository path')
    expect(insideRepo(repo, 'dir/../f.txt')).toBe(join(repo, 'f.txt'))
  })
})
