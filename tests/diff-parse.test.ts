import { describe, expect, test } from 'vitest'
import { parseUnifiedDiff } from '../src/shared/diff-parse'

const DIFF = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@ function top
 keep
-old
+new
 tail
@@ -10 +10,2 @@
 ten
+eleven
\\ No newline at end of file
`

describe('parseUnifiedDiff', () => {
  test('numbers context, removed and added lines per hunk', () => {
    const diff = parseUnifiedDiff(DIFF)

    expect(diff.binary).toBe(false)
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0]!.header).toBe('@@ -1,3 +1,3 @@ function top')
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'keep', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: 'old', oldLine: 2, newLine: null },
      { kind: 'added', text: 'new', oldLine: null, newLine: 2 },
      { kind: 'context', text: 'tail', oldLine: 3, newLine: 3 }
    ])
    expect(diff.hunks[1]!.lines).toEqual([
      { kind: 'context', text: 'ten', oldLine: 10, newLine: 10 },
      { kind: 'added', text: 'eleven', oldLine: null, newLine: 11 },
      { kind: 'note', text: 'No newline at end of file', oldLine: null, newLine: null }
    ])
  })

  test('recognises binary files and empty diffs', () => {
    expect(parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n').binary).toBe(true)
    expect(parseUnifiedDiff('')).toEqual({ binary: false, hunks: [] })
  })
})

import { splitRows } from '../src/shared/diff-parse'

describe('splitRows', () => {
  const line = (kind: 'context' | 'added' | 'removed', text: string) => ({ kind, text, oldLine: null, newLine: null })
  test('pairs removed with added lines and pads the shorter side', () => {
    const rows = splitRows([line('context', 'a'), line('removed', 'x'), line('removed', 'y'), line('added', 'z'), line('context', 'b')])
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['x', 'z'],
      ['y', null],
      ['b', 'b']
    ])
  })
  test('an addition alone has no left side', () => {
    expect(splitRows([line('added', 'n')])).toEqual([{ left: null, right: line('added', 'n') }])
  })
})
