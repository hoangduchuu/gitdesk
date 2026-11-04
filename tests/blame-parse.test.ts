import { describe, expect, test } from 'vitest'
import { parseBlame, UNCOMMITTED_HASH_PATTERN } from '../src/shared/blame-parse'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const ZERO = '0'.repeat(40)

const details = (author: string, summary: string, extra = '', file = 'f.txt') =>
  `author ${author}\nauthor-mail <x@y.z>\nauthor-time 1700000000\nauthor-tz +0000\ncommitter ${author}\ncommitter-mail <x@y.z>\ncommitter-time 1700000000\ncommitter-tz +0000\nsummary ${summary}\n${extra}filename ${file}\n`

describe('parseBlame', () => {
  test('reads the commit details of each line', () => {
    const lines = parseBlame(`${A} 1 1 1\n${details('Ann', 'first')}\tone\n${B} 2 2 1\n${details('Bob', 'second')}\ttwo\n`)

    expect(lines).toEqual([
      { line: 1, hash: A, author: 'Ann', time: 1700000000, summary: 'first', path: 'f.txt', boundary: false, text: 'one' },
      { line: 2, hash: B, author: 'Bob', time: 1700000000, summary: 'second', path: 'f.txt', boundary: false, text: 'two' }
    ])
  })

  test('repeats the details for later lines of a commit that git only described once', () => {
    // Lines 1-2 are one group (count 2); line 3 comes back to the same commit with no details.
    const lines = parseBlame(
      `${A} 1 1 2\n${details('Ann', 'first')}\tone\n${A} 2 2\n\ttwo\n${B} 3 3 1\n${details('Bob', 'second')}\tthree\n${A} 4 4 1\n\tfour\n`
    )

    expect(lines.map((l) => [l.line, l.author, l.text])).toEqual([
      [1, 'Ann', 'one'],
      [2, 'Ann', 'two'],
      [3, 'Bob', 'three'],
      [4, 'Ann', 'four']
    ])
  })

  test('numbers lines by their place in the file, not in the commit that wrote them', () => {
    const lines = parseBlame(`${A} 7 1 1\n${details('Ann', 'moved')}\tmoved up\n`)

    expect(lines[0]!.line).toBe(1)
  })

  test('marks boundary commits', () => {
    const lines = parseBlame(`${A} 1 1 1\n${details('Ann', 'root', 'boundary\n')}\tone\n`)

    expect(lines[0]!.boundary).toBe(true)
  })

  test('reports the path the file had in that commit', () => {
    const lines = parseBlame(`${A} 1 1 1\n${details('Ann', 'before rename', '', 'old-name.txt')}\tone\n`)

    expect(lines[0]!.path).toBe('old-name.txt')
  })

  test('keeps empty lines, tabs and header-like text inside a line', () => {
    const tricky = `${B} 9 9 1`
    const lines = parseBlame(`${A} 1 1 3\n${details('Ann', 's')}\t\n${A} 2 2\n\t\tindented\n${A} 3 3\n\t${tricky}\n`)

    expect(lines.map((l) => l.text)).toEqual(['', '\tindented', tricky])
  })

  test('recognizes the all-zero hash of uncommitted lines', () => {
    const lines = parseBlame(`${ZERO} 1 1 1\n${details('Not Committed Yet', 'Version of f.txt')}\tnew\n`)

    expect(UNCOMMITTED_HASH_PATTERN.test(lines[0]!.hash)).toBe(true)
    expect(UNCOMMITTED_HASH_PATTERN.test(A)).toBe(false)
  })

  test('returns nothing for empty output', () => {
    expect(parseBlame('')).toEqual([])
  })
})
