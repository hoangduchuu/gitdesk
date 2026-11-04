import type { SubmoduleState } from './model'

export interface SubmoduleStatusLine {
  path: string
  hash: string
  state: SubmoduleState
}

/**
 * Parse `git submodule status`: `<flag><sha> <path> (<describe>)`, where the flag is a space (checked out
 * as recorded), `-` (not initialized), `+` (another commit is checked out) or `U` (merge conflict).
 */
export function parseSubmoduleStatus(text: string): SubmoduleStatusLine[] {
  const entries: SubmoduleStatusLine[] = []
  for (const line of text.split('\n')) {
    const match = /^([ +\-U])([0-9a-f]{40,64}) (.+?)(?: \([^()]*\))?$/.exec(line)
    if (!match) continue
    const flag = match[1]!
    entries.push({ path: match[3]!, hash: match[2]!, state: flag === '-' ? 'uninitialized' : flag === '+' ? 'modified' : flag === 'U' ? 'conflicted' : 'ok' })
  }
  return entries
}

/** `git config --file .gitmodules -z --get-regexp ...` output: `key\nvalue\0` pairs, as name -> {path, url}. */
export function parseGitmodules(text: string): Map<string, { name: string; url: string | null }> {
  const byPath = new Map<string, { name: string; url: string | null }>()
  const urls = new Map<string, string>()
  const paths = new Map<string, string>()
  for (const record of text.split('\0')) {
    const cut = record.indexOf('\n')
    if (cut < 0) continue
    const match = /^submodule\.(.+)\.(path|url)$/.exec(record.slice(0, cut))
    if (!match) continue
    ;(match[2] === 'path' ? paths : urls).set(match[1]!, record.slice(cut + 1))
  }
  for (const [name, path] of paths) byPath.set(path, { name, url: urls.get(name) ?? null })
  return byPath
}
