import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cloneRepository, repoNameFromUrl } from '../src/main/git/clone'

describe('repoNameFromUrl', () => {
  it('reads the name from common address forms', () => {
    expect(repoNameFromUrl('https://github.com/o/repo.git')).toBe('repo')
    expect(repoNameFromUrl('https://github.com/o/repo/')).toBe('repo')
    expect(repoNameFromUrl('git@github.com:o/repo.git')).toBe('repo')
    expect(repoNameFromUrl('/tmp/some/repo')).toBe('repo')
  })
  it('rejects option-like and helper addresses', () => {
    expect(() => repoNameFromUrl('--upload-pack=x')).toThrow()
    expect(() => repoNameFromUrl('ext::sh -c id')).toThrow()
  })
})

describe('cloneRepository', () => {
  it('clones a repository and refuses an existing folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clone-'))
    const source = join(root, 'src-repo')
    mkdirSync(source)
    const git = (...args: string[]): void => void execFileSync('git', ['-C', source, ...args])
    git('init', '-q')
    writeFileSync(join(source, 'a.txt'), 'a')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
    const parent = join(root, 'dest')
    mkdirSync(parent)
    const path = await cloneRepository(source, parent)
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    await expect(cloneRepository(source, parent)).rejects.toThrow('already exists')
  })

  it('can clone the submodules along', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clone-sub-'))
    const make = (name: string): string => {
      const dir = join(root, name)
      mkdirSync(dir)
      execFileSync('git', ['-C', dir, 'init', '-q'])
      writeFileSync(join(dir, `${name}.txt`), name)
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', name])
      return dir
    }
    const lib = make('lib')
    const main = make('main')
    execFileSync('git', ['-C', main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor/lib'])
    execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'add lib'])
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' }
    mkdirSync(join(root, 'plain'))
    mkdirSync(join(root, 'deep'))

    const plain = await cloneRepository(main, join(root, 'plain'), env)
    const deep = await cloneRepository(main, join(root, 'deep'), env, false, true)

    expect(existsSync(join(plain, 'vendor/lib/lib.txt'))).toBe(false)
    expect(existsSync(join(deep, 'vendor/lib/lib.txt'))).toBe(true)
  })
})
