import type { Worktree } from './model'

/** Parse `git worktree list --porcelain`: blocks separated by a blank line, the first being the main worktree. */
export function parseWorktrees(text: string): Worktree[] {
  const result: Worktree[] = []
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split('\n').filter((line) => line !== '')
    const first = lines[0]
    if (!first?.startsWith('worktree ')) continue
    const entry: Worktree = { path: first.slice('worktree '.length), head: '', branch: null, main: result.length === 0, locked: false, prunable: false }
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) entry.prunable = true
    }
    result.push(entry)
  }
  return result
}
