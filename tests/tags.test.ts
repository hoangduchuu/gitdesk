import { afterEach, describe, expect, test } from 'vitest'
import { deleteRemoteBranch, readBranches, renameBranch } from '../src/main/git/branches'
import { createTag, deleteRemoteTag, deleteTag, pushTag, readTags } from '../src/main/git/tags'
import { commitFile, git, initRepo, removeDir, tempDir } from './helpers/repo'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(removeDir))

const setup = () => {
  const origin = tempDir('gitdesk-origin-')
  git(origin, 'init', '-q', '--bare', '-b', 'main')
  const repo = initRepo()
  commitFile(repo, 'a.txt', 'one\n', 'first')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  dirs.push(origin, repo)
  return { origin, repo, head: git(repo, 'rev-parse', 'HEAD').trim() }
}

describe('tags', () => {
  test('creates lightweight and annotated tags and lists them', async () => {
    const { repo, head } = setup()
    await createTag(repo, 'v1.0', head, null)
    await createTag(repo, 'v1.1', head, 'Release 1.1')

    expect(await readTags(repo)).toEqual([
      { name: 'v1.0', hash: head, annotated: false, message: null },
      { name: 'v1.1', hash: head, annotated: true, message: 'Release 1.1' }
    ])
  })

  test('pushes and deletes a tag locally and on the remote', async () => {
    const { origin, repo, head } = setup()
    await createTag(repo, 'v2', head, null)
    await pushTag(repo, 'v2')
    expect(git(origin, 'tag').trim()).toBe('v2')

    await deleteRemoteTag(repo, 'v2')
    expect(git(origin, 'tag').trim()).toBe('')
    await deleteTag(repo, 'v2')
    expect(await readTags(repo)).toEqual([])
  })

  test('rejects invalid tag names', async () => {
    const { repo, head } = setup()
    await expect(createTag(repo, 'bad tag', head, null)).rejects.toThrow('not a valid tag name')
    await expect(createTag(repo, '-x', head, null)).rejects.toThrow('not a valid tag name')
  })
})

describe('branch rename and remote delete', () => {
  test('renames a local branch', async () => {
    const { repo } = setup()
    git(repo, 'branch', 'old-name')
    await renameBranch(repo, 'old-name', 'new-name')
    expect((await readBranches(repo)).filter((b) => b.kind === 'local').map((b) => b.name)).toEqual(['main', 'new-name'])
  })

  test('deletes a branch on the remote', async () => {
    const { origin, repo } = setup()
    git(repo, 'push', '-q', 'origin', 'main:feature/x')
    git(repo, 'fetch', '-q')

    await deleteRemoteBranch(repo, 'origin/feature/x')

    expect(git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim()).toBe('main')
    expect((await readBranches(repo)).some((b) => b.name === 'origin/feature/x')).toBe(false)
  })
})
