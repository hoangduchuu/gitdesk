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
})
