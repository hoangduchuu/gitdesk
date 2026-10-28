import { describe, expect, test } from 'vitest'
import type { RepoInfo } from '../src/shared/types'
import {
  addEmptyTab,
  closeTab,
  cycleTab,
  initialTabs,
  moveTab,
  openRepoInTabs,
  restoreTabs,
  savedTabs,
  switchTabRepo
} from '../src/renderer/src/tabs'

const repo = (name: string): RepoInfo => ({ path: `/repos/${name}`, name, head: 'main' })
const names = (state: ReturnType<typeof initialTabs>): (string | null)[] => state.tabs.map((tab) => tab.repo?.name ?? null)

describe('tabs', () => {
  test('starts with one empty tab', () => {
    const state = initialTabs()
    expect(names(state)).toEqual([null])
    expect(state.activeId).toBe(state.tabs[0]!.id)
  })

  test('restores saved tabs and the selected one', () => {
    const state = restoreTabs([repo('a'), repo('b')], 1)
    expect(names(state)).toEqual(['a', 'b'])
    expect(state.activeId).toBe(state.tabs[1]!.id)
    expect(names(restoreTabs([], -1))).toEqual([null])
  })

  test('opening into an empty target tab fills that tab', () => {
    const start = initialTabs()
    const state = openRepoInTabs(start, repo('a'), start.activeId)
    expect(names(state)).toEqual(['a'])
    expect(state.activeId).toBe(start.activeId)
  })

  test('opening from a repository tab adds a new tab', () => {
    const one = restoreTabs([repo('a')], 0)
    const state = openRepoInTabs(one, repo('b'), one.activeId)
    expect(names(state)).toEqual(['a', 'b'])
    expect(state.activeId).toBe(state.tabs[1]!.id)
  })

  test('opening a repository that already has a tab switches to it', () => {
    const two = restoreTabs([repo('a'), repo('b')], 1)
    const state = openRepoInTabs(two, repo('a'), null)
    expect(names(state)).toEqual(['a', 'b'])
    expect(state.activeId).toBe(two.tabs[0]!.id)
  })

  test('switching repository replaces the repository of that tab', () => {
    const two = restoreTabs([repo('a'), repo('b')], 0)
    const state = switchTabRepo(two, two.tabs[0]!.id, repo('c'))
    expect(names(state)).toEqual(['c', 'b'])
    expect(state.activeId).toBe(two.tabs[0]!.id)
  })

  test('switching to a repository open in another tab shows that tab instead', () => {
    const two = restoreTabs([repo('a'), repo('b')], 0)
    const state = switchTabRepo(two, two.tabs[0]!.id, repo('b'))
    expect(names(state)).toEqual(['a', 'b'])
    expect(state.activeId).toBe(two.tabs[1]!.id)
  })

  test('closing the active tab selects its right neighbour, else the left', () => {
    const three = restoreTabs([repo('a'), repo('b'), repo('c')], 1)
    const middle = closeTab(three, three.tabs[1]!.id)
    expect(names(middle)).toEqual(['a', 'c'])
    expect(middle.activeId).toBe(three.tabs[2]!.id)
    const last = closeTab(middle, middle.tabs[1]!.id)
    expect(last.activeId).toBe(three.tabs[0]!.id)
  })

  test('closing a background tab keeps the selection', () => {
    const two = restoreTabs([repo('a'), repo('b')], 1)
    expect(closeTab(two, two.tabs[0]!.id).activeId).toBe(two.tabs[1]!.id)
  })

  test('closing the last tab leaves an empty one', () => {
    const one = restoreTabs([repo('a')], 0)
    const state = closeTab(one, one.tabs[0]!.id)
    expect(names(state)).toEqual([null])
    expect(state.activeId).toBe(state.tabs[0]!.id)
  })

  test('tab ids stay unique after closing and adding', () => {
    const one = restoreTabs([repo('a')], 0)
    const state = addEmptyTab(closeTab(addEmptyTab(one), one.tabs[0]!.id))
    expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(state.tabs.length)
  })

  test('saves only repository tabs and the selected one among them', () => {
    const state = addEmptyTab(restoreTabs([repo('a'), repo('b')], 0))
    expect(savedTabs(state)).toEqual({ paths: ['/repos/a', '/repos/b'], active: -1 })
    expect(savedTabs(restoreTabs([repo('a'), repo('b')], 1))).toEqual({ paths: ['/repos/a', '/repos/b'], active: 1 })
  })

  test('cycling wraps around both ways', () => {
    const three = restoreTabs([repo('a'), repo('b'), repo('c')], 2)
    expect(cycleTab(three, 1).activeId).toBe(three.tabs[0]!.id)
    expect(cycleTab(three, -1).activeId).toBe(three.tabs[1]!.id)
    expect(cycleTab(restoreTabs([repo('a')], 0), 1).activeId).toBe(1)
  })

  test('dragging a tab onto another moves it to that place', () => {
    const three = restoreTabs([repo('a'), repo('b'), repo('c')], 0)
    const [a, b, c] = three.tabs.map((tab) => tab.id) as [number, number, number]
    expect(names(moveTab(three, a, c))).toEqual(['b', 'c', 'a'])
    expect(names(moveTab(three, c, a))).toEqual(['c', 'a', 'b'])
    expect(names(moveTab(three, b, b))).toEqual(['a', 'b', 'c'])
    expect(moveTab(three, a, c).activeId).toBe(a)
  })
})
