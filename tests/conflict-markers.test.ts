import { describe, expect, test } from 'vitest'
import { buildResolution, hasConflictMarkers, parseConflictMarkers } from '../src/shared/conflict-markers'

const FILE = [
  'line 1\n',
  '<<<<<<< HEAD\n',
  'ours A\n',
  '=======\n',
  'theirs A\n',
  '>>>>>>> feature\n',
  'middle\n',
  '<<<<<<< HEAD\n',
  'ours B\n',
  '||||||| base\n',
  'base B\n',
  '=======\n',
  'theirs B\n',
  '>>>>>>> feature\n',
  'end'
].join('')

describe('parseConflictMarkers', () => {
  test('splits a file into common text and conflict blocks, with and without diff3 base', () => {
    const segments = parseConflictMarkers(FILE)

    expect(segments).toEqual([
      { kind: 'common', text: 'line 1\n' },
      { kind: 'conflict', index: 0, ours: 'ours A\n', base: null, theirs: 'theirs A\n', oursLabel: 'HEAD', theirsLabel: 'feature' },
      { kind: 'common', text: 'middle\n' },
      { kind: 'conflict', index: 1, ours: 'ours B\n', base: 'base B\n', theirs: 'theirs B\n', oursLabel: 'HEAD', theirsLabel: 'feature' },
      { kind: 'common', text: 'end' }
    ])
  })

  test('keeps CRLF line endings intact', () => {
    const segments = parseConflictMarkers('a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\n')
    expect(segments[1]).toMatchObject({ ours: 'x\r\n', theirs: 'y\r\n' })
  })

  test('treats an unterminated marker block as plain text', () => {
    const text = 'a\n<<<<<<< HEAD\nb\n'
    expect(parseConflictMarkers(text)).toEqual([{ kind: 'common', text }])
  })
})

describe('buildResolution', () => {
  const segments = parseConflictMarkers(FILE)

  test('assembles the file from one choice per conflict', () => {
    expect(buildResolution(segments, ['ours', 'theirs'])).toBe('line 1\nours A\nmiddle\ntheirs B\nend')
    expect(buildResolution(segments, ['both-ours-first', 'both-theirs-first'])).toBe(
      'line 1\nours A\ntheirs A\nmiddle\ntheirs B\nours B\nend'
    )
  })

  test('returns null while a conflict is still unchosen', () => {
    expect(buildResolution(segments, ['ours', null])).toBeNull()
  })
})

test('hasConflictMarkers detects leftover markers', () => {
  expect(hasConflictMarkers(FILE)).toBe(true)
  expect(hasConflictMarkers('clean\n=======\n')).toBe(false)
})
