import type { RepoInfo } from '../../shared/types'

/** A window tab: a repository, or an empty "New Tab" page when repo is null. */
export interface Tab {
  id: number
  repo: RepoInfo | null
}

export interface TabsState {
  tabs: Tab[]
  activeId: number
  nextId: number
}

const emptyTab = (id: number): Tab => ({ id, repo: null })

/** One empty tab: the starting point when nothing was saved. */
export const initialTabs = (): TabsState => ({ tabs: [emptyTab(1)], activeId: 1, nextId: 2 })

/** Tabs restored from the saved workspace; falls back to one empty tab. */
export function restoreTabs(repos: RepoInfo[], active: number): TabsState {
  if (repos.length === 0) return initialTabs()
  const tabs = repos.map((repo, index) => ({ id: index + 1, repo }))
  return { tabs, activeId: tabs[active]?.id ?? 1, nextId: tabs.length + 1 }
}

/**
 * Show a repository: switch to its tab when it is already open, otherwise put it in the
 * target tab when that tab is empty, otherwise in a new tab at the end.
 */
export function openRepoInTabs(state: TabsState, repo: RepoInfo, targetId: number | null): TabsState {
  const existing = state.tabs.find((tab) => tab.repo?.path === repo.path)
  if (existing) return { ...state, activeId: existing.id }
  const target = state.tabs.find((tab) => tab.id === targetId)
  if (target && target.repo === null) {
    return { ...state, tabs: state.tabs.map((tab) => (tab.id === target.id ? { ...tab, repo } : tab)), activeId: target.id }
  }
  const tab = { id: state.nextId, repo }
  return { tabs: [...state.tabs, tab], activeId: tab.id, nextId: state.nextId + 1 }
}

/** Show another repository in this tab, as GitHub Desktop does; one already open keeps its own tab. */
export function switchTabRepo(state: TabsState, tabId: number, repo: RepoInfo): TabsState {
  const existing = state.tabs.find((tab) => tab.repo?.path === repo.path)
  if (existing) return { ...state, activeId: existing.id }
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, repo } : tab)), activeId: tabId }
}

export function addEmptyTab(state: TabsState): TabsState {
  const tab = emptyTab(state.nextId)
  return { tabs: [...state.tabs, tab], activeId: tab.id, nextId: state.nextId + 1 }
}

/** Close a tab; the neighbour on the right (else left) becomes active. The last tab leaves an empty one. */
export function closeTab(state: TabsState, id: number): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (tabs.length === 0) return addEmptyTab({ ...state, tabs: [] })
  if (state.activeId !== id) return { ...state, tabs }
  const neighbour = tabs[Math.min(index, tabs.length - 1)]!
  return { ...state, tabs, activeId: neighbour.id }
}

/** What to save: repository tabs left to right and the selected one among them (-1 for none). */
export function savedTabs(state: TabsState): { paths: string[]; active: number } {
  const repoTabs = state.tabs.filter((tab) => tab.repo !== null)
  return {
    paths: repoTabs.map((tab) => tab.repo!.path),
    active: repoTabs.findIndex((tab) => tab.id === state.activeId)
  }
}

/** Select the next (step 1) or previous (step -1) tab, wrapping around. */
export function cycleTab(state: TabsState, step: 1 | -1): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
  const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length]!
  return { ...state, activeId: next.id }
}

/** Drag-and-drop: put the dragged tab where the target tab is. */
export function moveTab(state: TabsState, draggedId: number, targetId: number): TabsState {
  const from = state.tabs.findIndex((tab) => tab.id === draggedId)
  const to = state.tabs.findIndex((tab) => tab.id === targetId)
  if (from < 0 || to < 0 || from === to) return state
  const tabs = state.tabs.filter((tab) => tab.id !== draggedId)
  tabs.splice(to, 0, state.tabs[from]!)
  return { ...state, tabs }
}
