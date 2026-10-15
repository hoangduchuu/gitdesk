export type TreeNode<T> =
  | { kind: 'dir'; name: string; path: string; children: Array<TreeNode<T>> }
  | { kind: 'file'; name: string; item: T }

interface MutableDir<T> {
  dirs: Map<string, MutableDir<T>>
  files: Array<{ name: string; item: T }>
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

const toNodes = <T>(dir: MutableDir<T>, prefix: string): Array<TreeNode<T>> => {
  const dirs = [...dir.dirs.entries()]
    .map(([name, child]) => {
      // Compact a folder whose only content is one folder: src/shared/database
      let path = `${prefix}${name}`
      let label = name
      let current = child
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [nextName, next] = [...current.dirs.entries()][0]!
        label = `${label}/${nextName}`
        path = `${path}/${nextName}`
        current = next
      }
      return { kind: 'dir' as const, name: label, path, children: toNodes(current, `${path}/`) }
    })
    .sort(byName)
  const files = dir.files.map((file) => ({ kind: 'file' as const, ...file })).sort(byName)
  return [...dirs, ...files]
}

/** Folder tree of repository paths, folders first and alphabetical, like VS Code's explorer. */
export function buildFileTree<T extends { path: string }>(items: readonly T[]): Array<TreeNode<T>> {
  const root: MutableDir<T> = { dirs: new Map(), files: [] }
  for (const item of items) {
    const parts = item.path.split('/')
    const name = parts.pop()!
    let dir = root
    for (const part of parts) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push({ name, item })
  }
  return toNodes(root, '')
}
