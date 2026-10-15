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

  test('passes valid input through', async () => {
    const status = await handlers.getStatus(repo)
    expect(status.branch).toBe('main')
  })
})
