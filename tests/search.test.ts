import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { searchCommits } from '../src/main/git/search'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

const subjects = async (mode: Parameters<typeof searchCommits>[1], query: string, limit = 50) =>
  (await searchCommits(repo, mode, query, limit)).map((commit) => commit.subject)

const commitAs = (author: string, email: string, file: string, content: string, message: string) => {
  writeFile(repo, file, content)
  git(repo, 'add', '--', file)
  git(repo, '-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-q', '--author', `${author} <${email}>`, '-m', message)
}

describe('searchCommits', () => {
  test('message: finds commits by text in the message, ignoring case', async () => {
    commitFile(repo, 'a.txt', '1\n', 'Fix login crash')
    commitFile(repo, 'b.txt', '1\n', 'Add search')

    expect(await subjects('message', 'LOGIN')).toEqual(['Fix login crash'])
  })

  test('message: also looks in the body', async () => {
    writeFile(repo, 'a.txt', '1\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'subject only', '-m', 'the body mentions zebra')

    expect(await subjects('message', 'zebra')).toEqual(['subject only'])
  })

  test('takes the query literally, not as a pattern or an option', async () => {
    commitFile(repo, 'a.txt', '1\n', 'abc')
    commitFile(repo, 'b.txt', '1\n', 'a.c')
    commitFile(repo, 'c.txt', '1\n', 'option --all')

    expect(await subjects('message', 'a.c')).toEqual(['a.c'])
    expect(await subjects('message', '--all')).toEqual(['option --all'])
    expect(await subjects('message', '.*')).toEqual([])
  })

  test('author: matches name or email', async () => {
    commitAs('Ann Lee', 'ann@example.com', 'a.txt', '1\n', 'by ann')
    commitAs('Bob Roe', 'bob@work.org', 'b.txt', '1\n', 'by bob')

    expect(await subjects('author', 'ann lee')).toEqual(['by ann'])
    expect(await subjects('author', 'work.org')).toEqual(['by bob'])
  })

  test('content: finds the commits that added or removed the text', async () => {
    commitFile(repo, 'a.txt', 'alpha\n', 'add alpha')
    commitFile(repo, 'a.txt', 'alpha\nneedle\n', 'add needle')
    commitFile(repo, 'a.txt', 'alpha\n', 'remove needle')
    commitFile(repo, 'b.txt', 'other\n', 'unrelated')

    expect(await subjects('content', 'needle')).toEqual(['remove needle', 'add needle'])
  })

  test('content: a query that looks like an option is still just text', async () => {
    commitFile(repo, 'a.txt', 'x --force y\n', 'add flag text')

    expect(await subjects('content', '--force')).toEqual(['add flag text'])
  })

  test('path: finds commits that touched a file or anything in a folder', async () => {
    commitFile(repo, 'src/a.ts', '1\n', 'touch a')
    commitFile(repo, 'src/deep/b.ts', '1\n', 'touch b')
    commitFile(repo, 'README.md', '1\n', 'touch readme')

    expect(await subjects('path', 'src/a.ts')).toEqual(['touch a'])
    expect(await subjects('path', 'src')).toEqual(['touch b', 'touch a'])
  })

  test('path: pathspec magic in the query is not interpreted', async () => {
    commitFile(repo, 'a.txt', '1\n', 'touch a')

    expect(await subjects('path', '*.txt')).toEqual([])
    expect(await subjects('path', ':(top)a.txt')).toEqual([])
  })

  test('searches every branch, not only the checked-out one', async () => {
    commitFile(repo, 'a.txt', '1\n', 'on main')
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'b.txt', '1\n', 'on topic needle')
    git(repo, 'checkout', '-q', 'main')

    expect(await subjects('message', 'needle')).toEqual(['on topic needle'])
  })

  test('leaves out the commits stashes are made of', async () => {
    commitFile(repo, 'a.txt', '1\n', 'base')
    writeFile(repo, 'a.txt', '2\n')
    git(repo, 'stash', 'push', '-q', '-m', 'needle stash')

    expect(await subjects('message', 'needle')).toEqual([])
  })

  test('respects the limit and returns nothing when nothing matches', async () => {
    commitFile(repo, 'a.txt', '1\n', 'item one')
    commitFile(repo, 'a.txt', '2\n', 'item two')
    commitFile(repo, 'a.txt', '3\n', 'item three')

    expect(await subjects('message', 'item', 2)).toHaveLength(2)
    expect(await subjects('message', 'nothing like this')).toEqual([])
  })

  test('refuses an empty query', () => {
    expect(() => searchCommits(repo, 'message', '', 10)).toThrow('Nothing to search for')
  })
})
