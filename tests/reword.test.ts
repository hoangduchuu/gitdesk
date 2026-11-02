import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { rewordCommit } from '../src/main/git/reword'
import { readStatus } from '../src/main/git/status'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

let repo: string
let h: string[]
const head = (): string => git(repo, 'rev-parse', 'HEAD').trim()
const subjects = (): string[] => git(repo, 'log', '--format=%s').trim().split('\n')
const treeOf = (ref: string): string => git(repo, 'rev-parse', `${ref}^{tree}`).trim()

beforeEach(() => {
  repo = initRepo()
  dirs.push(repo)
  h = []
  for (const name of ['one', 'two', 'three', 'four']) {
    commitFile(repo, `${name}.txt`, `${name}\n`, name)
    h.push(head())
  }
})

describe('the newest commit', () => {
  test('is amended: new message, same files and author', async () => {
    const tree = treeOf('HEAD')
    const author = git(repo, 'log', '-1', '--format=%an <%ae> %at')
    expect(await rewordCommit(repo, h[3]!, 'four, better\n\nWith a body.\n', null)).toEqual({ conflicts: false, published: false })
    expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe('four, better\n\nWith a body.')
    expect(treeOf('HEAD')).toBe(tree)
    expect(git(repo, 'log', '-1', '--format=%an <%ae> %at')).toBe(author)
    expect(head()).not.toBe(h[3])
  })

  test('leaves staged and unstaged changes alone', async () => {
    writeFile(repo, 'new.txt', 'staged\n')
    git(repo, 'add', 'new.txt')
    writeFile(repo, 'one.txt', 'edited\n')
    await rewordCommit(repo, h[3]!, 'only the message', null)
    expect(git(repo, 'show', '--stat', '--format=%s', 'HEAD')).not.toContain('new.txt')
    const status = await readStatus(repo)
    expect(status.staged.map((f) => f.path)).toEqual(['new.txt'])
    expect(status.unstaged.map((f) => f.path)).toEqual(['one.txt'])
  })

  test('uses the profile as committer', async () => {
    await rewordCommit(repo, h[3]!, 'as someone else', { name: 'Work Me', email: 'work@example.com' })
    expect(git(repo, 'log', '-1', '--format=%cn <%ce>').trim()).toBe('Work Me <work@example.com>')
    expect(git(repo, 'log', '-1', '--format=%an').trim()).toBe('Tester')
  })
})

describe('an older commit', () => {
  test('is reworded through a rebase; everything else is unchanged', async () => {
    const trees = ['HEAD~3', 'HEAD~2', 'HEAD~1', 'HEAD'].map(treeOf)
    await rewordCommit(repo, h[1]!, 'two, reworded', null)
    expect(subjects()).toEqual(['four', 'three', 'two, reworded', 'one'])
    expect(['HEAD~3', 'HEAD~2', 'HEAD~1', 'HEAD'].map(treeOf)).toEqual(trees)
    expect(git(repo, 'rev-parse', 'HEAD~3').trim()).toBe(h[0]) // earlier commits keep their hash
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })

  test('works for the commit right after the root and keeps a multi-line message', async () => {
    await rewordCommit(repo, h[1]!, 'Subject\n\nBody line 1\nBody line 2', null)
    expect(git(repo, 'log', '--format=%B', '-1', 'HEAD~2').trim()).toBe('Subject\n\nBody line 1\nBody line 2')
  })

  test('refuses over uncommitted changes, and changes nothing', async () => {
    writeFile(repo, 'one.txt', 'dirty\n')
    await expect(rewordCommit(repo, h[1]!, 'x', null)).rejects.toThrow(/Commit or stash/)
    expect(subjects()).toEqual(['four', 'three', 'two', 'one'])
  })
})

describe('empty commits and failures', () => {
  test('commits with no file changes can be reworded, newest or older', async () => {
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'empty one')
    const empty = head()
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'empty two')
    await rewordCommit(repo, empty, 'empty one, reworded', null) // older: through the rebase
    await rewordCommit(repo, head(), 'empty two, reworded', null) // newest: amended
    expect(subjects().slice(0, 2)).toEqual(['empty two, reworded', 'empty one, reworded'])
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })

  test('if git refuses the new message, the branch is put back as it was', async () => {
    const hook = join(repo, '.git', 'hooks', 'commit-msg')
    writeFileSync(hook, '#!/bin/sh\ngrep -q BAD "$1" && { echo "no BAD words"; exit 1; }\nexit 0\n')
    chmodSync(hook, 0o755)

    const before = subjects()
    await expect(rewordCommit(repo, h[1]!, 'a BAD message', null)).rejects.toThrow()
    expect((await readStatus(repo)).operation).toBeNull()
    expect((await readStatus(repo)).branch).toBe('main')
    expect(subjects()).toEqual(before)
    expect(head()).toBe(h[3])
  })
})

describe('what cannot be reworded', () => {
  test('an empty message, the root commit, a merge commit, other branches, a detached HEAD, a rebase in progress', async () => {
    await expect(rewordCommit(repo, h[3]!, '   \n', null)).rejects.toThrow(/empty/)
    await expect(rewordCommit(repo, h[0]!, 'new', null)).rejects.toThrow(/first commit/)

    git(repo, 'switch', '-q', '-c', 'side', h[1]!)
    commitFile(repo, 'side.txt', 's\n', 'side work')
    const side = head()
    git(repo, 'switch', '-q', 'main')
    await expect(rewordCommit(repo, side, 'x', null)).rejects.toThrow(/not on the current branch/)

    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    const merge = head()
    await expect(rewordCommit(repo, merge, 'x', null)).resolves.toMatchObject({ conflicts: false }) // HEAD itself may be amended
    commitFile(repo, 'after.txt', 'a\n', 'after the merge')
    await expect(rewordCommit(repo, h[2]!, 'x', null)).rejects.toThrow(/merge commits/) // the range holds a merge

    git(repo, 'switch', '-q', '--detach')
    await expect(rewordCommit(repo, head(), 'x', null)).rejects.toThrow(/detached/)
  })
})

describe('published commits', () => {
  test('are reported, so the caller can offer a force push', async () => {
    const origin = tempDir('gitdesk-origin-')
    dirs.push(origin)
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    commitFile(repo, 'local.txt', 'l\n', 'local only')
    expect((await rewordCommit(repo, head(), 'local only, edited', null)).published).toBe(false)
    // Newest to oldest: rewording a commit changes the hash of everything after it, not before it.
    expect((await rewordCommit(repo, h[3]!, 'four, edited', null)).published).toBe(true)
    expect((await rewordCommit(repo, h[2]!, 'three, edited', null)).published).toBe(true)
    expect((await rewordCommit(repo, h[1]!.slice(0, 7), 'two, edited', null)).published).toBe(true) // short hashes resolve too
  })
})
