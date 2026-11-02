import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AvatarService, type AvatarLookup } from '../src/main/avatars'
import { readCommitDetails } from '../src/main/git/log'
import { parseRemoteUrl } from '../src/shared/remote-url'
import { commitFile, git, gitEnv, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`
const image = (type = 'image/png', body: Buffer = PNG): Response => new Response(new Uint8Array(body), { headers: { 'content-type': type } })
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const notFound = (): Response => new Response('', { status: 404 })

interface Call {
  url: string
  headers: Record<string, string>
}

/** A fake network: each rule maps a URL prefix to a response. Unlisted URLs fail the test by throwing. */
const network = (rules: Record<string, () => Response>): { request: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []
  const request = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const rule = Object.entries(rules).find(([prefix]) => String(url).startsWith(prefix))
    if (!rule) throw new Error(`unexpected request: ${url}`)
    return rule[1]()
  }) as unknown as typeof fetch
  return { request, calls }
}

let dir: string
let clock: number
beforeEach(() => {
  dir = tempDir('gitdesk-avatars-')
  dirs.push(dir)
  clock = 1_000_000
})
const service = (request: typeof fetch): AvatarService => new AvatarService({ dir, fetch: request, now: () => clock })
const lookup = (over: Partial<AvatarLookup>): AvatarLookup => ({
  remoteUrl: 'https://github.com/octo/app.git',
  hash: 'abc1234',
  emails: [],
  gravatar: false,
  access: null,
  ...over
})

describe('GitHub', () => {
  test('no-reply addresses give the account picture without any API call', async () => {
    const { request, calls } = network({ 'https://avatars.githubusercontent.com/u/42?': () => image(), 'https://github.com/octo.png': () => image() })
    const result = await service(request).lookup(lookup({ remoteUrl: null, emails: ['42+Octo@users.noreply.github.com', 'octo@users.noreply.github.com'] }))
    expect(result).toEqual({ '42+Octo@users.noreply.github.com': PNG_URI, 'octo@users.noreply.github.com': PNG_URI })
    expect(calls.map((c) => c.url)).toEqual(['https://avatars.githubusercontent.com/u/42?s=96', 'https://github.com/octo.png?size=96'])
  })

  test('one commit lookup resolves author and committer, using the token for private repositories', async () => {
    const { request, calls } = network({
      'https://api.github.com/repos/octo/app/commits/abc1234': () =>
        json({
          author: { avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
          committer: { avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' },
          commit: { author: { email: 'Alice@Example.com' }, committer: { email: 'bob@example.com' } }
        }),
      'https://avatars.githubusercontent.com/u/': () => image()
    })
    const result = await service(request).lookup(
      lookup({ emails: ['Alice@Example.com', 'bob@example.com', 'stranger@example.com'], access: { host: 'github.com', username: 'me', token: 'gho_secret' } })
    )
    expect(result).toEqual({ 'Alice@Example.com': PNG_URI, 'bob@example.com': PNG_URI, 'stranger@example.com': null })
    const api = calls.filter((c) => c.url.startsWith('https://api.github.com'))
    expect(api).toHaveLength(1)
    expect(api[0]!.headers['Authorization']).toBe('Bearer gho_secret')
    expect(calls.map((c) => c.url)).toContain('https://avatars.githubusercontent.com/u/1?v=4&s=96')
    expect(calls.filter((c) => c.url.startsWith('https://avatars')).every((c) => c.headers['Authorization'] === undefined)).toBe(true) // the token only goes to the API
  })

  test('answers are cached: in memory, on disk across restarts, and until they expire', async () => {
    const rules = {
      'https://api.github.com/': () => json({ author: { avatar_url: 'https://avatars.githubusercontent.com/u/1' }, commit: { author: { email: 'a@x.com' }, committer: { email: 'a@x.com' } } }),
      'https://avatars.githubusercontent.com/': () => image()
    }
    const first = network(rules)
    const input = lookup({ emails: ['a@x.com'] })
    expect((await service(first.request).lookup(input))['a@x.com']).toBe(PNG_URI)
    const again = network(rules)
    expect((await service(again.request).lookup(input))['a@x.com']).toBe(PNG_URI) // a new process: from disk
    expect(again.calls).toEqual([])
    clock += 8 * 86_400_000
    const later = network(rules)
    await service(later.request).lookup(input)
    expect(later.calls.length).toBeGreaterThan(0) // a week on, ask again
  })

  test('a failed lookup (private repository, not pushed, rate limit) is retried soon, not forever', async () => {
    const fail = network({ 'https://api.github.com/': () => json({ message: 'Not Found' }, 404) })
    const svc = service(fail.request)
    expect(await svc.lookup(lookup({ emails: ['a@x.com'] }))).toEqual({ 'a@x.com': null })
    await svc.lookup(lookup({ emails: ['a@x.com'] }))
    expect(fail.calls).toHaveLength(1) // not hammered
    clock += 11 * 60_000
    await svc.lookup(lookup({ emails: ['a@x.com'] }))
    expect(fail.calls).toHaveLength(2)
  })

  test('someone GitHub does not know is remembered for a day', async () => {
    const net = network({ 'https://api.github.com/': () => json({ author: null, committer: null, commit: { author: { email: 'a@x.com' }, committer: { email: 'a@x.com' } } }) })
    const svc = service(net.request)
    await svc.lookup(lookup({ emails: ['a@x.com'] }))
    await svc.lookup(lookup({ emails: ['a@x.com'], hash: 'def5678' }))
    expect(net.calls).toHaveLength(1)
  })

  test('refuses avatar addresses that are not https GitHub image hosts', async () => {
    const net = network({
      'https://api.github.com/': () =>
        json({ author: { avatar_url: 'https://evil.example.com/a.png' }, committer: { avatar_url: 'http://avatars.githubusercontent.com/u/2' }, commit: { author: { email: 'a@x.com' }, committer: { email: 'b@x.com' } } })
    })
    expect(await service(net.request).lookup(lookup({ emails: ['a@x.com', 'b@x.com'] }))).toEqual({ 'a@x.com': null, 'b@x.com': null })
    expect(net.calls).toHaveLength(1)
  })
})

describe('many people (the commit graph)', () => {
  const commitReply = (email: string, id: number) => (): Response =>
    json({ author: { avatar_url: `https://avatars.githubusercontent.com/u/${id}` }, commit: { author: { email }, committer: { email } } })

  test('each author is found through their own commit, once, whatever the email case', async () => {
    const { request, calls } = network({
      'https://api.github.com/repos/octo/app/commits/aaa1111': commitReply('a@x.com', 1),
      'https://api.github.com/repos/octo/app/commits/bbb2222': commitReply('b@x.com', 2),
      'https://avatars.githubusercontent.com/u/': () => image()
    })
    const result = await service(request).lookupPeople({
      remoteUrl: 'https://github.com/octo/app.git',
      gravatar: false,
      access: null,
      people: [
        { email: 'a@x.com', hash: 'aaa1111' },
        { email: 'A@X.com', hash: 'aaa9999' }, // the same person again: no second lookup
        { email: 'b@x.com', hash: 'bbb2222' }
      ]
    })
    expect(result).toEqual({ 'a@x.com': PNG_URI, 'A@X.com': PNG_URI, 'b@x.com': PNG_URI })
    expect(calls.filter((c) => c.url.startsWith('https://api.github.com')).map((c) => c.url.split('/').pop()).sort()).toEqual(['aaa1111', 'bbb2222'])
  })

  test('only a few lookups run at the same time', async () => {
    let running = 0
    let peak = 0
    const request = (async (url: string) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1
      return String(url).startsWith('https://www.gravatar.com') ? notFound() : json({}, 404)
    }) as unknown as typeof fetch
    const people = Array.from({ length: 12 }, (_, i) => ({ email: `p${i}@x.com`, hash: `abc${1000 + i}` }))
    await service(request).lookupPeople({ remoteUrl: 'https://github.com/octo/app.git', gravatar: true, access: null, people })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  test('after GitHub says rate limit, no more API calls are made until it resets', async () => {
    let calls = 0
    const request = (async () => {
      calls += 1
      return new Response('{}', { status: 403, headers: { 'x-ratelimit-reset': String(Math.floor((clock + 20 * 60_000) / 1000)) } })
    }) as unknown as typeof fetch
    const svc = service(request)
    const people = Array.from({ length: 6 }, (_, i) => ({ email: `p${i}@x.com`, hash: `abc${1000 + i}` }))
    const input = { remoteUrl: 'https://github.com/octo/app.git', gravatar: false, access: null, people }
    await svc.lookupPeople(input)
    expect(calls).toBeLessThanOrEqual(3) // the first lookups already in flight; the rest never asked
    const before = calls
    clock += 11 * 60_000 // their failed entries have expired, but GitHub's limit has not reset
    await svc.lookupPeople(input)
    expect(calls).toBe(before)
    clock += 10 * 60_000 // past the reset
    await svc.lookupPeople(input)
    expect(calls).toBeGreaterThan(before)
  })

  test('an empty list asks nothing', async () => {
    const net = network({})
    expect(await service(net.request).lookupPeople({ remoteUrl: null, gravatar: true, access: null, people: [] })).toEqual({})
    expect(net.calls).toEqual([])
  })
})

describe('GitLab and Gravatar', () => {
  test('a GitLab server is asked for the avatar by email', async () => {
    const net = network({
      'https://gitlab.example.com/api/v4/avatar?email=a%40x.com': () => json({ avatar_url: 'https://gitlab.example.com/uploads/a.png' }),
      'https://gitlab.example.com/uploads/': () => image('image/jpeg')
    })
    const result = await service(net.request).lookup(
      lookup({ remoteUrl: 'git@gitlab.example.com:group/sub/app.git', emails: ['a@x.com'], access: { host: 'gitlab.example.com', username: 'me', token: 'glpat-1' } })
    )
    expect(result['a@x.com']).toBe(`data:image/jpeg;base64,${PNG.toString('base64')}`)
    expect(net.calls[0]!.headers['PRIVATE-TOKEN']).toBe('glpat-1')
  })

  test("GitLab's Gravatar fallback is only followed when Gravatar is allowed", async () => {
    const rules = {
      'https://gitlab.com/api/v4/avatar': () => json({ avatar_url: 'https://www.gravatar.com/avatar/abc?s=96&d=identicon' }),
      'https://www.gravatar.com/': () => image()
    }
    const off = network(rules)
    expect((await service(off.request).lookup(lookup({ remoteUrl: 'https://gitlab.com/g/app.git', emails: ['a@x.com'] })))['a@x.com']).toBeNull()
    expect(off.calls.some((c) => c.url.includes('gravatar.com'))).toBe(false)
  })

  test('Gravatar is asked only when allowed, with a hash and never the address itself', async () => {
    const email = 'Someone@Example.com'
    const hash = createHash('sha256').update('someone@example.com').digest('hex')
    const net = network({ [`https://www.gravatar.com/avatar/${hash}?s=96&d=404`]: () => image() })
    const remote = { remoteUrl: 'https://git.example.com/me/app.git', emails: [email] }
    expect((await service(network({}).request).lookup(lookup({ ...remote, gravatar: false })))[email]).toBeNull() // no request at all
    expect((await service(net.request).lookup(lookup({ ...remote, gravatar: true })))[email]).toBe(PNG_URI)
    expect(net.calls[0]!.url).not.toContain('example.com%')
    expect(net.calls[0]!.url).not.toContain('Someone')
  })

  test('Gravatar having no picture is a quiet null', async () => {
    const net = network({ 'https://www.gravatar.com/': notFound })
    expect((await service(net.request).lookup(lookup({ remoteUrl: null, emails: ['a@x.com'], gravatar: true })))['a@x.com']).toBeNull()
  })
})

describe('safety', () => {
  test.each([
    ['svg', () => image('image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'))],
    ['html', () => image('text/html', Buffer.from('<script>x</script>'))],
    ['too large', () => image('image/png', Buffer.alloc(600 * 1024))],
    ['empty', () => image('image/png', Buffer.alloc(0))]
  ])('does not accept %s as a picture', async (_name, reply) => {
    const net = network({ 'https://www.gravatar.com/': reply })
    expect((await service(net.request).lookup(lookup({ remoteUrl: null, emails: ['a@x.com'], gravatar: true })))['a@x.com']).toBeNull()
  })

  test('a network error is just no picture, and no emails means no requests', async () => {
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await service(boom).lookup(lookup({ emails: ['a@x.com'], gravatar: true }))).toEqual({ 'a@x.com': null })
    const net = network({})
    expect(await service(net.request).lookup(lookup({ emails: [] }))).toEqual({})
    expect(net.calls).toEqual([])
  })
})

describe('remote addresses', () => {
  test('are split into host, owner and repository', () => {
    expect(parseRemoteUrl('https://github.com/octo/app.git')).toEqual({ host: 'github.com', owner: 'octo', repo: 'app' })
    expect(parseRemoteUrl('https://me:tok@GitHub.com/octo/app/')).toEqual({ host: 'github.com', owner: 'octo', repo: 'app' })
    expect(parseRemoteUrl('git@github.com:octo/app.git')).toEqual({ host: 'github.com', owner: 'octo', repo: 'app' })
    expect(parseRemoteUrl('ssh://git@git.example.com:2222/group/sub/app.git')).toEqual({ host: 'git.example.com', owner: 'group/sub', repo: 'app' })
    for (const bad of ['', '/srv/git/app.git', 'file:///srv/app.git', 'app.git', 'https://github.com/only']) expect(parseRemoteUrl(bad), bad).toBeNull()
  })
})

describe('commit details', () => {
  test('tell author and committer apart, with both times', async () => {
    const repo = initRepo()
    dirs.push(repo)
    commitFile(repo, 'a.txt', 'x\n', 'subject')
    const env = {
      ...gitEnv,
      GIT_AUTHOR_NAME: 'Alice',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_NAME: 'Bot',
      GIT_COMMITTER_EMAIL: 'bot@example.com',
      GIT_COMMITTER_DATE: '2021-06-01T12:00:00Z'
    }
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'by alice, recorded by a bot'], { cwd: repo, env })
    const hash = git(repo, 'rev-parse', 'HEAD').trim()
    expect(await readCommitDetails(repo, hash)).toEqual({
      hash,
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      authorTime: Date.parse('2020-01-01T00:00:00Z') / 1000,
      committerName: 'Bot',
      committerEmail: 'bot@example.com',
      committerTime: Date.parse('2021-06-01T12:00:00Z') / 1000
    })
    await expect(readCommitDetails(repo, 'deadbeef')).rejects.toThrow()
  })
})
