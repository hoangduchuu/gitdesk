import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createProviderRepo, publishRepository, type ProviderAccess } from '../src/main/publish'
import { readRemotes } from '../src/main/git/remote'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}
const recorder = (...replies: Response[]): { request: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []
  const request = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : {} })
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    return reply
  }) as unknown as typeof fetch
  return { request, calls }
}

const GITHUB: ProviderAccess = { host: 'github.com', username: 'octo', token: 'gho_secret' }
const NEW = { name: 'my-app', description: 'A thing', private: true }

describe('creating a repository on a provider', () => {
  test('GitHub: user/repos with a bearer token', async () => {
    const { request, calls } = recorder(json({ clone_url: 'https://github.com/octo/my-app.git', html_url: 'https://github.com/octo/my-app' }, 201))
    expect(await createProviderRepo(GITHUB, { provider: 'github', ...NEW }, request)).toEqual({
      cloneUrl: 'https://github.com/octo/my-app.git',
      webUrl: 'https://github.com/octo/my-app'
    })
    expect(calls[0]!.url).toBe('https://api.github.com/user/repos')
    expect(calls[0]!.headers['Authorization']).toBe('Bearer gho_secret')
    expect(calls[0]!.body).toEqual({ name: 'my-app', description: 'A thing', private: true })
  })

  test('GitLab: projects API with a private token and visibility', async () => {
    const access = { host: 'gitlab.example.com:8443', username: 'me', token: 'glpat-1' }
    const { request, calls } = recorder(json({ http_url_to_repo: 'https://gitlab.example.com:8443/me/my-app.git', web_url: 'https://gitlab.example.com:8443/me/my-app' }, 201))
    const created = await createProviderRepo(access, { provider: 'gitlab', ...NEW, private: false }, request)
    expect(created.cloneUrl).toBe('https://gitlab.example.com:8443/me/my-app.git')
    expect(calls[0]!.url).toBe('https://gitlab.example.com:8443/api/v4/projects')
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('glpat-1')
    expect(calls[0]!.body).toMatchObject({ name: 'my-app', path: 'my-app', visibility: 'public' })
  })

  test('Bitbucket: finds the owned workspace, then creates the repository with basic auth', async () => {
    const access = { host: 'bitbucket.org', username: 'me@x.io', token: 'tok' }
    const { request, calls } = recorder(
      json({ values: [{ administrator: false, workspace: { slug: 'other' } }, { administrator: true, workspace: { slug: 'myws' } }] }),
      json({ full_name: 'myws/my-app', links: { clone: [{ name: 'https', href: 'https://me@bitbucket.org/myws/my-app.git' }] } }, 200)
    )
    expect(await createProviderRepo(access, { provider: 'bitbucket', ...NEW }, request)).toEqual({
      cloneUrl: 'https://bitbucket.org/myws/my-app.git',
      webUrl: 'https://bitbucket.org/myws/my-app'
    })
    expect(calls[0]!.url).toContain('/2.0/user/workspaces')
    expect(calls[1]!.url).toBe('https://api.bitbucket.org/2.0/repositories/myws/my-app')
    expect(calls[1]!.headers['Authorization']).toBe(`Basic ${Buffer.from('me@x.io:tok').toString('base64')}`)
    expect(calls[1]!.body).toEqual({ scm: 'git', is_private: true, description: 'A thing' })
  })

  test('Gitea: user/repos with a token header', async () => {
    const access = { host: 'git.example.com', username: 'me', token: 'tok' }
    const { request, calls } = recorder(json({ clone_url: 'https://git.example.com/me/my-app.git', html_url: 'https://git.example.com/me/my-app' }, 201))
    await createProviderRepo(access, { provider: 'gitea', ...NEW }, request)
    expect(calls[0]!.url).toBe('https://git.example.com/api/v1/user/repos')
    expect(calls[0]!.headers['Authorization']).toBe('token tok')
  })

  test("surfaces the provider's own reason", async () => {
    const { request } = recorder(json({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }, 422))
    await expect(createProviderRepo(GITHUB, { provider: 'github', ...NEW }, request)).rejects.toThrow(/422.*already exists/)
    const gitlab = recorder(json({ message: { name: ['has already been taken'] } }, 400))
    await expect(createProviderRepo({ host: 'g.example.com', username: 'u', token: 't' }, { provider: 'gitlab', ...NEW }, gitlab.request)).rejects.toThrow(/has already been taken/)
  })

  test('rejects unsafe names and descriptions before any request, and GitHub on another host', async () => {
    const { request, calls } = recorder()
    for (const name of ['', '-x', '.hidden', 'a b', 'a/b', '../x', 'x'.repeat(101)]) {
      await expect(createProviderRepo(GITHUB, { provider: 'github', ...NEW, name }, request), name).rejects.toThrow(/Invalid repository name/)
    }
    await expect(createProviderRepo(GITHUB, { provider: 'github', ...NEW, description: 'bad\u0000' }, request)).rejects.toThrow(/description/)
    await expect(createProviderRepo({ ...GITHUB, host: 'git.example.com' }, { provider: 'github', ...NEW }, request)).rejects.toThrow(/github\.com/)
    expect(calls).toEqual([])
  })

  test('a network failure is reported without the token', async () => {
    const request = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch
    await expect(createProviderRepo(GITHUB, { provider: 'github', ...NEW }, request)).rejects.toThrow(/Could not reach GitHub: getaddrinfo ENOTFOUND/)
  })
})

describe('publishing a repository', () => {
  let repo: string
  let bare: string
  /** Stand-in for github.com: git is told that the new repository's address lives in a local bare repo. */
  let env: Record<string, string>
  beforeEach(() => {
    repo = initRepo()
    bare = tempDir('gitdesk-bare-')
    dirs.push(repo, bare)
    git(bare, 'init', '-q', '--bare', '-b', 'main')
    commitFile(repo, 'a.txt', 'one\n', 'first')
    env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${bare}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/octo/my-app.git' }
  })

  const reply = (): Response => json({ clone_url: 'https://github.com/octo/my-app.git', html_url: 'https://github.com/octo/my-app' }, 201)
  const input = { remote: 'origin', provider: 'github' as const, ...NEW }

  test('creates the repository, adds the remote and pushes with an upstream', async () => {
    const { request } = recorder(reply())
    expect(await publishRepository(repo, input, GITHUB, env, request)).toEqual({ remote: 'origin', webUrl: 'https://github.com/octo/my-app' })
    expect(await readRemotes(repo)).toEqual([{ name: 'origin', fetchUrl: 'https://github.com/octo/my-app.git', pushUrl: 'https://github.com/octo/my-app.git' }])
    expect(git(bare, 'rev-parse', 'main').trim()).toBe(git(repo, 'rev-parse', 'HEAD').trim())
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe('origin/main')
  })

  test('checks everything it can first, so nothing is created on a bad request', async () => {
    const { request, calls } = recorder(reply())
    const empty = initRepo()
    dirs.push(empty)
    await expect(publishRepository(empty, input, GITHUB, env, request)).rejects.toThrow(/first commit/)
    git(repo, 'remote', 'add', 'origin', 'https://example.com/other.git')
    await expect(publishRepository(repo, input, GITHUB, env, request)).rejects.toThrow(/already exists/)
    git(repo, 'switch', '-q', '--detach')
    await expect(publishRepository(repo, { ...input, remote: 'new' }, GITHUB, env, request)).rejects.toThrow(/detached/)
    expect(calls).toEqual([])
  })

  test('distrusts an address that is not https on the provider host', async () => {
    for (const clone_url of ['file:///etc', 'ext::sh -c id', 'http://github.com/x.git', 'https://evil.example.com/x.git']) {
      const { request } = recorder(json({ clone_url, html_url: 'https://github.com/octo/my-app' }, 201))
      await expect(publishRepository(repo, input, GITHUB, env, request), clone_url).rejects.toThrow(/invalid|unexpected/)
    }
    expect(await readRemotes(repo)).toEqual([])
  })

  test('if only the push fails, says what was already created and keeps the remote', async () => {
    const { request } = recorder(reply())
    const failing = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url./nonexistent/path.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/octo/my-app.git' }
    await expect(publishRepository(repo, input, GITHUB, failing, request)).rejects.toThrow(/Created https:\/\/github\.com\/octo\/my-app and added it as origin, but pushing failed/)
    expect((await readRemotes(repo)).map((r) => r.name)).toEqual(['origin'])
  })
})
