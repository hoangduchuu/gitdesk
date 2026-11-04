import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readBlame } from '../src/main/git/blame'
import { readFileHistory } from '../src/main/git/log'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

const commitAs = (author: string, file: string, content: string, message: string) => {
  writeFile(repo, file, content)
  git(repo, 'add', '--', file)
  git(repo, '-c', `user.name=${author}`, '-c', 'user.email=a@b.c', 'commit', '-q', '--author', `${author} <a@b.c>`, '-m', message)
}
const head = () => git(repo, 'rev-parse', 'HEAD').trim()

describe('readBlame', () => {
  test('credits each line to the commit and author that last changed it', async () => {
    commitAs('Ann', 'f.txt', 'one\ntwo\nthree\n', 'first')
    const first = head()
    commitAs('Bob', 'f.txt', 'one\nTWO\nthree\n', 'shout two')
    const second = head()

    const lines = await readBlame(repo, 'f.txt', null)

    expect(lines.map((l) => [l.line, l.text, l.author, l.hash, l.summary])).toEqual([
      [1, 'one', 'Ann', first, 'first'],
      [2, 'TWO', 'Bob', second, 'shout two'],
      [3, 'three', 'Ann', first, 'first']
    ])
    expect(lines[0]!.boundary).toBe(true)
    expect(lines[1]!.boundary).toBe(false)
  })

  test('blames as of an older commit', async () => {
    commitAs('Ann', 'f.txt', 'one\n', 'first')
    const first = head()
    commitAs('Bob', 'f.txt', 'one\ntwo\n', 'add two')

    const lines = await readBlame(repo, 'f.txt', first)

    expect(lines.map((l) => l.text)).toEqual(['one'])
  })

  test('attributes uncommitted lines to the all-zero hash', async () => {
    commitFile(repo, 'f.txt', 'one\n', 'first')
    writeFile(repo, 'f.txt', 'one\nunsaved\n')

    const lines = await readBlame(repo, 'f.txt', null)

    expect(lines[1]!.hash).toMatch(/^0+$/)
    expect(lines[0]!.hash).not.toMatch(/^0+$/)
  })

  test('follows a renamed file back to the name it had', async () => {
    commitAs('Ann', 'old.txt', 'one\ntwo\nthree\nfour\n', 'create')
    git(repo, 'mv', 'old.txt', 'new.txt')
    git(repo, 'commit', '-q', '-m', 'rename')

    const lines = await readBlame(repo, 'new.txt', null)

    expect(lines.map((l) => l.summary)).toEqual(['create', 'create', 'create', 'create'])
    expect(lines[0]!.path).toBe('old.txt')
  })

  test('fails for a file that does not exist', async () => {
    commitFile(repo, 'f.txt', 'one\n', 'first')

    await expect(readBlame(repo, 'missing.txt', null)).rejects.toThrow(/no such path/)
  })
})

describe('readFileHistory', () => {
  test('lists only the commits that touched the file, newest first', async () => {
    commitFile(repo, 'a.txt', '1\n', 'add a')
    commitFile(repo, 'b.txt', '1\n', 'add b')
    commitFile(repo, 'a.txt', '2\n', 'change a')

    const history = await readFileHistory(repo, 'a.txt', 50)

    expect(history.map((entry) => entry.commit.subject)).toEqual(['change a', 'add a'])
  })

  test('follows the file across a rename', async () => {
    commitFile(repo, 'old.txt', 'one\ntwo\nthree\nfour\n', 'create')
    git(repo, 'mv', 'old.txt', 'new.txt')
    git(repo, 'commit', '-q', '-m', 'rename')
    commitFile(repo, 'new.txt', 'one\ntwo\nthree\nfour\nfive\n', 'extend')

    const history = await readFileHistory(repo, 'new.txt', 50)

    expect(history.map((entry) => entry.commit.subject)).toEqual(['extend', 'rename', 'create'])
    // The name the file had in each commit, so a diff can be opened for it.
    expect(history.map((entry) => entry.path)).toEqual(['new.txt', 'new.txt', 'old.txt'])
  })

  test('respects the limit and the starting commit', async () => {
    commitFile(repo, 'a.txt', '1\n', 'one')
    const first = head()
    commitFile(repo, 'a.txt', '2\n', 'two')
    commitFile(repo, 'a.txt', '3\n', 'three')

    expect(await readFileHistory(repo, 'a.txt', 2)).toHaveLength(2)
    expect((await readFileHistory(repo, 'a.txt', 50, first)).map((entry) => entry.commit.subject)).toEqual(['one'])
  })

  test('is empty for a path that never existed', async () => {
    commitFile(repo, 'a.txt', '1\n', 'one')

    expect(await readFileHistory(repo, 'nope.txt', 50)).toEqual([])
  })
})
