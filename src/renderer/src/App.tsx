import { useCallback, useEffect, useState } from 'react'
import type { RepoInfo, Result } from '../../shared/types'
import { api, errorMessage, unwrap } from './api'
import { MessageDialog } from './components/MessageDialog'
import { NewTabPage } from './components/NewTabPage'
import { TabBar } from './components/TabBar'
import {
  addEmptyTab,
  closeTab,
  cycleTab,
  initialTabs,
  moveTab,
  openRepoInTabs,
  restoreTabs,
  savedTabs,
  switchTabRepo,
  type TabsState
} from './tabs'
import { Workspace } from './Workspace'

/** The window: a tab bar over one workspace per tab. Background tabs stay mounted but hidden. */
export function App() {
  const [state, setState] = useState<TabsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const gitdesk = api()

  /** Put an opened repository in the target tab (when empty) or a new tab. */
  const show = useCallback((result: Result<RepoInfo | null>, targetId: number | null) => {
    try {
      const repo = unwrap(result)
      if (repo === null) return
      setState((current) => openRepoInTabs(current ?? initialTabs(), repo, targetId))
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void gitdesk.getWorkspace().then((result) => {
      if (cancelled) return
      if (result.ok) setState(restoreTabs(result.data.tabs, result.data.active))
      else {
        setState(initialTabs())
        setError(result.error)
      }
    })
    const unsubscribe = gitdesk.onRepoOpened((result) => show(result, null))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [gitdesk, show])

  // Tab shortcuts arrive from the app menu (Cmd+T, Cmd+W, Ctrl+Tab, Ctrl+Shift+Tab).
  useEffect(
    () =>
      gitdesk.onMenuCommand((command) =>
        setState((current) => {
          if (current === null) return current
          if (command === 'newTab') return addEmptyTab(current)
          if (command === 'closeTab') return closeTab(current, current.activeId)
          return cycleTab(current, command === 'nextTab' ? 1 : -1)
        })
      ),
    [gitdesk]
  )

  // Remember the tabs for the next launch.
  useEffect(() => {
    if (state === null) return
    const { paths, active } = savedTabs(state)
    void gitdesk.saveTabs(paths, active).then((result) => {
      if (!result.ok) console.error('[gitdesk] could not save tabs:', result.error)
    })
  }, [gitdesk, state])

  const activeRepo = state?.tabs.find((tab) => tab.id === state.activeId)?.repo ?? null
  useEffect(() => {
    document.title = activeRepo ? `${activeRepo.name} — GitDesk` : 'GitDesk'
  }, [activeRepo])

  if (state === null) return <div className="shell" />

  const openDialog = (targetId: number | null): void =>
    void gitdesk.openRepoDialog().then((result) => show(result, targetId))
  const openRecent = (targetId: number, path: string): void =>
    void gitdesk.openRecentRepo(path).then((result) => show(result, targetId))
  const switchRepo = (tabId: number, path: string): void =>
    void gitdesk.openRecentRepo(path).then((result) => {
      if (result.ok) setState((current) => current && switchTabRepo(current, tabId, result.data))
      else setError(result.error)
    })

  return (
    <div className="shell">
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        onSelect={(id) => setState({ ...state, activeId: id })}
        onClose={(id) => setState(closeTab(state, id))}
        onNew={() => setState(addEmptyTab(state))}
        onMove={(draggedId, targetId) => setState(moveTab(state, draggedId, targetId))}
        onOpen={() => openDialog(state.activeId)}
      />
      {state.tabs.map((tab) => {
        const active = tab.id === state.activeId
        return (
          <div key={tab.id} className="tab-content" hidden={!active}>
            {tab.repo ? (
              <Workspace
                key={tab.repo.path}
                repo={tab.repo}
                active={active}
                onOpen={() => openDialog(null)}
                onSwitchRepo={(path) => switchRepo(tab.id, path)}
              />
            ) : (
              <NewTabPage
                active={active}
                onOpenDialog={() => openDialog(tab.id)}
                onOpenRecent={(path) => openRecent(tab.id, path)}
              />
            )}
          </div>
        )
      })}
      {error && <MessageDialog kind="error" message={error} onClose={() => setError(null)} />}
    </div>
  )
}
