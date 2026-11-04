import { useCallback, useEffect, useRef, useState } from 'react'
import type { Branch, RemoteState, Stash, Tag, WorkingTreeStatus, Worktree } from '../../../shared/model'
import type { Commit, RepoInfo, Result } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'

const LOG_LIMIT = 5000

export interface RepoData {
  commits: Commit[]
  status: WorkingTreeStatus
  branches: Branch[]
  stashes: Stash[]
  tags: Tag[]
  remotes: RemoteState
  worktrees: Worktree[]
}

/**
 * Loads one repository and runs git operations against it, reloading afterwards. A tab in the
 * background (active false) skips the focus refresh and catches up when it is shown again.
 */
export function useRepository(repo: RepoInfo | null, active = true) {
  const [data, setData] = useState<RepoData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!repo) return
    try {
      const gitdesk = api()
      const [commits, status, branches, stashes, tags, remotes, worktrees] = await Promise.all([
        gitdesk.getLog(repo.path, LOG_LIMIT).then(unwrap),
        gitdesk.getStatus(repo.path).then(unwrap),
        gitdesk.getBranches(repo.path).then(unwrap),
        gitdesk.getStashes(repo.path).then(unwrap),
        gitdesk.getTags(repo.path).then(unwrap),
        gitdesk.getRemotes(repo.path).then(unwrap),
        gitdesk.getWorktrees(repo.path).then(unwrap)
      ])
      setData({ commits, status, branches, stashes, tags, remotes, worktrees })
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [repo])

  useEffect(() => {
    setData(null)
    setError(null)
    setNotice(null)
    void reload()
  }, [reload])

  // Pick up changes made outside the app (editor, terminal) when the window regains focus.
  useEffect(() => {
    if (!active) return
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload, active])

  // Showing a background tab again picks up what changed while it was hidden.
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) void reload()
    wasActive.current = active
  }, [active, reload])

  /**
   * Run one operation; errors become a banner instead of an exception. The result tells
   * success from failure even for operations whose data is null. `showError` false leaves
   * an error the caller handles itself (e.g. by asking the user) out of the banner.
   */
  const run = useCallback(
    async <T,>(
      label: string,
      operation: () => Promise<Result<T>>,
      options: { showError?: (error: string) => boolean } = {}
    ): Promise<Result<T>> => {
      setBusy(label)
      setError(null)
      setNotice(null)
      try {
        const result = await operation()
        if (!result.ok && (options.showError?.(result.error) ?? true)) setError(result.error)
        return result
      } catch (failure) {
        const message = errorMessage(failure)
        setError(message)
        return { ok: false, error: message }
      } finally {
        setBusy(null)
        await reload()
      }
    },
    [reload]
  )

  return { data, busy, error, notice, setError, setNotice, reload, run }
}

export type RepositoryController = ReturnType<typeof useRepository>
