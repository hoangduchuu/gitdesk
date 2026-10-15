import { describe, expect, test } from 'vitest'
import { ageMarkers, authorHue, changeSummary, relativeAge, splitPath } from '../src/shared/format'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = 1_800_000_000

describe('relativeAge', () => {
  test.each([
    [NOW - 30, 'now'],
    [NOW - 5 * MINUTE, '5 minutes ago'],
    [NOW - 1 * HOUR, '1 hour ago'],
    [NOW - 3 * HOUR, '3 hours ago'],
    [NOW - 1 * DAY, '1 day ago'],
    [NOW - 4 * DAY, '4 days ago'],
    [NOW - 45 * DAY, '1 month ago'],
    [NOW - 200 * DAY, '6 months ago'],
    [NOW - 800 * DAY, '2 years ago'],
    [NOW + HOUR, 'now']
  ])('%i -> %s', (time, label) => {
    expect(relativeAge(time, NOW)).toBe(label)
  })
})

test('relativeAge speaks Vietnamese', () => {
  expect(relativeAge(NOW - 4 * DAY, NOW, 'vi-VN')).toBe('4 ngày trước')
  expect(relativeAge(NOW - 800 * DAY, NOW, 'vi-VN')).toBe('2 năm trước')
})

describe('authorHue', () => {
  test('is stable per author and spreads different authors', () => {
    expect(authorHue('a@x.com')).toBe(authorHue('A@X.com'))
    expect(authorHue('a@x.com')).not.toBe(authorHue('b@x.com'))
    expect(authorHue('a@x.com')).toBeGreaterThanOrEqual(0)
    expect(authorHue('a@x.com')).toBeLessThan(360)
  })
})

describe('splitPath', () => {
  test('separates the folder from the file name', () => {
    expect(splitPath('src/shared/format.ts')).toEqual({ dir: 'src/shared/', name: 'format.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })
})

describe('changeSummary', () => {
  test('counts files per kind, untracked as added', () => {
    expect(
      changeSummary([{ kind: 'modified' }, { kind: 'added' }, { kind: 'untracked' }, { kind: 'deleted' }, { kind: 'renamed' }])
    ).toEqual({ modified: 1, added: 2, deleted: 1, renamed: 1 })
  })
})

describe('ageMarkers', () => {
  test('marks the last row of each age group and skips rows without a time', () => {
    const times = [null, NOW - 3 * DAY, NOW - 3 * DAY, NOW - 4 * DAY, null, NOW - 4 * DAY, NOW - 800 * DAY]
    expect(ageMarkers(times, NOW, 'en-US')).toEqual([null, null, '3 days ago', null, null, '4 days ago', '2 years ago'])
  })
})
