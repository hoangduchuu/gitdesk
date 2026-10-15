import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { pushRecent, RECENT_LIMIT, WorkspaceStore } from '../src/main/workspace'
import { removeDir, tempDir } from './helpers/repo'

let dir: string
let file: string
beforeEach(() => {
  dir = tempDir('gitdesk-workspace-')
  file = join(dir, 'workspace.json')
})
afterEach(() => removeDir(dir))

describe('pushRecent', () => {
  test('moves a path to the front without duplicates', () => {
    expect(pushRecent(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c'])
  })

  test('drops the oldest beyond the limit', () => {
    const full = Array.from({ length: RECENT_LIMIT }, (_, i) => `/r${i}`)
    const next = pushRecent(full, '/new')
    expect(next).toHaveLength(RECENT_LIMIT)
    expect(next[0]).toBe('/new')
    expect(next).not.toContain(`/r${RECENT_LIMIT - 1}`)
  })
})

describe('WorkspaceStore', () => {
  test('starts empty when there is no file', async () => {
    expect(await new WorkspaceStore(file).read()).toEqual({ tabs: [], active: -1, recent: [] })
  })

  test('persists tabs, the selected tab and recent repositories', async () => {
    const store = new WorkspaceStore(file)
    await store.addRecent('/repos/a')
    await store.addRecent('/repos/b')
    await store.saveTabs(['/repos/a', '/repos/b'], 1)

    expect(await new WorkspaceStore(file).read()).toEqual({
      tabs: ['/repos/a', '/repos/b'],
      active: 1,
      recent: ['/repos/b', '/repos/a']
    })
  })

  test('concurrent updates do not lose each other', async () => {
    const store = new WorkspaceStore(file)
    await Promise.all([store.addRecent('/x'), store.saveTabs(['/x'], 0), store.addRecent('/y')])
    expect(await store.read()).toEqual({ tabs: ['/x'], active: 0, recent: ['/y', '/x'] })
  })

  test('only knows repositories from tabs or the recent list', async () => {
    const store = new WorkspaceStore(file)
    await store.addRecent('/recent')
    await store.saveTabs(['/tab'], 0)
    expect(await store.knows('/recent')).toBe(true)
    expect(await store.knows('/tab')).toBe(true)
    expect(await store.knows('/elsewhere')).toBe(false)
  })

  test('an out-of-range selected tab reads as none', async () => {
    writeFileSync(file, JSON.stringify({ tabs: ['/a'], active: 5, recent: [] }))
    expect((await new WorkspaceStore(file).read()).active).toBe(-1)
  })

  test('moves an unreadable file aside and starts empty', async () => {
    writeFileSync(file, '{ not json')
    expect(await new WorkspaceStore(file).read()).toEqual({ tabs: [], active: -1, recent: [] })
    expect(readdirSync(dir).some((name) => name.startsWith('workspace.json.corrupt-'))).toBe(true)
  })
})
