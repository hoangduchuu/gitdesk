import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { createHandlers } from '../src/main/handlers'
import { ProfileStore } from '../src/main/profiles'
import { TerminalManager } from '../src/main/terminal'
import { commitFile, git, initRepo, removeDir, tempDir, writeFile } from './helpers/repo'

let repo: string
let settings: string
let handlers: ReturnType<typeof createHandlers>
beforeEach(() => {
  repo = initRepo()
  settings = tempDir('gitdesk-settings-')
  handlers = createHandlers(new ProfileStore(join(settings, 'profiles.json')), new TerminalManager(() => undefined))
  commitFile(repo, 'a.txt', 'a\n')
})
afterEach(() => {
  removeDir(repo)
  removeDir(settings)
})

describe('IPC handler validation', () => {
  test.each([
    ['getLog with a zero limit', () => handlers.getLog(repo, 0), 'Invalid log limit'],
    ['file history outside the repo', () => handlers.getFileHistory(repo, '../x', 10), 'outside the repository'],
    ['file history with an absolute path', () => handlers.getFileHistory(repo, '/etc/hosts', 10), 'Invalid repository path'],
    ['file history with a zero limit', () => handlers.getFileHistory(repo, 'a.txt', 0), 'Invalid history limit'],
    ['blame outside the repo', () => handlers.getBlame(repo, '../x', null), 'outside the repository'],
    ['blame at a revision that is not a hash', () => handlers.getBlame(repo, 'a.txt', '--contents'), 'Invalid commit hash'],
    ['search with an unknown mode', () => handlers.searchCommits(repo, 'regex', 'a', 10), 'Invalid search mode'],
    ['search with empty text', () => handlers.searchCommits(repo, 'message', '  ', 10), 'Invalid search text'],
    ['search with a huge query', () => handlers.searchCommits(repo, 'content', 'x'.repeat(501), 10), 'Invalid search text'],
    ['search with a zero limit', () => handlers.searchCommits(repo, 'message', 'a', 0), 'Invalid search limit'],
    ['pull request with a blank title', () => handlers.createPullRequest(repo, { title: ' ', body: '', head: 'a', base: 'main', draft: false }), 'Invalid pull request title'],
    ['pull request branch that looks like an option', () => handlers.createPullRequest(repo, { title: 't', body: '', head: '--upload-pack=x', base: 'main', draft: false }), 'Invalid pull request branch'],
    ['pull request with a non-boolean draft flag', () => handlers.createPullRequest(repo, { title: 't', body: '', head: 'a', base: 'main', draft: 'yes' }), 'Invalid draft flag'],
    ['pull requests without a github remote', () => handlers.getPullRequests(repo), 'need a remote on github.com'],
    ['checking out a pull request without a github remote', () => handlers.checkoutPullRequest(repo, 3), 'need a remote on github.com'],
    ['worktree at a relative path', () => handlers.addWorktree(repo, 'relative/dir', 'x', true), 'Invalid folder path'],
    ['worktree with a non-boolean create flag', () => handlers.addWorktree(repo, '/tmp/x', 'x', 'yes'), 'Invalid create flag'],
    ['removing a worktree at a relative path', () => handlers.removeWorktree(repo, '../x', false), 'Invalid folder path'],
    ['removing a folder that is not a worktree', () => handlers.removeWorktree(repo, '/tmp', false), 'not a worktree'],
    ['getReflog with a zero limit', () => handlers.getReflog(repo, 0), 'Invalid reflog limit'],
    ['stage outside the repo', () => handlers.stage(repo, ['../escape.txt']), 'outside the repository'],
    ['stage with an absolute path', () => handlers.stage(repo, ['/etc/hosts']), 'Invalid repository path'],
    ['stage with no paths', () => handlers.stage(repo, []), 'Invalid path list'],
    ['commit files with a non-hash', () => handlers.getCommitFiles(repo, '--all'), 'Invalid commit hash'],
    ['diff with an unknown target kind', () => handlers.getDiff(repo, { kind: 'shell', path: 'a.txt' }), 'Invalid diff target kind'],
    ['stash drop with an option', () => handlers.stashDrop(repo, '--all'), 'Invalid stash reference'],
    ['discard with an unknown kind', () => handlers.discard(repo, [{ path: 'a.txt', kind: 'rm -rf' }]), 'Invalid file change'],
    ['resolve with an unknown side', () => handlers.resolveConflictWithSide(repo, 'a.txt', 'both'), 'Invalid conflict side'],
    ['branch start point that is not a hash', () => handlers.createBranch(repo, 'x', '--orphan', false), 'Invalid commit hash'],
    ['cherry-pick with an option', () => handlers.cherryPick(repo, ['--abort']), 'Invalid commit hash'],
    ['cherry-pick with nothing', () => handlers.cherryPick(repo, []), 'Invalid commit list'],
    ['reset with an unknown mode', () => handlers.resetTo(repo, 'abcdef1', 'keep'), 'Invalid reset mode'],
    ['tag at a non-hash', () => handlers.createTag(repo, 'v1', 'HEAD~1', null), 'Invalid commit hash'],
    ['selection with an unknown action', () => handlers.applySelection(repo, { path: 'a.txt', source: 'unstaged', action: 'commit', selections: [{ hunk: 0, lines: null }], expectedDiff: '' }), 'Invalid selection action'],
    ['selection outside the repo', () => handlers.applySelection(repo, { path: '../x', source: 'unstaged', action: 'stage', selections: [{ hunk: 0, lines: null }], expectedDiff: '' }), 'outside the repository'],
    ['profile without an email', () => handlers.saveProfile(repo, { name: 'A' }), 'Invalid profile email'],
    ['repo profile that does not exist', () => handlers.setRepoProfile(repo, 'nope'), 'Profile not found'],
    ['a terminal with a silly size', () => handlers.terminalStart(repo, 100000, 24), 'Invalid columns'],
    ['writing to a terminal that does not exist', () => handlers.terminalWrite(repo, 99, 'ls'), 'No terminal'],
    ['rebase step with an unknown action', () => handlers.interactiveRebase(repo, 'abcdef1', [{ hash: 'abcdef1', action: 'exec' }]), 'Invalid rebase step']
  ])('rejects %s', async (_name, call, message) => {
    await expect(call()).rejects.toThrow(message)
  })

  test('commits with the profile chosen for the repository', async () => {
    const profile = await handlers.saveProfile(repo, { name: 'Work Me', email: 'me@work.com' })
    await handlers.setRepoProfile(repo, profile.id)
    writeFile(repo, 'b.txt', 'b')
    await handlers.stage(repo, ['b.txt'])
    await handlers.commit(repo, 'with profile', false)

    expect(git(repo, 'log', '-1', '--format=%an <%ae>').trim()).toBe('Work Me <me@work.com>')
    expect(await handlers.getProfiles(repo)).toMatchObject({ selectedId: profile.id, profiles: [profile] })
  })

  test('serves history and blame for a file inside the repo', async () => {
    const history = await handlers.getFileHistory(repo, 'a.txt', 10)
    const blame = await handlers.getBlame(repo, 'a.txt', null)

    expect(history).toHaveLength(1)
    expect(history[0]!.path).toBe('a.txt')
    expect(blame.map((line) => line.text)).toEqual(['a'])
  })

  test('searches the history with a valid mode and text', async () => {
    const found = await handlers.searchCommits(repo, 'path', 'a.txt', 10)

    expect(found).toHaveLength(1)
  })

  test('undoes the last commit through the API', async () => {
    commitFile(repo, 'b.txt', 'b\n')

    await handlers.undoLastAction(repo)

    expect(git(repo, 'log', '--format=%s').trim().split('\n')).toHaveLength(1)
  })

  test('a newer search for the same repository replaces the one still running', async () => {
    const first = handlers.searchCommits(repo, 'content', 'a', 10)
    const second = handlers.searchCommits(repo, 'message', 'a', 10)

    await expect(first).rejects.toThrow('Cancelled')
    expect(await second).toHaveLength(1)
  })

  test('cancelling with nothing running is harmless', async () => {
    expect(await handlers.cancelSearch(repo)).toBeNull()
  })

  test('adds, lists and removes a worktree', async () => {
    const path = join(settings, 'wt')

    await handlers.addWorktree(repo, path, 'wt-branch', true)
    expect((await handlers.getWorktrees(repo)).map((worktree) => worktree.branch)).toEqual(['main', 'wt-branch'])

    await handlers.removeWorktree(repo, path, false)
    expect(await handlers.getWorktrees(repo)).toHaveLength(1)
  })

  test('passes valid input through', async () => {
    const status = await handlers.getStatus(repo)
    expect(status.branch).toBe('main')
  })
})
