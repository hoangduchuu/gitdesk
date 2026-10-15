import { describe, expect, test } from 'vitest'
import { buildFileTree, type TreeNode } from '../src/shared/file-tree'

const files = (...paths: string[]) => paths.map((path) => ({ path }))

/** Render a tree as indented lines to compare structure easily. */
const outline = (nodes: ReadonlyArray<TreeNode<{ path: string }>>, depth = 0): string[] =>
  nodes.flatMap((node) =>
    node.kind === 'dir'
      ? [`${'  '.repeat(depth)}${node.name}/ (${node.path})`, ...outline(node.children, depth + 1)]
      : [`${'  '.repeat(depth)}${node.name}`]
  )

describe('buildFileTree', () => {
  test('nests files under folders, folders first, alphabetical', () => {
    const tree = buildFileTree(files('package.json', 'src/b.ts', 'src/a.ts', 'docs/x.md', 'README.md', 'src/util/c.ts'))
    expect(outline(tree)).toEqual([
      'docs/ (docs)',
      '  x.md',
      'src/ (src)',
      '  util/ (src/util)',
      '    c.ts',
      '  a.ts',
      '  b.ts',
      'package.json',
      'README.md'
    ])
  })

  test('compacts chains of single-folder folders like VS Code', () => {
    const tree = buildFileTree(files('src/shared/database/schema/names.json', 'src/shared/database/schema/pg.json', 'src/main.ts'))
    expect(outline(tree)).toEqual([
      'src/ (src)',
      '  shared/database/schema/ (src/shared/database/schema)',
      '    names.json',
      '    pg.json',
      '  main.ts'
    ])
  })

  test('keeps the original items on the file nodes', () => {
    const item = { path: 'a/b.txt', kind: 'added' }
    const [dir] = buildFileTree([item])
    expect(dir).toMatchObject({ kind: 'dir', name: 'a' })
    expect(dir!.kind === 'dir' && dir!.children[0]).toEqual({ kind: 'file', name: 'b.txt', item })
  })
})
