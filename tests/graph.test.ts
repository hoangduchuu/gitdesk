import { describe, expect, test } from 'vitest'
import { layoutGraph } from '../src/shared/graph'
import type { Commit } from '../src/shared/types'

const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  authorName: 'a',
  authorEmail: 'a@x',
  authorTime: 0,
  refs: [],
  subject: hash,
  body: ''
})

describe('layoutGraph', () => {
  test('keeps a linear history in a single lane', () => {
    const rows = layoutGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])

    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[0]!.top).toEqual([])
    expect(rows[0]!.bottom).toEqual([{ from: 0, to: 0, color: 0 }])
    expect(rows[2]!.top).toEqual([{ from: 0, to: 0, color: 0 }])
    expect(rows[2]!.bottom).toEqual([])
  })

  test('opens a second lane for a merge parent and closes it at the fork point', () => {
    // m merges b into a-line:  m -> (a2, b), a2 -> a1, b -> a1
    const rows = layoutGraph([
      commit('m', ['a2', 'b']),
      commit('a2', ['a1']),
      commit('b', ['a1']),
      commit('a1')
    ])

    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0])
    expect(rows[0]!.bottom).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 }
    ])
    // b's lane joins a1 in lane 0
    expect(rows[3]!.top).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 1 }
    ])
    expect(rows[3]!.width).toBe(2)
  })

  test('passes unrelated lanes straight through a row', () => {
    const rows = layoutGraph([
      commit('x', ['x0']),
      commit('y', ['y0']),
      commit('x0'),
      commit('y0')
    ])

    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 1])
    // lane 0 passes through row y
    expect(rows[1]!.top).toContainEqual({ from: 0, to: 0, color: 0 })
    expect(rows[1]!.bottom).toContainEqual({ from: 0, to: 0, color: 0 })
  })

  test('reuses a freed lane instead of widening the graph', () => {
    const rows = layoutGraph([
      commit('m', ['a', 'b']),
      commit('b', ['a']),
      commit('a', ['r']),
      commit('t', ['r']),
      commit('r')
    ])

    // after b joins a, lane 1 is free again and t takes it
    expect(rows[3]!.column).toBe(1)
  })

  test('draws a lane to the bottom edge when the parent is not loaded', () => {
    const rows = layoutGraph([commit('c', ['not-loaded'])])

    expect(rows[0]!.bottom).toEqual([{ from: 0, to: 0, color: 0 }])
  })

  test('connects a merge to a parent that is already tracked by another lane', () => {
    const rows = layoutGraph([
      commit('t', ['a']),
      commit('m', ['b', 'a']),
      commit('b', ['a']),
      commit('a')
    ])

    expect(rows[1]!.column).toBe(1)
    // m's second parent "a" is already expected in lane 0
    expect(rows[1]!.bottom).toContainEqual({ from: 1, to: 0, color: 0 })
  })
})
