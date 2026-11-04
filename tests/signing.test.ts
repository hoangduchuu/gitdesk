import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readCommitDetails, signatureStatus } from '../src/main/git/log'
import { rewordCommit } from '../src/main/git/reword'
import { commit } from '../src/main/git/worktree'
import { ProfileStore } from '../src/main/profiles'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

let repo: string
let keys: string
let key: string
beforeEach(() => {
  repo = initRepo()
  keys = tempDir('gitdesk-keys-')
  key = join(keys, 'id_ed25519')
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key, '-C', 'tester@example.com'])
  commitFile(repo, 'a.txt', 'one\n', 'first')
})
afterEach(() => {
  removeDir(repo)
  removeDir(keys)
})

const identity = (signing?: { format: 'ssh' | 'openpgp'; key: string }) => ({ name: 'Tester', email: 'tester@example.com', ...(signing ? { signing } : {}) })
const head = () => git(repo, 'rev-parse', 'HEAD').trim()
const signed = () => git(repo, 'cat-file', 'commit', 'HEAD').includes('-----BEGIN SSH SIGNATURE-----')
const stage = (name: string) => {
  writeFile(repo, name, `${name}\n`)
  git(repo, 'add', '--', name)
}

describe('signatureStatus', () => {
  test.each([
    ['G', 'good'],
    ['U', 'unverified'],
    ['X', 'unverified'],
    ['E', 'unverified'],
    ['B', 'bad'],
    ['R', 'bad'],
    ['N', 'none'],
    ['', 'none']
  ])('%s -> %s', (code, status) => expect(signatureStatus(code)).toBe(status))
})

describe('signing commits', () => {
  test('a profile with an ssh key signs the commit', async () => {
    stage('b.txt')
    await commit(repo, 'signed commit', false, identity({ format: 'ssh', key: `${key}.pub` }))

    expect(signed()).toBe(true)
  })

  test('without signing the commit is plain', async () => {
    stage('b.txt')
    await commit(repo, 'plain commit', false, identity())

    expect(signed()).toBe(false)
  })

  test('amend keeps signing', async () => {
    stage('b.txt')
    await commit(repo, 'to amend', false, identity({ format: 'ssh', key: `${key}.pub` }))
    await commit(repo, 'amended', true, identity({ format: 'ssh', key: `${key}.pub` }))

    expect(signed()).toBe(true)
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('amended')
  })

  test('rewording the newest commit signs the rewritten one', async () => {
    const before = head()
    await rewordCommit(repo, before, 'reworded', identity({ format: 'ssh', key: `${key}.pub` }))

    expect(head()).not.toBe(before)
    expect(signed()).toBe(true)
  })

  test('a bad key fails with an explanation and no commit is made', async () => {
    stage('b.txt')
    const before = head()

    await expect(commit(repo, 'x', false, identity({ format: 'ssh', key: join(keys, 'missing.pub') }))).rejects.toThrow('Signing the commit failed')

    expect(head()).toBe(before)
  })

  test('a repository setting for the ssh program is respected, not overridden', async () => {
    git(repo, 'config', 'gpg.ssh.program', '/definitely/not/there')
    stage('b.txt')

    await expect(commit(repo, 'x', false, identity({ format: 'ssh', key: `${key}.pub` }))).rejects.toThrow('Signing the commit failed')
  })
})

describe('commit details show the signature', () => {
  test('unsigned commit: none', async () => {
    expect((await readCommitDetails(repo, head())).signature).toBe('none')
  })

  test('signed commit whose signer this computer does not know: unverified', async () => {
    stage('b.txt')
    await commit(repo, 'signed', false, identity({ format: 'ssh', key: `${key}.pub` }))

    expect((await readCommitDetails(repo, head())).signature).toBe('unverified')
  })

  test('signed commit by a signer listed in allowed signers: good', async () => {
    stage('b.txt')
    await commit(repo, 'signed', false, identity({ format: 'ssh', key: `${key}.pub` }))
    const allowed = join(keys, 'allowed_signers')
    writeFileSync(allowed, `tester@example.com ${readFileSync(`${key}.pub`, 'utf8')}`)
    git(repo, 'config', 'gpg.ssh.allowedSignersFile', allowed)

    expect((await readCommitDetails(repo, head())).signature).toBe('good')
  })
})

describe('profiles with signing', () => {
  let dir: string
  let store: ProfileStore
  beforeEach(() => {
    dir = tempDir('gitdesk-profiles-')
    store = new ProfileStore(join(dir, 'profiles.json'))
  })
  afterEach(() => removeDir(dir))

  test('are saved and read back', async () => {
    const saved = await store.save({ name: 'A', email: 'a@b.c', signing: { format: 'ssh', key: '~/.ssh/id_ed25519.pub' } })

    expect((await store.list())[0]).toEqual(saved)
    expect(saved.signing).toEqual({ format: 'ssh', key: '~/.ssh/id_ed25519.pub' })
  })

  test('older profiles without signing still load', async () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: [{ id: '1', name: 'Old', email: 'o@b.c' }], repoProfiles: {} }))

    expect(await store.list()).toEqual([{ id: '1', name: 'Old', email: 'o@b.c' }])
  })

  test.each([
    ['an unknown format', { format: 'x509', key: 'k' }],
    ['an empty key', { format: 'ssh', key: '  ' }],
    ['a key that looks like an option', { format: 'ssh', key: '--exec=evil' }],
    ['a key with a line break', { format: 'ssh', key: 'a\nb' }]
  ])('refuse %s', async (_name, signing) => {
    await expect(store.save({ name: 'A', email: 'a@b.c', signing: signing as never })).rejects.toThrow('Invalid signing key')
  })

  test('a hand-edited file cannot smuggle a bad key to git', async () => {
    writeFileSync(
      join(dir, 'profiles.json'),
      JSON.stringify({ profiles: [{ id: '1', name: 'N', email: 'n@b.c', signing: { format: 'ssh', key: '--upload-pack=x' } }], repoProfiles: {} })
    )

    expect((await store.list())[0]).toEqual({ id: '1', name: 'N', email: 'n@b.c' })
  })
})
