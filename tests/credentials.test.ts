import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Credentials, VERIFICATION_URL, type SecretBox } from '../src/main/credentials'

const secrets: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (buffer) => buffer.toString().replace(/^enc:/, '')
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const DEVICE = { device_code: 'dev123', user_code: 'ABCD-1234', interval: 5, expires_in: 900 }
const USER = { login: 'octo' }

let dir: string
let file: string
let opened: string[]
let sleeps: number[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitdesk-gh-'))
  file = join(dir, 'github.json')
  opened = []
  sleeps = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const make = (replies: Array<Response | Error>, clientId = 'client-1'): { auth: Credentials; calls: string[] } => {
  const calls: string[] = []
  const auth = new Credentials({
    file,
    clientId,
    secrets,
    openExternal: async (url) => void opened.push(url),
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`)
      const reply = replies.shift()
      if (!reply) throw new Error('unexpected request')
      if (reply instanceof Error) throw reply
      return reply
    }
  })
  return { auth, calls }
}

describe('Credentials', () => {
  const connect = async (auth: Credentials, profileId: string): Promise<void> => {
    await auth.startGithubLogin()
    await auth.completeGithubLogin(profileId)
  }
  const login = (): Response[] => [json(DEVICE), json({ access_token: 'gho_secret' }), json(USER)]
  const basicOf = (env: Record<string, string>): string =>
    Buffer.from(env['GIT_CONFIG_VALUE_0']!.replace('Authorization: Basic ', ''), 'base64').toString()

  test('GitHub device flow: shows the code, polls until approved, stores an encrypted token', async () => {
    const { auth, calls } = make([
      json(DEVICE),
      json({ error: 'authorization_pending' }),
      json({ error: 'slow_down' }),
      json({ access_token: 'gho_secret' }),
      json(USER)
    ])
    expect(await auth.startGithubLogin()).toEqual({ userCode: 'ABCD-1234', verificationUri: VERIFICATION_URL, expiresIn: 900 })
    expect(opened).toEqual([VERIFICATION_URL])
    expect(calls[0]).toContain('client_id=client-1')

    expect(await auth.completeGithubLogin('p1')).toEqual({ kind: 'github', login: 'octo' })
    expect(sleeps).toEqual([5000, 5000, 10_000]) // slow_down adds 5 seconds
    expect(await auth.status()).toEqual({ githubConfigured: true, byProfile: { p1: { kind: 'github', login: 'octo' } } })
    expect(await readFile(file, 'utf8')).not.toContain('gho_secret')
  })

  test('git environment: the profile token for github.com, SSH addresses read as https', async () => {
    const { auth } = make(login())
    expect(await auth.gitEnv('p1')).toEqual({}) // not connected
    expect(await auth.gitEnv(null)).toEqual({}) // repository without a profile
    await connect(auth, 'p1')
    const env = await auth.gitEnv('p1')
    expect(env['GIT_CONFIG_KEY_0']).toBe('http.https://github.com/.extraheader')
    expect(basicOf(env)).toBe('x-access-token:gho_secret')
    expect(env['GIT_CONFIG_COUNT']).toBe('3')
    expect([env['GIT_CONFIG_VALUE_1'], env['GIT_CONFIG_VALUE_2']]).toEqual(['git@github.com:', 'ssh://git@github.com/'])
    expect(await auth.gitEnv('other-profile')).toEqual({})
  })

  test('each profile has its own provider: GitHub and a custom server side by side', async () => {
    const { auth } = make(login())
    await connect(auth, 'work')
    expect(await auth.setToken('home', ' GitLab.example.com:8443 ', 'me', 'glpat-1')).toEqual({
      kind: 'token',
      host: 'gitlab.example.com:8443',
      username: 'me'
    })
    const home = await auth.gitEnv('home')
    expect(home['GIT_CONFIG_KEY_0']).toBe('http.https://gitlab.example.com:8443/.extraheader')
    expect(basicOf(home)).toBe('me:glpat-1')
    // SSH forms carry no port; the rewrite points them at the https address.
    expect(home['GIT_CONFIG_KEY_1']).toBe('url.https://gitlab.example.com:8443/.insteadOf')
    expect([home['GIT_CONFIG_VALUE_1'], home['GIT_CONFIG_VALUE_2']]).toEqual([
      'git@gitlab.example.com:',
      'ssh://git@gitlab.example.com/'
    ])
    expect(basicOf(await auth.gitEnv('work'))).toBe('x-access-token:gho_secret')
    expect(Object.keys((await auth.status()).byProfile).sort()).toEqual(['home', 'work'])
    expect(await readFile(file, 'utf8')).not.toContain('glpat-1')
  })

  test('connecting a profile again replaces its connection; remove disconnects it', async () => {
    const { auth } = make(login())
    await connect(auth, 'p1')
    await auth.setToken('p1', 'git.example.com', 'me', 'tok')
    expect((await auth.status()).byProfile['p1']).toEqual({ kind: 'token', host: 'git.example.com', username: 'me' })
    await auth.remove('p1')
    expect((await auth.status()).byProfile).toEqual({})
    expect(await auth.gitEnv('p1')).toEqual({})
  })

  test.each([
    ['', 'me', 't', /host/i],
    ['bad host/x', 'me', 't', /host/i],
    ['evil.com\nGIT_X', 'me', 't', /host/i],
    ['git.example.com', '', 't', /username/i],
    ['git.example.com', 'a:b', 't', /username/i],
    ['git.example.com', 'me', '', /token/i]
  ])('rejects unsafe custom server details (%j, %j)', async (host, user, token, message) => {
    const { auth } = make([])
    await expect(auth.setToken('p', host, user, token)).rejects.toThrow(message)
  })

  test.each([
    ['expired_token', /expired/],
    ['access_denied', /denied/]
  ])('%s ends the GitHub sign-in with a message', async (error, message) => {
    const { auth } = make([json(DEVICE), json({ error })])
    await auth.startGithubLogin()
    await expect(auth.completeGithubLogin('p')).rejects.toThrow(message)
    await expect(auth.completeGithubLogin('p')).rejects.toThrow(/No GitHub sign-in/)
  })

  test('cancelling stops a waiting sign-in', async () => {
    const auth = new Credentials({
      file,
      clientId: 'c',
      secrets,
      openExternal: async () => undefined,
      sleep: () => new Promise(() => undefined), // never wakes: only cancel can end it
      fetch: async () => json(DEVICE)
    })
    await auth.startGithubLogin()
    const waiting = auth.completeGithubLogin('p')
    auth.cancelGithubLogin()
    await expect(waiting).rejects.toThrow('Sign-in cancelled')
  })

  test('refuses to start without a client ID or without secure storage', async () => {
    await expect(make([], '').auth.startGithubLogin()).rejects.toThrow(/not configured/)
    expect((await make([], '').auth.status()).githubConfigured).toBe(false)
    const noStorage = { ...secrets, isEncryptionAvailable: () => false }
    const auth = new Credentials({ file, clientId: 'c', secrets: noStorage, openExternal: async () => undefined })
    await expect(auth.startGithubLogin()).rejects.toThrow(/Secure storage/)
    await expect(auth.setToken('p', 'git.example.com', 'me', 't')).rejects.toThrow(/Secure storage/)
  })

  test('an unreadable keychain entry counts as not connected', async () => {
    const { auth } = make(login())
    await connect(auth, 'p1')
    const broken = new Credentials({
      file,
      clientId: 'c',
      secrets: { ...secrets, decryptString: () => { throw new Error('keychain changed') } },
      openExternal: async () => undefined
    })
    expect(await broken.gitEnv('p1')).toEqual({})
  })

  test('accessFor gives the main process the host, user and token of a profile, and null when not connected', async () => {
    const { auth } = make(login())
    expect(await auth.accessFor('p1')).toBeNull()
    expect(await auth.accessFor(null)).toBeNull()
    await connect(auth, 'p1')
    await auth.setToken('p2', 'git.example.com:8443', 'me', 'tok')
    expect(await auth.accessFor('p1')).toEqual({ host: 'github.com', username: 'octo', token: 'gho_secret' })
    expect(await auth.accessFor('p2')).toEqual({ host: 'git.example.com:8443', username: 'me', token: 'tok' })
  })
})
