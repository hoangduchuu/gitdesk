import { describe, expect, test } from 'vitest'
import { buildPartialPatch } from '../src/shared/partial-patch'

const HEADER = 'diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n'
const DIFF =
  HEADER +
  '@@ -1,4 +1,4 @@ heading\n' +
  ' a\n' +
  '-b\n' +
  '+B\n' +
  ' c\n' +
  ' d\n' +
  '@@ -10,3 +10,5 @@\n' +
  ' x\n' +
  '+new1\n' +
  '+new2\n' +
  ' y\n' +
  '-z\n' +
  '+Z\n'

describe('buildPartialPatch', () => {
  test('keeps a whole hunk and shifts later hunk starts', () => {
    expect(buildPartialPatch(DIFF, [{ hunk: 1, lines: null }], false)).toBe(
      HEADER + '@@ -10,3 +10,5 @@\n x\n+new1\n+new2\n y\n-z\n+Z\n'
    )
  })

  test('forward: unselected removals become context, unselected additions are dropped', () => {
    // hunk 1 lines: 0 ' x', 1 '+new1', 2 '+new2', 3 ' y', 4 '-z', 5 '+Z'
    expect(buildPartialPatch(DIFF, [{ hunk: 1, lines: [1] }], false)).toBe(
      HEADER + '@@ -10,3 +10,4 @@\n x\n+new1\n y\n z\n'
    )
  })

  test('reverse: unselected additions become context, unselected removals are dropped', () => {
    expect(buildPartialPatch(DIFF, [{ hunk: 1, lines: [4, 5] }], true)).toBe(
      HEADER + '@@ -10,5 +10,5 @@\n x\n new1\n new2\n y\n-z\n+Z\n'
    )
  })

  test('recomputes the new start after an earlier partially kept hunk', () => {
    const patch = buildPartialPatch(DIFF, [{ hunk: 0, lines: [2] }, { hunk: 1, lines: null }], false)
    // hunk 0 keeps only "+B": old 4 lines, new 5 lines -> later hunk starts one line later on the new side
    expect(patch).toBe(
      HEADER + '@@ -1,4 +1,5 @@ heading\n a\n b\n+B\n c\n d\n@@ -10,3 +11,5 @@\n x\n+new1\n+new2\n y\n-z\n+Z\n'
    )
  })

  test('drops the no-newline marker together with its line', () => {
    const diff = HEADER + '@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n'
    // keep only the removal: the unselected addition and its marker go away together
    expect(buildPartialPatch(diff, [{ hunk: 0, lines: [0] }], false)).toBe(
      HEADER + '@@ -1,1 +1,0 @@\n-old\n\\ No newline at end of file\n'
    )
  })

  test('returns null when the selection contains no change', () => {
    expect(buildPartialPatch(DIFF, [{ hunk: 1, lines: [0, 3] }], false)).toBeNull()
  })
})
