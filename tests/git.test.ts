import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GitError, runGit } from '../src/main/git/exec'
import { readLog } from '../src/main/git/log'
import { resolveRepo } from '../src/main/git/repo'

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null'
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' })

const commitFile = (cwd: string, file: string, message: string): void => {
  writeFileSync(join(cwd, file), `${message}\n`)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

let repo: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gitdesk-'))
  git(repo, 'init', '-q', '-b', 'main')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('runGit', () => {
  test('returns stdout of a successful command', async () => {
    const out = await runGit(repo, ['rev-parse', '--is-inside-work-tree'])
    expect(out.trim()).toBe('true')
  })

  test('throws GitError carrying stderr when git fails', async () => {
    await expect(runGit(repo, ['rev-parse', 'no-such-ref'])).rejects.toBeInstanceOf(GitError)
  })
})

describe('resolveRepo', () => {
  test('returns the top-level folder and current branch', async () => {
    commitFile(repo, 'a.txt', 'first')
    const info = await resolveRepo(join(repo, '.'))
    expect(info.path).toBe(git(repo, 'rev-parse', '--show-toplevel').trim())
    expect(info.head).toBe('main')
  })

  test('reports a missing folder clearly', async () => {
    await expect(resolveRepo(join(repo, 'missing'))).rejects.toThrow('Folder not found')
  })

  test('rejects a folder that is not a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'gitdesk-plain-'))
    try {
      await expect(resolveRepo(plain)).rejects.toThrow()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('readLog', () => {
  test('returns an empty list for a repository without commits', async () => {
    expect(await readLog(repo, 100)).toEqual([])
  })

  test('reads commits newest first with parents, refs and subjects', async () => {
    commitFile(repo, 'a.txt', 'first')
    git(repo, 'checkout', '-q', '-b', 'feature')
    commitFile(repo, 'b.txt', 'on feature | with pipe')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'c.txt', 'on main')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')

    const log = await readLog(repo, 100)

    // Topological order fixes the merge first and the root last; siblings may come in either order.
    const subjects = log.map((c) => c.subject)
    expect(subjects[0]).toBe('merge feature')
    expect(subjects[3]).toBe('first')
    expect([...subjects].sort()).toEqual(
      ['first', 'merge feature', 'on feature | with pipe', 'on main'].sort()
    )
    expect(log[0]!.parents).toHaveLength(2)
    expect(log[0]!.refs).toContainEqual({ name: 'main', kind: 'head' })
    expect(log.find((c) => c.subject.startsWith('on feature'))!.refs).toContainEqual({
      name: 'feature',
      kind: 'branch'
    })
    expect(log[3]!.parents).toEqual([])
    expect(log[0]!.authorName).toBe('Tester')
    expect(log[0]!.authorTime).toBeGreaterThan(0)
  })

  test('reads the commit body separately from the subject', async () => {
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '-m', 'Subject line', '-m', 'First body line\nsecond line', '-m', 'Co-Authored-By: Bob')
    commitFile(repo, 'b.txt', 'no body')

    const log = await readLog(repo, 10)

    expect(log[1]).toMatchObject({ subject: 'Subject line', body: 'First body line\nsecond line\n\nCo-Authored-By: Bob' })
    expect(log[0]!.body).toBe('')
  })

  test('respects the limit', async () => {
    commitFile(repo, 'a.txt', 'one')
    commitFile(repo, 'a.txt', 'two')
    commitFile(repo, 'a.txt', 'three')

    const log = await readLog(repo, 2)
    expect(log.map((c) => c.subject)).toEqual(['three', 'two'])
  })
})
