import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

/** Run git synchronously for test setup. */
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' })

export const writeFile = (repo: string, file: string, content: string): void => {
  const full = join(repo, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export const commitFile = (repo: string, file: string, content: string, message = content): void => {
  writeFile(repo, file, content)
  git(repo, 'add', '--', file)
  git(repo, 'commit', '-q', '-m', message)
}

export const tempDir = (prefix = 'gitdesk-'): string => mkdtempSync(join(tmpdir(), prefix))

export const initRepo = (): string => {
  const repo = tempDir()
  git(repo, 'init', '-q', '-b', 'main')
  return repo
}

export const removeDir = (dir: string): void => rmSync(dir, { recursive: true, force: true })
