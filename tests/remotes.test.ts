import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addRemote, pushTo, readRemotes, removeRemote, requireRemoteUrl, setRemoteUrl } from '../src/main/git/remote'
import { readBranches } from '../src/main/git/branches'
import { guessProvider, maskUrl } from '../src/shared/remote-url'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

let repo: string
beforeEach(() => {
  repo = initRepo()
  dirs.push(repo)
  commitFile(repo, 'a.txt', 'one\n', 'first')
})

describe('managing remotes', () => {
  test('adds, lists, changes and removes a remote', async () => {
    expect(await readRemotes(repo)).toEqual([])
    await addRemote(repo, 'origin', 'https://github.com/me/app.git')
    await addRemote(repo, 'backup', 'git@example.com:me/app.git')
    expect(await readRemotes(repo)).toEqual([
      { name: 'backup', fetchUrl: 'git@example.com:me/app.git', pushUrl: 'git@example.com:me/app.git' },
      { name: 'origin', fetchUrl: 'https://github.com/me/app.git', pushUrl: 'https://github.com/me/app.git' }
    ])

    await setRemoteUrl(repo, 'origin', ' https://gitlab.com/me/app.git ')
    expect((await readRemotes(repo)).find((r) => r.name === 'origin')?.fetchUrl).toBe('https://gitlab.com/me/app.git')

    await removeRemote(repo, 'backup')
    expect((await readRemotes(repo)).map((r) => r.name)).toEqual(['origin'])
    await removeRemote(repo, 'origin')
    expect(await readRemotes(repo)).toEqual([])
  })

  test('shows URLs as written, not as rewritten by insteadOf, and a separate push URL', async () => {
    git(repo, 'remote', 'add', 'origin', 'https://github.com/me/app.git')
    git(repo, 'config', '--local', 'url.git@github.com:.insteadOf', 'https://github.com/')
    git(repo, 'config', '--local', 'remote.origin.pushurl', 'https://push.example.com/me/app.git')
    expect(await readRemotes(repo)).toEqual([
      { name: 'origin', fetchUrl: 'https://github.com/me/app.git', pushUrl: 'https://push.example.com/me/app.git' }
    ])
  })

  test('removing a remote also drops its remote-tracking branches here', async () => {
    const origin = tempDir('gitdesk-origin-')
    dirs.push(origin)
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    await addRemote(repo, 'origin', origin)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    expect((await readBranches(repo)).some((b) => b.kind === 'remote')).toBe(true)
    await removeRemote(repo, 'origin')
    expect((await readBranches(repo)).filter((b) => b.kind === 'remote')).toEqual([])
    expect((await readBranches(repo)).find((b) => b.name === 'main')?.upstream).toBeNull()
  })

  test('refuses bad names, duplicates, unknown remotes and addresses git could run as commands', async () => {
    await addRemote(repo, 'origin', 'https://example.com/a.git')
    await expect(addRemote(repo, 'origin', 'https://example.com/b.git')).rejects.toThrow(/already exists/)
    await expect(addRemote(repo, 'bad name', 'https://example.com/a.git')).rejects.toThrow(/valid remote name/)
    await expect(addRemote(repo, '-x', 'https://example.com/a.git')).rejects.toThrow(/valid remote name/)
    await expect(setRemoteUrl(repo, 'ghost', 'https://example.com/a.git')).rejects.toThrow(/no remote named/)
    await expect(removeRemote(repo, 'ghost')).rejects.toThrow(/no remote named/)
    for (const url of ['', '   ', '--upload-pack=touch x', 'ext::sh -c touch% x', 'fd::17', 'https://a\nb']) {
      expect(() => requireRemoteUrl(url), JSON.stringify(url)).toThrow(/Invalid remote URL/)
      await expect(addRemote(repo, 'other', url)).rejects.toThrow(/Invalid remote URL/)
    }
    expect((await readRemotes(repo)).map((r) => r.name)).toEqual(['origin'])
  })

  test('accepts the usual address forms', () => {
    for (const url of ['https://github.com/me/app.git', 'ssh://git@host:2222/me/app.git', 'git@github.com:me/app.git', '/srv/git/app.git', 'file:///srv/git/app.git']) {
      expect(requireRemoteUrl(url)).toBe(url)
    }
  })

  test('pushTo publishes the branch to the named remote with an upstream', async () => {
    const origin = tempDir('gitdesk-origin-')
    dirs.push(origin)
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    await addRemote(repo, 'origin', origin)
    await addRemote(repo, 'other', 'https://example.invalid/x.git')
    await pushTo(repo, 'origin')
    expect(git(origin, 'rev-parse', 'main').trim()).toBe(git(repo, 'rev-parse', 'HEAD').trim())
    expect((await readBranches(repo)).find((b) => b.name === 'main')?.upstream).toBe('origin/main')
    await expect(pushTo(repo, 'ghost')).rejects.toThrow(/no remote named/)
  })
})

describe('helpers', () => {
  test('maskUrl hides a password or token but keeps the rest', () => {
    expect(maskUrl('https://me:ghp_secret@github.com/me/app.git')).toBe('https://me:***@github.com/me/app.git')
    expect(maskUrl('https://github.com/me/app.git')).toBe('https://github.com/me/app.git')
    expect(maskUrl('git@github.com:me/app.git')).toBe('git@github.com:me/app.git')
    expect(maskUrl('https://token@github.com/me/app.git')).toBe('https://token@github.com/me/app.git')
  })

  test('guessProvider follows the connection', () => {
    expect(guessProvider({ kind: 'github', login: 'me' })).toBe('github')
    expect(guessProvider({ kind: 'token', host: 'github.com', username: 'me' })).toBe('github')
    expect(guessProvider({ kind: 'token', host: 'gitlab.example.com', username: 'me' })).toBe('gitlab')
    expect(guessProvider({ kind: 'token', host: 'git.example.com:8443', username: 'me' })).toBe('gitea')
  })
})
