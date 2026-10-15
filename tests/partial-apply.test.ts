import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readDiff } from '../src/main/git/diff'
import { applySelection } from '../src/main/git/partial'
import { commitFile, git, initRepo, removeDir, writeFile } from './helpers/repo'

const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
const text = (lines: string[]) => lines.join('\n') + '\n'

let repo: string
beforeEach(() => {
  repo = initRepo()
  commitFile(repo, 'f.txt', text(LINES), 'base')
  // two separate changes -> two hunks
  const edited = [...LINES]
  edited[1] = 'line 2 EDITED'
  edited[17] = 'line 18 EDITED'
  writeFile(repo, 'f.txt', text(edited))
})
afterEach(() => removeDir(repo))

const unstagedDiff = () => readDiff(repo, { kind: 'working', path: 'f.txt', staged: false, untracked: false })
const stagedDiff = () => readDiff(repo, { kind: 'working', path: 'f.txt', staged: true, untracked: false })
const read = () => readFileSync(join(repo, 'f.txt'), 'utf8')

describe('applySelection', () => {
  test('stages one hunk and leaves the other unstaged', async () => {
    await applySelection(repo, {
      path: 'f.txt',
      source: 'unstaged',
      action: 'stage',
      selections: [{ hunk: 0, lines: null }],
      expectedDiff: await unstagedDiff()
    })

    expect(await stagedDiff()).toContain('+line 2 EDITED')
    expect(await stagedDiff()).not.toContain('line 18 EDITED')
    expect(await unstagedDiff()).toContain('+line 18 EDITED')
  })

  test('stages a single added line of a modification', async () => {
    // hunk 0 body: ' line 1', '-line 2', '+line 2 EDITED', ' line 3', ...
    await applySelection(repo, {
      path: 'f.txt',
      source: 'unstaged',
      action: 'stage',
      selections: [{ hunk: 0, lines: [2] }],
      expectedDiff: await unstagedDiff()
    })
    const index = git(repo, 'show', ':f.txt').split('\n')
    expect(index.slice(0, 4)).toEqual(['line 1', 'line 2', 'line 2 EDITED', 'line 3'])
  })

  test('unstages one hunk of a staged file', async () => {
    git(repo, 'add', 'f.txt')
    await applySelection(repo, {
      path: 'f.txt',
      source: 'staged',
      action: 'unstage',
      selections: [{ hunk: 1, lines: null }],
      expectedDiff: await stagedDiff()
    })
    expect(await stagedDiff()).not.toContain('line 18 EDITED')
    expect(await stagedDiff()).toContain('+line 2 EDITED')
    expect(read()).toContain('line 18 EDITED')
  })

  test('discards one hunk from the working tree', async () => {
    await applySelection(repo, {
      path: 'f.txt',
      source: 'unstaged',
      action: 'discard',
      selections: [{ hunk: 1, lines: null }],
      expectedDiff: await unstagedDiff()
    })
    expect(read()).toContain('line 2 EDITED')
    expect(read()).toContain('line 18\n')
    expect(read()).not.toContain('line 18 EDITED')
  })

  test('refuses when the file changed since the diff was shown', async () => {
    const shown = await unstagedDiff()
    writeFile(repo, 'f.txt', 'something else\n')
    await expect(
      applySelection(repo, { path: 'f.txt', source: 'unstaged', action: 'stage', selections: [{ hunk: 0, lines: null }], expectedDiff: shown })
    ).rejects.toThrow('changed')
  })

  test('refuses an action that does not fit the source', async () => {
    await expect(
      applySelection(repo, { path: 'f.txt', source: 'staged', action: 'stage', selections: [{ hunk: 0, lines: null }], expectedDiff: '' })
    ).rejects.toThrow('Cannot stage')
  })
})
