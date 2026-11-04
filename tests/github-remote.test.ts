import { describe, expect, test } from 'vitest'
import { githubRemoteName } from '../src/shared/remote-url'

const remote = (name: string, fetchUrl: string) => ({ name, fetchUrl })

describe('githubRemoteName', () => {
  test('is null without a GitHub remote', () => {
    expect(githubRemoteName([])).toBeNull()
    expect(githubRemoteName([remote('origin', 'https://gitlab.com/a/b.git'), remote('local', '/tmp/repo')])).toBeNull()
  })

  test('prefers origin, accepts https and ssh forms', () => {
    expect(githubRemoteName([remote('up', 'https://github.com/a/b'), remote('origin', 'git@github.com:a/b.git')])).toBe('origin')
    expect(githubRemoteName([remote('origin', 'https://gitlab.com/a/b'), remote('fork', 'ssh://git@github.com/me/b.git')])).toBe('fork')
  })

  test('does not mistake look-alike hosts for GitHub', () => {
    expect(githubRemoteName([remote('origin', 'https://github.com.evil.example/a/b')])).toBeNull()
  })
})
