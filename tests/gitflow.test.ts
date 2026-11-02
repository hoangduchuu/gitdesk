import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { finishGitflow, initGitflow, readGitflow, startGitflow } from '../src/main/git/gitflow'
import { readBranches } from '../src/main/git/branches'
import { readStatus } from '../src/main/git/status'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

const CONFIG = { main: 'main', develop: 'develop', feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' }
const KEEP = { deleteBranch: false, tagMessage: null }
const DELETE = { deleteBranch: true, tagMessage: null }

let repo: string
beforeEach(() => {
  repo = initRepo()
  dirs.push(repo)
  commitFile(repo, 'a.txt', 'one\n', 'first')
})

const names = async (): Promise<string[]> =>
  (await readBranches(repo)).filter((b) => b.kind === 'local').map((b) => b.name).sort()
const current = async (): Promise<string | null> => (await readStatus(repo)).branch
const parents = (ref: string): string[] => git(repo, 'log', '-1', '--format=%P', ref).trim().split(' ').filter(Boolean)
const subjects = (ref: string): string[] => git(repo, 'log', '--format=%s', ref).trim().split('\n')

describe('initialization', () => {
  test('offers defaults, then saves the naming and creates develop', async () => {
    const before = await readGitflow(repo)
    expect(before.initialized).toBe(false)
    expect(before.config).toMatchObject({ main: 'main', develop: 'develop', feature: 'feature/' })

    await initGitflow(repo, CONFIG)
    const state = await readGitflow(repo)
    expect(state).toMatchObject({ initialized: true, config: CONFIG, current: null })
    expect(await names()).toEqual(['develop', 'main'])
    expect(git(repo, 'config', '--get', 'gitflow.branch.master').trim()).toBe('main') // git-flow's own keys
    expect(git(repo, 'rev-parse', 'develop')).toBe(git(repo, 'rev-parse', 'main'))
  })

  test('defaults to master when that is the production branch', async () => {
    const old = initRepo()
    dirs.push(old)
    git(old, 'branch', '-m', 'master')
    commitFile(old, 'a.txt', 'x\n')
    expect((await readGitflow(old)).config.main).toBe('master')
  })

  test('rejects bad names and a missing production branch', async () => {
    await expect(initGitflow(repo, { ...CONFIG, main: 'nope' })).rejects.toThrow(/does not exist/)
    await expect(initGitflow(repo, { ...CONFIG, develop: 'main' })).rejects.toThrow(/differ/)
    await expect(initGitflow(repo, { ...CONFIG, develop: 'bad name' })).rejects.toThrow(/valid/)
    await expect(initGitflow(repo, { ...CONFIG, feature: 'release/' })).rejects.toThrow(/differ/)
    await expect(initGitflow(repo, { ...CONFIG, feature: '' })).rejects.toThrow(/prefix/)
    await expect(initGitflow(repo, { ...CONFIG, versionTag: '-x' })).rejects.toThrow(/tag prefix/)
    expect((await readGitflow(repo)).initialized).toBe(false)
  })

  test('picks up develop from the remote when it exists there', async () => {
    const origin = tempDir('gitdesk-origin-')
    dirs.push(origin)
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'branch', 'develop')
    commitFile(repo, 'd.txt', 'd\n', 'on develop')
    git(repo, 'push', '-q', 'origin', 'main', 'develop')
    git(repo, 'branch', '-D', 'develop')
    git(repo, 'fetch', '-q')
    await initGitflow(repo, CONFIG)
    expect((await readBranches(repo)).find((b) => b.name === 'develop')?.upstream).toBe('origin/develop')
  })

  test('start and finish refuse to run before initialization', async () => {
    await expect(startGitflow(repo, 'feature', 'x')).rejects.toThrow(/not initialized/)
    await expect(finishGitflow(repo, 'feature', 'x', KEEP)).rejects.toThrow(/not initialized/)
  })
})

describe('feature', () => {
  beforeEach(() => initGitflow(repo, CONFIG))

  test('starts from develop and is reported as the current flow branch', async () => {
    commitFile(repo, 'on-develop.txt', 'd\n', 'develop work')
    git(repo, 'switch', '-q', 'develop')
    commitFile(repo, 'dev.txt', 'd\n', 'develop only')
    git(repo, 'switch', '-q', 'main')
    await startGitflow(repo, 'feature', 'login')
    expect(await current()).toBe('feature/login')
    expect(subjects('feature/login')).toContain('develop only')
    const state = await readGitflow(repo)
    expect(state.open.feature).toEqual(['login'])
    expect(state.current).toEqual({ kind: 'feature', name: 'login' })
  })

  test('finish merges into develop with a merge commit and lands on develop', async () => {
    await startGitflow(repo, 'feature', 'login')
    commitFile(repo, 'login.txt', 'l\n', 'add login')
    await finishGitflow(repo, 'feature', 'login', KEEP)
    expect(await current()).toBe('develop')
    expect(parents('develop')).toHaveLength(2) // --no-ff
    expect(subjects('develop')).toContain('add login')
    expect(await names()).toContain('feature/login') // kept
  })

  test('finish can delete the branch', async () => {
    await startGitflow(repo, 'feature', 'login')
    commitFile(repo, 'login.txt', 'l\n')
    await finishGitflow(repo, 'feature', 'login', DELETE)
    expect(await names()).toEqual(['develop', 'main'])
  })

  test('refuses duplicates, bad names and unknown branches', async () => {
    await startGitflow(repo, 'feature', 'x')
    git(repo, 'switch', '-q', 'develop')
    await expect(startGitflow(repo, 'feature', 'x')).rejects.toThrow(/already exists/)
    await expect(startGitflow(repo, 'feature', 'bad name')).rejects.toThrow(/valid feature name/)
    await expect(startGitflow(repo, 'feature', '-x')).rejects.toThrow(/valid feature name/)
    await expect(finishGitflow(repo, 'feature', 'ghost', KEEP)).rejects.toThrow(/does not exist/)
  })

  test('finish needs a clean working tree and changes nothing otherwise', async () => {
    await startGitflow(repo, 'feature', 'x')
    commitFile(repo, 'x.txt', 'x\n')
    writeFile(repo, 'a.txt', 'dirty\n')
    await expect(finishGitflow(repo, 'feature', 'x', KEEP)).rejects.toThrow(/Commit or stash/)
    expect(await current()).toBe('feature/x')
  })

  test('stops on conflicts; after resolving, finishing again completes it', async () => {
    await startGitflow(repo, 'feature', 'x')
    commitFile(repo, 'a.txt', 'feature side\n', 'feature edit')
    git(repo, 'switch', '-q', 'develop')
    commitFile(repo, 'a.txt', 'develop side\n', 'develop edit')

    const stopped = await finishGitflow(repo, 'feature', 'x', DELETE)
    expect(stopped).toEqual({ conflicts: true })
    expect((await readStatus(repo)).conflicted).toHaveLength(1)
    await expect(finishGitflow(repo, 'feature', 'x', DELETE)).rejects.toThrow(/in progress/)

    writeFile(repo, 'a.txt', 'both\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '--no-edit')
    expect(await finishGitflow(repo, 'feature', 'x', DELETE)).toEqual({ conflicts: false })
    expect(await names()).toEqual(['develop', 'main']) // the remaining step ran
  })
})

describe('release', () => {
  beforeEach(() => initGitflow(repo, CONFIG))

  test('start comes from develop; only one release at a time', async () => {
    await startGitflow(repo, 'release', '1.0.0')
    expect(await current()).toBe('release/1.0.0')
    await expect(startGitflow(repo, 'release', '1.1.0')).rejects.toThrow(/already a release in progress/)
  })

  test('finish merges into main, tags it, merges back into develop and deletes the branch', async () => {
    await startGitflow(repo, 'release', '1.0.0')
    commitFile(repo, 'version.txt', '1.0.0\n', 'bump version')
    await finishGitflow(repo, 'release', '1.0.0', { deleteBranch: true, tagMessage: 'First release' })

    expect(await current()).toBe('develop')
    expect(parents('main')).toHaveLength(2)
    expect(subjects('main')).toContain('bump version')
    expect(subjects('develop')).toContain('bump version')
    expect(git(repo, 'tag', '--list').trim()).toBe('v1.0.0')
    expect(git(repo, 'cat-file', '-t', 'v1.0.0').trim()).toBe('tag') // annotated
    expect(git(repo, 'tag', '-n1', '--list', 'v1.0.0')).toContain('First release')
    expect(git(repo, 'rev-parse', 'v1.0.0^{commit}')).toBe(git(repo, 'rev-parse', 'main'))
    expect(await names()).toEqual(['develop', 'main'])
  })

  test('uses the tag name as the message when none is given', async () => {
    await startGitflow(repo, 'release', '2.0')
    commitFile(repo, 'r.txt', 'r\n')
    await finishGitflow(repo, 'release', '2.0', KEEP)
    expect(git(repo, 'tag', '-n1', '--list', 'v2.0')).toContain('v2.0')
  })

  test('refuses an existing tag before touching anything', async () => {
    git(repo, 'tag', 'v1.0.0')
    await startGitflow(repo, 'release', '1.0.0')
    commitFile(repo, 'r.txt', 'r\n')
    const mainBefore = git(repo, 'rev-parse', 'main')
    await expect(finishGitflow(repo, 'release', '1.0.0', KEEP)).rejects.toThrow(/tag v1.0.0 already exists/)
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore)
  })

  test('a conflict back into develop can be resolved and finishing again completes it', async () => {
    await startGitflow(repo, 'release', '1.0.0')
    commitFile(repo, 'a.txt', 'release side\n', 'release edit')
    git(repo, 'switch', '-q', 'develop')
    commitFile(repo, 'a.txt', 'develop side\n', 'develop edit')

    expect(await finishGitflow(repo, 'release', '1.0.0', DELETE)).toEqual({ conflicts: true })
    expect(git(repo, 'tag', '--list').trim()).toBe('v1.0.0') // main and the tag are already done
    writeFile(repo, 'a.txt', 'both\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '--no-edit')

    expect(await finishGitflow(repo, 'release', '1.0.0', DELETE)).toEqual({ conflicts: false })
    expect(git(repo, 'tag', '--list').trim()).toBe('v1.0.0') // not tagged twice
    expect(await names()).toEqual(['develop', 'main'])
  })
})

describe('hotfix', () => {
  beforeEach(() => initGitflow(repo, CONFIG))

  test('starts from main, finishes into main (tagged) and develop', async () => {
    git(repo, 'switch', '-q', 'develop')
    commitFile(repo, 'dev.txt', 'd\n', 'unreleased work')
    await startGitflow(repo, 'hotfix', '1.0.1')
    expect(subjects('hotfix/1.0.1')).not.toContain('unreleased work') // from main, not develop
    commitFile(repo, 'fix.txt', 'f\n', 'urgent fix')
    await finishGitflow(repo, 'hotfix', '1.0.1', DELETE)

    expect(await current()).toBe('develop')
    expect(subjects('main')).toContain('urgent fix')
    expect(subjects('develop')).toContain('urgent fix')
    expect(subjects('develop')).toContain('unreleased work')
    expect(git(repo, 'tag', '--list').trim()).toBe('v1.0.1')
    expect(await names()).toEqual(['develop', 'main'])
  })

  test('goes into the open release instead of develop', async () => {
    await startGitflow(repo, 'release', '2.0.0')
    git(repo, 'switch', '-q', 'main')
    await startGitflow(repo, 'hotfix', '1.0.1')
    commitFile(repo, 'fix.txt', 'f\n', 'urgent fix')
    await finishGitflow(repo, 'hotfix', '1.0.1', DELETE)
    expect(await current()).toBe('release/2.0.0')
    expect(subjects('release/2.0.0')).toContain('urgent fix')
    expect(subjects('develop')).not.toContain('urgent fix') // arrives with the release
  })
})
