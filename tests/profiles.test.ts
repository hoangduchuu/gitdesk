import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ProfileStore } from '../src/main/profiles'
import { removeDir, tempDir } from './helpers/repo'

let dir: string
let file: string
beforeEach(() => {
  dir = tempDir('gitdesk-settings-')
  file = join(dir, 'profiles.json')
})
afterEach(() => removeDir(dir))

describe('ProfileStore', () => {
  test('starts empty when there is no file', async () => {
    const store = new ProfileStore(file)
    expect(await store.list()).toEqual([])
    expect(await store.repoProfile('/repo')).toBeNull()
  })

  test('adds, updates and persists profiles', async () => {
    const store = new ProfileStore(file)
    const work = await store.save({ name: 'Văn Tiến', email: 'tien@company.com' })
    await store.save({ name: 'Tien', email: 'tien@home.dev' })
    await store.save({ id: work.id, name: 'Văn Tiến (work)', email: 'tien@company.com' })

    const reopened = new ProfileStore(file)
    expect((await reopened.list()).map((p) => [p.name, p.email])).toEqual([
      ['Văn Tiến (work)', 'tien@company.com'],
      ['Tien', 'tien@home.dev']
    ])
  })

  test('remembers a default profile per repository', async () => {
    const store = new ProfileStore(file)
    const home = await store.save({ name: 'Tien', email: 'tien@home.dev' })
    await store.setRepoProfile('/repos/a', home.id)
    expect(await new ProfileStore(file).repoProfile('/repos/a')).toEqual(home)
    expect(await store.repoProfile('/repos/b')).toBeNull()

    await store.setRepoProfile('/repos/a', null)
    expect(await store.repoProfile('/repos/a')).toBeNull()
  })

  test('deleting a profile clears it from repositories that used it', async () => {
    const store = new ProfileStore(file)
    const work = await store.save({ name: 'W', email: 'w@x.com' })
    await store.setRepoProfile('/repos/a', work.id)
    await store.remove(work.id)
    expect(await store.list()).toEqual([])
    expect(await store.repoProfile('/repos/a')).toBeNull()
  })

  test('rejects invalid names, emails and unknown ids', async () => {
    const store = new ProfileStore(file)
    await expect(store.save({ name: ' ', email: 'a@b.c' })).rejects.toThrow('name')
    await expect(store.save({ name: 'A', email: 'not-an-email' })).rejects.toThrow('email')
    await expect(store.save({ name: 'A\nB', email: 'a@b.c' })).rejects.toThrow('name')
    await expect(store.save({ id: 'missing', name: 'A', email: 'a@b.c' })).rejects.toThrow('not found')
    await expect(store.setRepoProfile('/r', 'missing')).rejects.toThrow('not found')
  })

  test('ignores a corrupt settings file instead of crashing', async () => {
    writeFileSync(file, '{ not json')
    const store = new ProfileStore(file)
    expect(await store.list()).toEqual([])
    await store.save({ name: 'A', email: 'a@b.c' })
    expect(JSON.parse(readFileSync(file, 'utf8')).profiles).toHaveLength(1)
  })
})
