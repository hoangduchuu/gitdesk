import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { checkoutPullRequest, createPullRequest, githubTarget, listPullRequests } from '../src/main/pullRequests'
import type { ProviderAccess } from '../src/main/publish'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}
const recorder = (...replies: Response[]): { request: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []
  const request = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} })
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    return reply
  }) as unknown as typeof fetch
  return { request, calls }
}

const ACCESS: ProviderAccess = { host: 'github.com', username: 'octo', token: 'gho_secret' }
const TARGET = { remote: 'origin', owner: 'octo', repo: 'app' }
const RAW = {
  number: 7,
  title: 'Fix it',
  user: { login: 'hubot' },
  head: { ref: 'fix' },
  base: { ref: 'main' },
  html_url: 'https://github.com/octo/app/pull/7',
  draft: false
}

describe('githubTarget', () => {
  const remote = (name: string, fetchUrl: string) => ({ name, fetchUrl, pushUrl: fetchUrl })

  test('reads owner and repo from https and ssh remotes, preferring origin', () => {
    expect(githubTarget([remote('up', 'https://github.com/a/b.git'), remote('origin', 'git@github.com:octo/app.git')])).toEqual(TARGET)
  })

  test('ignores other hosts, local paths and nested groups', () => {
    expect(githubTarget([remote('origin', 'https://gitlab.com/a/b.git'), remote('x', '/tmp/repo'), remote('y', 'https://github.com/a/b/c.git')])).toBeNull()
  })

  test('uses another remote when origin is elsewhere', () => {
    expect(githubTarget([remote('origin', 'https://gitlab.com/a/b.git'), remote('fork', 'https://github.com/me/app')])).toEqual({ remote: 'fork', owner: 'me', repo: 'app' })
  })
})

describe('listPullRequests', () => {
  test('asks for open pull requests with the token and maps the answer', async () => {
    const { request, calls } = recorder(json([RAW, { ...RAW, number: 8, draft: true }]))

    const list = await listPullRequests(ACCESS, TARGET, request)

    expect(calls[0]!.url).toContain('https://api.github.com/repos/octo/app/pulls?state=open')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.headers['Authorization']).toBe('Bearer gho_secret')
    expect(list[0]).toEqual({ number: 7, title: 'Fix it', author: 'hubot', head: 'fix', base: 'main', url: 'https://github.com/octo/app/pull/7', draft: false })
    expect(list[1]!.draft).toBe(true)
  })

  test('explains a refusal and never echoes the token', async () => {
    const { request } = recorder(json({ message: 'Not Found' }, 404))

    const failure = await listPullRequests(ACCESS, TARGET, request).catch((error: Error) => error)

    expect((failure as Error).message).toContain('Not Found')
    expect((failure as Error).message).not.toContain('gho_secret')
  })

  test('refuses a profile connected to another host without calling out', async () => {
    const { request, calls } = recorder()

    await expect(listPullRequests({ ...ACCESS, host: 'git.example.com' }, TARGET, request)).rejects.toThrow('not connected to github.com')
    expect(calls).toHaveLength(0)
  })

  test('rejects a pull request with a link that is not on github.com', async () => {
    const { request } = recorder(json([{ ...RAW, html_url: 'https://evil.example/x' }]))

    await expect(listPullRequests(ACCESS, TARGET, request)).rejects.toThrow('unexpected pull request')
  })
})

describe('createPullRequest', () => {
  test('posts title, body, branches and draft flag', async () => {
    const { request, calls } = recorder(json(RAW, 201))

    const created = await createPullRequest(ACCESS, TARGET, { title: 'Fix it', body: 'Because', head: 'fix', base: 'main', draft: true }, request)

    expect(calls[0]!.url).toBe('https://api.github.com/repos/octo/app/pulls')
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({ title: 'Fix it', body: 'Because', head: 'fix', base: 'main', draft: true })
    expect(created.number).toBe(7)
  })

  test('shows GitHub\'s reason when it refuses', async () => {
    const { request } = recorder(json({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] }, 422))

    await expect(createPullRequest(ACCESS, TARGET, { title: 't', body: '', head: 'fix', base: 'main', draft: false }, request)).rejects.toThrow('A pull request already exists')
  })
})

describe('checkoutPullRequest', () => {
  let origin: string
  let clone: string
  beforeEach(() => {
    origin = initRepo()
    commitFile(origin, 'a.txt', 'one\n', 'first')
    clone = tempDir('gitdesk-clone-')
    git(clone, 'clone', '-q', origin, '.')
    // What GitHub provides: refs/pull/<n>/head on the server.
    git(origin, 'checkout', '-q', '-b', 'feature')
    commitFile(origin, 'b.txt', 'bee\n', 'pr work')
    git(origin, 'update-ref', 'refs/pull/5/head', 'HEAD')
    git(origin, 'checkout', '-q', 'main')
  })
  afterEach(() => {
    removeDir(origin)
    removeDir(clone)
  })

  test('fetches the head into a new pr-<n> branch and switches to it', async () => {
    await checkoutPullRequest(clone, 'origin', 5)

    expect(git(clone, 'branch', '--show-current').trim()).toBe('pr-5')
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('pr work')
  })

  test('reuses an existing pr-<n> branch instead of overwriting it', async () => {
    await checkoutPullRequest(clone, 'origin', 5)
    git(clone, 'checkout', '-q', 'main')
    git(clone, 'checkout', '-q', 'pr-5')
    commitFile(clone, 'c.txt', 'mine\n', 'my local commit')
    git(clone, 'checkout', '-q', 'main')

    await checkoutPullRequest(clone, 'origin', 5)

    expect(git(clone, 'branch', '--show-current').trim()).toBe('pr-5')
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('my local commit')
  })

  test('fails clearly for a pull request that does not exist', async () => {
    await expect(checkoutPullRequest(clone, 'origin', 99)).rejects.toThrow()
  })
})
