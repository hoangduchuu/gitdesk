import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readSubmodules, updateSubmodules } from '../src/main/git/submodules'
import { parseGitmodules, parseSubmoduleStatus } from '../src/shared/submodule-parse'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

describe('parseSubmoduleStatus', () => {
  test('reads the four states, with or without a description', () => {
    expect(parseSubmoduleStatus(` ${A} libs/ok (heads/main)\n-${B} libs/not cloned\n+${A} libs/new (v1-2-gabc)\nU${B} libs/conflict\n`)).toEqual([
      { path: 'libs/ok', hash: A, state: 'ok' },
      { path: 'libs/not cloned', hash: B, state: 'uninitialized' },
      { path: 'libs/new', hash: A, state: 'modified' },
      { path: 'libs/conflict', hash: B, state: 'conflicted' }
    ])
  })

  test('is empty for empty output', () => {
    expect(parseSubmoduleStatus('')).toEqual([])
  })
})

describe('parseGitmodules', () => {
  test('pairs path and url by name, including names with dots', () => {
    const text = 'submodule.libs/a.b.path\nlibs/a.b\0submodule.libs/a.b.url\nhttps://x/y.git\0submodule.two.path\nvendor/two\0'

    expect([...parseGitmodules(text)]).toEqual([
      ['libs/a.b', { name: 'libs/a.b', url: 'https://x/y.git' }],
      ['vendor/two', { name: 'two', url: null }]
    ])
  })
})

let source: string
let repo: string
let area: string
beforeEach(() => {
  area = tempDir('gitdesk-submodules-')
  source = initRepo()
  commitFile(source, 's.txt', 'one\n', 'sub one')
  repo = initRepo()
  commitFile(repo, 'm.txt', 'main\n', 'main one')
  // Local paths are only allowed as a submodule source when asked for explicitly.
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'libs/sub')
  git(repo, 'commit', '-q', '-m', 'add submodule')
})
afterEach(() => {
  removeDir(source)
  removeDir(repo)
  removeDir(area)
})

describe('readSubmodules', () => {
  test('is empty without submodules', async () => {
    const plain = initRepo()
    try {
      commitFile(plain, 'a.txt', '1\n', 'first')
      expect(await readSubmodules(plain)).toEqual([])
    } finally {
      removeDir(plain)
    }
  })

  test('reports a checked-out, unchanged submodule with its address', async () => {
    const [submodule] = await readSubmodules(repo)

    expect(submodule).toMatchObject({ path: 'libs/sub', name: 'libs/sub', url: source, state: 'ok', dirty: false })
  })

  test('notices a new commit in the submodule, and local changes inside it', async () => {
    commitFile(join(repo, 'libs/sub'), 's.txt', 'two\n', 'sub two')
    expect((await readSubmodules(repo))[0]).toMatchObject({ state: 'modified', dirty: false })

    writeFile(join(repo, 'libs/sub'), 'loose.txt', 'x\n')
    expect((await readSubmodules(repo))[0]).toMatchObject({ state: 'modified', dirty: true })
  })

  test('notices a submodule that is not cloned', async () => {
    git(repo, 'submodule', 'deinit', '-q', '-f', 'libs/sub')

    expect((await readSubmodules(repo))[0]).toMatchObject({ state: 'uninitialized', dirty: false })
  })
})

describe('updateSubmodules', () => {
  const cloneWithoutSubmodules = (): string => {
    const clone = join(area, 'clone')
    git(area, '-c', 'protocol.file.allow=always', 'clone', '-q', repo, clone)
    return clone
  }
  const allowLocal = { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' } }

  test('clones what is missing and checks out the recorded commit', async () => {
    const clone = cloneWithoutSubmodules()
    expect((await readSubmodules(clone))[0]).toMatchObject({ state: 'uninitialized' })

    await updateSubmodules(clone, null, allowLocal)

    expect(existsSync(join(clone, 'libs/sub/s.txt'))).toBe(true)
    expect((await readSubmodules(clone))[0]).toMatchObject({ state: 'ok' })
  })

  test('can update just one, and refuses a folder that is not a submodule', async () => {
    const clone = cloneWithoutSubmodules()

    await updateSubmodules(clone, 'libs/sub', allowLocal)
    expect((await readSubmodules(clone))[0]).toMatchObject({ state: 'ok' })
    await expect(updateSubmodules(clone, 'libs', allowLocal)).rejects.toThrow('not a submodule')
  })
})
