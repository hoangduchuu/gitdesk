import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Resolve a repository-relative path, refusing anything that escapes the repository
 * (absolute paths, `..` segments, NUL bytes).
 */
export function insideRepo(repo: string, path: string): string {
  if (path === '' || path.includes('\0') || isAbsolute(path)) {
    throw new Error(`Invalid repository path: ${path}`)
  }
  const full = resolve(repo, path)
  const rel = relative(repo, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside the repository: ${path}`)
  }
  return full
}
