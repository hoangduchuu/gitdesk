import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { layoutGraph } from '../../shared/graph'
import { buildGraphNodes, WIP_HASH, type GraphNode } from '../../shared/graph-nodes'
import type { Branch, DiffTarget, GitflowConfig, GitflowState, PublishInput } from '../../shared/model'
import type { Commit, RepoInfo } from '../../shared/types'
import { createActions } from './actions'
import { api } from './api'
import type { BranchDrop } from './branchDrag'
import { ChangesPanel } from './components/ChangesPanel'
import { ChoiceDialog, type ChoiceRequest } from './components/ChoiceDialog'
import { useConfirm } from './components/ConfirmDialog'
import { CommitGraph } from './components/CommitGraph'
import { CommitPanel } from './components/CommitPanel'
import { ConflictView } from './components/ConflictView'
import { action, ContextMenu, heading, separator, type MenuItem, type MenuRequest } from './components/ContextMenu'
import { DiffView, type StagingOptions } from './components/DiffView'
import { GitflowInitDialog } from './components/GitflowInitDialog'
import { OperationBanner } from './components/OperationBanner'
import { PublishDialog } from './components/PublishDialog'
import { ProfilesDialog } from './components/ProfilesDialog'
import { PromptDialog, type PromptRequest } from './components/PromptDialog'
import { RebaseView } from './components/RebaseView'
import { ReflogView } from './components/ReflogView'
import { FileHistoryView } from './components/FileHistoryView'
import { BlameView } from './components/BlameView'
import { PullRequestDialog } from './components/PullRequestDialog'
import { githubRemoteName } from '../../shared/remote-url'
import { Icon } from './icons'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { StashPanel } from './components/StashPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { Toolbar } from './components/Toolbar'
import { Splitter } from './components/Splitter'
import { DEFAULT_WIDTHS, usePaneWidths } from './hooks/usePaneWidths'
import { Toast } from './components/Toast'
import { MessageDialog } from './components/MessageDialog'
import { useRepository } from './hooks/useRepository'
import { useT, useTCount } from './i18n'

type Selection = { kind: 'wip' } | { kind: 'commit'; hash: string } | { kind: 'stash'; hash: string } | null

type Center =
  | { kind: 'graph' }
  | { kind: 'diff'; target: DiffTarget; title: string; key: string }
  | { kind: 'conflict'; path: string }
  | { kind: 'rebase'; base: string }
  | { kind: 'reflog' }
  | { kind: 'history'; path: string }
  | { kind: 'blame'; path: string; rev: string | null }

interface Props {
  repo: RepoInfo
  /** False while another tab is shown; the workspace stays mounted so its state survives. */
  active: boolean
  onOpen: () => void
  /** Show another repository in this tab. */
  onSwitchRepo: (path: string) => void
}

/** One repository's window content: toolbar, sidebar, graph, details and terminal. */
export function Workspace({ repo, active, onOpen, onSwitchRepo }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const tCount = useTCount()
  const [selection, setSelection] = useState<Selection>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [center, setCenter] = useState<Center>({ kind: 'graph' })
  const [reveal, setReveal] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [choice, setChoice] = useState<ChoiceRequest | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [gitflowInit, setGitflowInit] = useState<GitflowState | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [prDialog, setPrDialog] = useState<{ head: string } | null>(null)
  const [prVersion, setPrVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Bumped when the profiles dialog closes, so pickers reload. */
  const [profileVersion, setProfileVersion] = useState(0)
  /** null until first opened; the shell keeps running while the panel is hidden. */
  const [terminal, setTerminal] = useState<'shown' | 'hidden' | null>(null)
  const toggleTerminal = useCallback(() => setTerminal((current) => (current === 'shown' ? 'hidden' : 'shown')), [])

  // Ctrl+` toggles the terminal, as in VS Code.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTerminal, active])
  const controller = useRepository(repo, active)
  const { data, busy, error, notice, setError, setNotice, run } = controller
  const gitdesk = api()
  const [searchTick, setSearchTick] = useState(0)
  const [widths, setWidths] = usePaneWidths()

  const rows = useMemo(
    () => (data ? layoutGraph(buildGraphNodes(data.commits, data.stashes, data.status)) : []),
    [data]
  )
  const status = data?.status ?? null
  const changeCount = status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0

  // Leave the working-changes panel once there is nothing left in it.
  useEffect(() => {
    if (selection?.kind === 'wip' && changeCount === 0) setSelection(null)
  }, [selection, changeCount])

  const closeMenu = useCallback(() => setMenu(null), [])

  const path = repo.path
  const closeCenter = (): void => setCenter({ kind: 'graph' })
  const actions = createActions({
    path,
    controller,
    status,
    onConflicts: () => {
      setSelection({ kind: 'wip' })
      closeCenter()
    },
    onSelectionGone: () => setSelection(null),
    prompt: setPrompt,
    choose: setChoice,
    confirm,
    openRebase: (base) => setCenter({ kind: 'rebase', base }),
    openFileHistory: (filePath) => setCenter({ kind: 'history', path: filePath }),
    openBlame: (filePath) => setCenter({ kind: 'blame', path: filePath, rev: null }),
    openPullRequestDialog: (head) => setPrDialog({ head }),
    canPullRequest: githubRemoteName(data?.remotes.remotes ?? []) !== null,
    openGitflowInit: setGitflowInit,
    t,
    tCount
  })

  // Keyboard shortcuts for the active tab. The latest handlers are kept in a ref so the listener is bound once.
  const shortcuts = useRef<Record<string, () => void>>({})
  shortcuts.current = {
    f: () => {
      closeCenter()
      setSearchTick((tick) => tick + 1)
    },
    'shift+f': () => void run(t('app.fetching'), () => gitdesk.fetch(path)),
    'shift+p': () => push(),
    'shift+l': () => actions.pull(),
    ',': () => setSettingsOpen(true)
  }
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const handler = shortcuts.current[`${event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const openMenu = (items: MenuItem[], event: MouseEvent): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  /** Picked commits in graph order (newest first), including the clicked one. */
  const pickedInOrder = (clicked: string): string[] => {
    const all = new Set([...picked, clicked])
    return rows.filter((row) => row.node.kind === 'commit' && all.has(row.node.hash)).map((row) => row.node.hash)
  }

  const selectNode = (node: GraphNode, additive: boolean): void => {
    if (additive && node.kind === 'commit') {
      setPicked((current) => {
        const next = new Set(current)
        if (next.has(node.hash)) next.delete(node.hash)
        else next.add(node.hash)
        return next
      })
      return
    }
    setPicked(new Set())
    setSelection(node.kind === 'wip' ? { kind: 'wip' } : { kind: node.kind, hash: node.hash })
  }

  /** GitHub Desktop-style repository switcher, opened from the repository name. */
  const repoMenu = (event: MouseEvent): void => {
    const anchor = event.currentTarget.getBoundingClientRect()
    void gitdesk.getRecentRepos().then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      const recent = result.data.map((other) =>
        action(other.name, () => onSwitchRepo(other.path), { icon: 'branch', disabled: other.path === path })
      )
      setMenu({
        x: anchor.left,
        y: anchor.bottom,
        items: [heading(t('tabs.recent')), ...recent, separator, action(t('toolbar.open'), onOpen, { icon: 'open' })]
      })
    })
  }

  /** GitHub Desktop-style branch switcher, opened from the branch name; checking out reuses the sidebar's action. */
  const branchMenu = (event: MouseEvent): void => {
    if (!data) return
    const anchor = event.currentTarget.getBoundingClientRect()
    const item = (branch: Branch): MenuItem =>
      action(branch.name, () => actions.checkout(branch), {
        icon: branch.isHead ? 'checkout' : branch.kind === 'local' ? 'local' : 'remote',
        disabled: branch.isHead
      })
    const local = data.branches.filter((branch) => branch.kind === 'local').map(item)
    const remote = data.branches.filter((branch) => branch.kind === 'remote').map(item)
    setMenu({
      x: anchor.left,
      y: anchor.bottom,
      items: [
        heading(t('toolbar.localBranches')),
        ...local,
        ...(remote.length > 0 ? [separator, heading(t('toolbar.remoteBranches')), ...remote] : [])
      ]
    })
  }

  /** Git Flow menu under the toolbar button; its content depends on the repository's Git Flow state. */
  const gitflowMenu = (event: MouseEvent): void => {
    const anchor = event.currentTarget.getBoundingClientRect()
    void gitdesk.getGitflow(path).then((result) => {
      if (!result.ok) return setError(result.error)
      setMenu({ x: anchor.left, y: anchor.bottom, items: actions.gitflowMenu(result.data) })
    })
  }

  /** Pushing a repository that has no remote publishes it instead. */
  const push = (): void => {
    if (data && data.remotes.remotes.length === 0) setPublishOpen(true)
    else actions.push()
  }

  const pushMenu = (event: MouseEvent): void => {
    const canForce = (data?.remotes.remotes.length ?? 0) > 0 && status?.upstream != null
    openMenu(
      [
        action(t('toolbar.push'), push, { icon: 'push' }),
        action(t('menu.forcePush'), actions.confirmForcePush, { icon: 'upload', danger: true, disabled: !canForce })
      ],
      event
    )
  }

  const publishNew = (input: PublishInput): void => {
    setPublishOpen(false)
    void run(t('publish.publishing'), () => gitdesk.publishRepository(path, input)).then((result) => {
      if (result.ok) setNotice(t('publish.done', { url: result.data.webUrl }))
    })
  }

  const publishToUrl = (remote: string, url: string): void => {
    setPublishOpen(false)
    void run(t('publish.publishing'), async () => {
      const added = await gitdesk.addRemote(path, remote, url)
      return added.ok ? gitdesk.push(path, false) : added
    })
  }

  const saveGitflow = (config: GitflowConfig): void => {
    setGitflowInit(null)
    void run(t('gitflow.initializing'), () => gitdesk.initGitflow(path, config))
  }

  /** A branch was dropped on another (graph label or sidebar): offer merge and rebase where the drop is. */
  const branchDrop: BranchDrop = (source, target, event) => {
    setMenu({ x: event.clientX, y: event.clientY, items: actions.branchDropMenu(source, target, data?.branches ?? []) })
  }

  const nodeMenu = (node: GraphNode, event: MouseEvent): void => {
    if (node.kind === 'commit') {
      const hashes = picked.size > 0 ? pickedInOrder(node.hash) : [node.hash]
      openMenu(actions.commitMenu(node.commit, hashes), event)
    } else if (node.kind === 'stash') {
      openMenu(actions.stashMenu(node.stash), event)
    } else {
      openMenu([action(t('app.stashChanges'), actions.promptStash, { icon: 'stash' })], event)
    }
  }

  const fileMenu = (filePath: string, event: MouseEvent): void => openMenu(actions.fileMenu(filePath), event)

  const openDiff = (target: DiffTarget, title: string, key: string): void =>
    setCenter({ kind: 'diff', target, title, key })

  const staging = (target: DiffTarget): StagingOptions | undefined =>
    target.kind === 'working' && !target.untracked
      ? {
          source: target.staged ? 'staged' : 'unstaged',
          apply: async (request) =>
            (
              await run(request.action === 'discard' ? t('app.discarding') : t('app.updatingIndex'), () =>
                gitdesk.applySelection(path, request)
              )
            ).ok
        }
      : undefined

  // A search can find commits older than the loaded history: they have no graph row, only details.
  const [olderCommit, setOlderCommit] = useState<Commit | null>(null)
  const openOlderCommit = (commit: Commit): void => {
    setPicked(new Set())
    setOlderCommit(commit)
    setSelection({ kind: 'commit', hash: commit.hash })
  }
  const selectedCommit =
    selection?.kind === 'commit'
      ? data?.commits.find((commit) => commit.hash === selection.hash) ?? (olderCommit?.hash === selection.hash ? olderCommit : null)
      : null
  const selectedStash =
    selection?.kind === 'stash' ? data?.stashes.find((stash) => stash.hash === selection.hash) ?? null : null
  const centerKey = center.kind === 'diff' ? center.key : center.kind === 'conflict' ? `conflict:${center.path}` : null

  const revealCommit = (hash: string): void => {
    setPicked(new Set())
    setSelection({ kind: 'commit', hash })
    setReveal(hash)
    closeCenter()
  }

  return (
    <div className="app">
      <Toolbar
        repo={repo}
        status={status}
        busy={busy}
        stashCount={data?.stashes.length ?? 0}
        onOpen={onOpen}
        onRepoMenu={repoMenu}
        onBranchMenu={data ? branchMenu : undefined}
        onFetch={() => void run(t('app.fetching'), () => gitdesk.fetch(path))}
        onPull={actions.pull}
        onPush={push}
        onPushMenu={pushMenu}
        onBranch={() => actions.promptCreateBranch(null)}
        onGitflow={gitflowMenu}
        onStash={actions.promptStash}
        onPop={() => data?.stashes[0] && actions.popStash(data.stashes[0])}
        reflogOpen={center.kind === 'reflog'}
        onReflog={() => (center.kind === 'reflog' ? closeCenter() : setCenter({ kind: 'reflog' }))}
        onProfiles={() => setProfilesOpen(true)}
        terminalOpen={terminal === 'shown'}
        onTerminal={toggleTerminal}
        onSettings={() => setSettingsOpen(true)}
      />
      {error && <MessageDialog kind="error" message={error} onClose={() => setError(null)} />}
      {!error && notice && <Toast message={notice} onClose={() => setNotice(null)} />}
      {status && (
        <OperationBanner
          status={status}
          onContinue={() => void run(t('app.continuing'), () => gitdesk.continueOperation(path)).then(actions.reportMerge)}
          onAbort={() => {
            void confirm(t('app.abortConfirm'), { danger: true }).then((ok) => {
              if (ok) void run(t('app.aborting'), () => gitdesk.abortOperation(path))
            })
          }}
        />
      )}

      <div
        className="workspace"
        style={{ gridTemplateColumns: `${widths.sidebar}px 0 minmax(0, 1fr) 0 ${widths.details}px` }}
      >
        {data ? (
          <Sidebar
            branches={data.branches}
            stashes={data.stashes}
            tags={data.tags}
            remotes={data.remotes.remotes}
            selectedStash={selectedStash?.ref ?? null}
            onSelectBranch={(branch) => revealCommit(branch.hash)}
            onSelectTag={(tag) => revealCommit(tag.hash)}
            onCheckout={actions.checkout}
            onSelectStash={(stash) => {
              setSelection({ kind: 'stash', hash: stash.hash })
              closeCenter()
            }}
            onBranchMenu={(branch, event) => openMenu(actions.branchMenu(branch), event)}
            onTagMenu={(tag, event) => openMenu(actions.tagMenu(tag), event)}
            onStashMenu={(stash, event) => openMenu(actions.stashMenu(stash), event)}
            onBranchDrop={branchDrop}
            onRemoteMenu={(remote, event) => openMenu(actions.remoteMenu(remote), event)}
            onAddRemote={actions.promptAddRemote}
            onPublish={() => setPublishOpen(true)}
            github={githubRemoteName(data.remotes.remotes) !== null}
            repo={path}
            prVersion={prVersion}
            onPullRequestMenu={(pr, event) => openMenu(actions.pullRequestMenu(pr), event)}
            onCreatePullRequest={() => status?.branch && setPrDialog({ head: status.branch })}
          />
        ) : (
          <nav className="sidebar" />
        )}

        <Splitter
          value={widths.sidebar}
          min={160}
          max={480}
          direction={1}
          reset={DEFAULT_WIDTHS.sidebar}
          label={t('layout.resizeSidebar')}
          onChange={(sidebar) => setWidths({ sidebar })}
        />
        <main className="center">
          {!data && <GraphSkeleton label={t('common.loadingRepository')} />}
          {data && center.kind === 'graph' && (
            <CommitGraph
              repo={path}
              rows={rows}
              selectedHash={selection?.kind === 'wip' ? WIP_HASH : selection?.hash ?? null}
              revealHash={reveal}
              picked={picked}
              onSelect={selectNode}
              onContextMenu={nodeMenu}
              onBranchDrop={branchDrop}
              onOpenOlder={openOlderCommit}
              searchTick={searchTick}
            />
          )}
          {center.kind === 'diff' && (
            <DiffView
              repo={path}
              target={center.target}
              title={center.title}
              staging={staging(center.target)}
              headerActions={
                center.target.kind === 'stash' || (center.target.kind === 'working' && center.target.untracked) ? undefined : (
                  <>
                    <button type="button" className="ghost" onClick={() => setCenter({ kind: 'history', path: center.target.path })}>
                      <Icon name="reflog" size={14} />{t('menu.fileHistory')}
                    </button>
                    <button type="button" className="ghost" onClick={() => setCenter({ kind: 'blame', path: center.target.path, rev: null })}>
                      <Icon name="user" size={14} />{t('menu.blame')}
                    </button>
                  </>
                )
              }
              onClose={closeCenter}
            />
          )}
          {center.kind === 'conflict' && (
            <ConflictView
              key={center.path}
              repo={path}
              path={center.path}
              controller={controller}
              others={(status?.conflicted ?? []).map((file) => file.path).filter((file) => file !== center.path)}
              onOpenNext={(file) => setCenter({ kind: 'conflict', path: file })}
              onClose={closeCenter}
            />
          )}
          {center.kind === 'blame' && (
            <BlameView
              key={`${center.path}@${center.rev ?? ''}`}
              repo={path}
              path={center.path}
              rev={center.rev}
              reloadKey={data?.commits}
              onReveal={revealCommit}
              onClose={closeCenter}
            />
          )}
          {center.kind === 'history' && (
            <FileHistoryView
              key={center.path}
              repo={path}
              path={center.path}
              reloadKey={data?.commits}
              onReveal={revealCommit}
              onBlame={(filePath, rev) => setCenter({ kind: 'blame', path: filePath, rev })}
              onClose={closeCenter}
            />
          )}
          {center.kind === 'reflog' && (
            <ReflogView
              repo={path}
              reloadKey={data?.commits}
              onMenu={(entry, event) => openMenu(actions.reflogMenu(entry), event)}
              onUndo={actions.undoLast}
              onClose={closeCenter}
            />
          )}
          {center.kind === 'rebase' && (
            <RebaseView
              key={center.base}
              repo={path}
              base={center.base}
              onStart={async (steps) => {
                const result = await run(t('app.rebasing'), () => gitdesk.interactiveRebase(path, center.base, steps))
                actions.reportMerge(result)
                return result.ok
              }}
              onClose={closeCenter}
            />
          )}
        </main>

        <Splitter
          value={widths.details}
          min={280}
          max={720}
          direction={-1}
          reset={DEFAULT_WIDTHS.details}
          label={t('layout.resizeDetails')}
          onChange={(details) => setWidths({ details })}
        />
        <aside className="details">
          {selection?.kind === 'wip' && status && (
            <ChangesPanel
              repo={path}
              status={status}
              controller={controller}
              selectedKey={centerKey}
              onOpenDiff={openDiff}
              onFileMenu={fileMenu}
              onOpenConflict={(file) => setCenter({ kind: 'conflict', path: file })}
              profileVersion={profileVersion}
              onManageProfiles={() => setProfilesOpen(true)}
            />
          )}
          {selectedCommit && (
            <CommitPanel
              repo={path}
              commit={selectedCommit}
              selectedKey={centerKey}
              onOpenDiff={openDiff}
              onFileMenu={fileMenu}
              onPrompt={setPrompt}
              onCreateBranch={(name, hash) => actions.createBranch(name, hash)}
            />
          )}
          {selectedStash && (
            <StashPanel
              repo={path}
              stash={selectedStash}
              selectedKey={centerKey}
              onOpenDiff={openDiff}
              onApply={actions.applyStash}
              onPop={actions.popStash}
              onDrop={actions.dropStash}
            />
          )}
          {!selection && <p className="hint">{t('app.selectDetails')}</p>}
        </aside>
      </div>

      {terminal !== null && (
        <TerminalPanel key={path} repo={path} visible={terminal === 'shown' && active} onClose={() => setTerminal('hidden')} />
      )}

      {prompt && <PromptDialog request={prompt} onClose={() => setPrompt(null)} />}
      {choice && <ChoiceDialog request={choice} onClose={() => setChoice(null)} />}
      {menu && <ContextMenu request={menu} onClose={closeMenu} />}
      {publishOpen && data && (
        <PublishDialog
          defaultName={repo.name}
          state={data.remotes}
          onCreate={publishNew}
          onUseUrl={publishToUrl}
          onClose={() => setPublishOpen(false)}
        />
      )}
      {prDialog && data && (
        <PullRequestDialog
          head={prDialog.head}
          notPushed={prDialog.head === status?.branch && status.upstream === null}
          bases={pullRequestBases(data.branches, githubRemoteName(data.remotes.remotes))}
          defaultTitle={data.commits.find((commit) => commit.hash === data.branches.find((branch) => branch.name === prDialog.head)?.hash)?.subject ?? ''}
          onCreate={(input) => {
            setPrDialog(null)
            void run(t('pr.creating'), () => gitdesk.createPullRequest(path, input)).then((result) => {
              if (!result.ok) return
              setNotice(t('pr.created', { number: result.data.number, url: result.data.url }))
              setPrVersion((version) => version + 1)
            })
          }}
          onClose={() => setPrDialog(null)}
        />
      )}
      {gitflowInit && <GitflowInitDialog state={gitflowInit} onSubmit={saveGitflow} onClose={() => setGitflowInit(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {profilesOpen && (
        <ProfilesDialog
          repo={path}
          onClose={() => {
            setProfilesOpen(false)
            setProfileVersion((version) => version + 1)
          }}
        />
      )}
    </div>
  )
}

/** Branches of the GitHub remote, without the remote's name, for the "merge into" choice. */
const pullRequestBases = (branches: readonly Branch[], remote: string | null): string[] =>
  remote === null
    ? []
    : branches
        .filter((branch) => branch.kind === 'remote' && branch.name.startsWith(`${remote}/`))
        .map((branch) => branch.name.slice(remote.length + 1))
        .filter((name) => name !== 'HEAD')

/** Placeholder rows while the repository loads, so the layout does not jump. */
function GraphSkeleton({ label }: { label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton-bar" style={{ width: 60 + ((i * 37) % 30) }} />
          <span className="skeleton-dot" />
          <span className="skeleton-bar" style={{ width: `${35 + ((i * 53) % 50)}%` }} />
        </div>
      ))}
    </div>
  )
}
