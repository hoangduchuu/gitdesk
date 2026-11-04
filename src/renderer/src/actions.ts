import type { ResetMode } from '../../shared/api'
import type { Branch, GitflowKind, GitflowState, MergeOutcome, PullRequest, ReflogEntry, Remote, Stash, Tag, WorkingTreeStatus } from '../../shared/model'
import { maskUrl } from '../../shared/remote-url'
import type { Commit, Result } from '../../shared/types'
import { branchDropActions, type DragBranch } from '../../shared/branch-drag'
import { isPushRejected } from '../../shared/push-error'
import { api } from './api'
import type { ChoiceRequest } from './components/ChoiceDialog'
import { action, heading, separator, type MenuItem } from './components/ContextMenu'
import type { PromptRequest } from './components/PromptDialog'
import type { RepositoryController } from './hooks/useRepository'
import type { Params, Translate } from './i18n'

export interface ActionContext {
  path: string
  controller: RepositoryController
  status: WorkingTreeStatus | null
  onConflicts: () => void
  onSelectionGone: () => void
  prompt: (request: PromptRequest) => void
  choose: (request: ChoiceRequest) => void
  confirm: (message: string, options?: { danger?: boolean }) => Promise<boolean>
  openRebase: (base: string) => void
  /** Show the commits that changed a file in the centre panel. */
  openFileHistory: (path: string) => void
  /** Show who last changed each line of a file in the centre panel. */
  openBlame: (path: string) => void
  /** Show the dialog that opens a pull request from this branch. */
  openPullRequestDialog: (head: string) => void
  /** A remote is on github.com, so branches can offer "Create pull request". */
  canPullRequest: boolean
  /** Show the dialog for the Git Flow branch names and prefixes. */
  openGitflowInit: (state: GitflowState) => void
  t: Translate
  tCount: (base: string, count: number, params?: Params) => string
}

const short = (hash: string): string => hash.slice(0, 7)

/** git's refusal when switching would overwrite local changes (`git switch` says checkout too). */
const OVERWRITTEN_BY_CHECKOUT = 'would be overwritten by checkout'

/** Every git action the UI offers, plus the right-click menus built from them. */
export function createActions(ctx: ActionContext) {
  const { path, controller, status, t, tCount } = ctx
  const { run } = controller
  const gitdesk = api()
  const confirm = ctx.confirm
  const current = status?.branch ?? 'HEAD'

  const reportMerge = (result: Result<MergeOutcome>): void => {
    if (result.ok && result.data.conflicts) {
      controller.setNotice(t('action.conflictNotice'))
      ctx.onConflicts()
    }
  }

  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => controller.setNotice(t('action.copied', { what })),
      () => controller.setError(t('action.copyFailed', { what }))
    )
  }

  // ---------- branches ----------
  /** Stash local changes, then switch; `bring` reapplies them on the new branch. */
  const checkoutWithStash = (branch: Branch, bring: boolean): void => {
    void run(t('action.checkout'), async (): Promise<Result<unknown>> => {
      const stashed = await gitdesk.stashPush(path, t('action.leftChangesStash', { current }), true)
      if (!stashed.ok) return stashed
      const switched = await gitdesk.checkoutBranch(path, branch.name, branch.kind)
      if (!switched.ok || !bring) return switched
      const popped = await gitdesk.stashPop(path, 'stash@{0}')
      reportMerge(popped)
      return popped
    })
  }
  // Like GitHub Desktop: changes git can carry over just come along; otherwise ask what to do with them.
  const checkout = (branch: Branch): void => {
    void run(t('action.checkout'), () => gitdesk.checkoutBranch(path, branch.name, branch.kind), {
      showError: (error) => !error.includes(OVERWRITTEN_BY_CHECKOUT)
    }).then((result) => {
      if (result.ok || !result.error.includes(OVERWRITTEN_BY_CHECKOUT)) return
      const name = branch.name
      ctx.choose({
        title: t('action.checkoutBlockedTitle', { name }),
        message: t('action.checkoutBlocked', { current, name }),
        choices: [
          { label: t('action.leaveChanges', { current }), hint: t('action.leaveChangesHint'), onSelect: () => checkoutWithStash(branch, false) },
          { label: t('action.bringChanges', { name }), hint: t('action.bringChangesHint'), onSelect: () => checkoutWithStash(branch, true) }
        ]
      })
    })
  }
  const merge = async (name: string): Promise<void> => {
    if (!(await confirm(t('action.mergeConfirm', { name, current })))) return
    void run(t('action.merging'), () => gitdesk.mergeBranch(path, name)).then(reportMerge)
  }
  const deleteBranch = async (name: string): Promise<void> => {
    if (!(await confirm(t('action.deleteBranchConfirm', { name }), { danger: true }))) return
    void run(t('action.deletingBranch'), async () => {
      const result = await gitdesk.deleteBranch(path, name, false)
      if (result.ok || !result.error.includes('not fully merged')) return result
      return (await confirm(t('action.forceDeleteBranchConfirm', { name }), { danger: true }))
        ? gitdesk.deleteBranch(path, name, true)
        : { ok: true as const, data: null }
    })
  }
  const deleteRemoteBranch = async (name: string): Promise<void> => {
    if (!(await confirm(t('action.deleteRemoteBranchConfirm', { name }), { danger: true }))) return
    void run(t('action.deletingRemoteBranch'), () => gitdesk.deleteRemoteBranch(path, name))
  }
  const createBranch = (name: string, at: string | null): void => {
    void run(t('action.creatingBranch'), () => gitdesk.createBranch(path, name, at, true))
  }
  const promptCreateBranch = (at: string | null): void =>
    ctx.prompt({
      title: t('action.createBranch'),
      label: at ? t('action.newBranchAt', { hash: short(at) }) : t('action.newBranchFrom', { branch: current }),
      submitLabel: t('action.createAndCheckout'),
      onSubmit: (name) => createBranch(name, at)
    })
  const promptRename = (name: string): void =>
    ctx.prompt({
      title: t('action.renameBranch'),
      label: t('action.newNameFor', { name }),
      initial: name,
      submitLabel: t('action.rename'),
      onSubmit: (to) => void run(t('action.renamingBranch'), () => gitdesk.renameBranch(path, name, to))
    })

  // ---------- commits ----------
  const cherryPick = async (hashes: string[]): Promise<void> => {
    const what = hashes.length === 1 ? short(hashes[0]!) : tCount('action.commits', hashes.length)
    if (!(await confirm(t('action.cherryPickConfirm', { what, current })))) return
    void run(t('action.cherryPicking'), () => gitdesk.cherryPick(path, hashes)).then(reportMerge)
  }
  const revert = async (commit: Commit): Promise<void> => {
    if (!(await confirm(t('action.revertConfirm', { hash: short(commit.hash), subject: commit.subject })))) return
    void run(t('action.reverting'), () => gitdesk.revertCommit(path, commit.hash)).then(reportMerge)
  }
  const reset = async (commit: Pick<Commit, 'hash'>, mode: ResetMode): Promise<void> => {
    const warning = mode === 'hard' ? `\n\n${t('action.resetWarning')}` : ''
    if (!(await confirm(t('action.resetConfirm', { current, hash: short(commit.hash), mode, warning }), { danger: true }))) return
    void run(t('action.resetting'), () => gitdesk.resetTo(path, commit.hash, mode))
  }
  const undoLast = async (entry: ReflogEntry): Promise<void> => {
    if (!(await confirm(t('action.undoConfirm', { action: entry.action })))) return
    void run(t('action.undoing'), () => gitdesk.undoLastAction(path))
  }
  const checkoutCommit = async (commit: Pick<Commit, 'hash'>): Promise<void> => {
    if (!(await confirm(t('action.checkoutCommitConfirm', { hash: short(commit.hash) })))) return
    void run(t('action.checkout'), () => gitdesk.checkoutCommit(path, commit.hash))
  }

  // ---------- tags ----------
  const promptTag = (commit: Commit, annotated: boolean): void =>
    ctx.prompt({
      title: annotated ? t('action.createAnnotatedTag') : t('action.createTag'),
      label: t('action.tagNameAt', { hash: short(commit.hash) }),
      submitLabel: t('action.createTag'),
      onSubmit: (name) => {
        if (!annotated) {
          void run(t('action.tagging'), () => gitdesk.createTag(path, name, commit.hash, null))
          return
        }
        ctx.prompt({
          title: t('action.annotate', { name }),
          label: t('action.message'),
          submitLabel: t('action.createTag'),
          onSubmit: (message) => void run(t('action.tagging'), () => gitdesk.createTag(path, name, commit.hash, message))
        })
      }
    })
  const pushTag = (tag: Tag): void => void run(t('action.pushingTag'), () => gitdesk.pushTag(path, tag.name))
  const deleteTag = async (tag: Tag): Promise<void> => {
    if (!(await confirm(t('action.deleteTagLocalConfirm', { name: tag.name }), { danger: true }))) return
    void run(t('action.deletingTag'), () => gitdesk.deleteTag(path, tag.name))
  }
  const deleteRemoteTag = async (tag: Tag): Promise<void> => {
    if (!(await confirm(t('action.deleteTagRemoteConfirm', { name: tag.name }), { danger: true }))) return
    void run(t('action.deletingRemoteTag'), () => gitdesk.deleteRemoteTag(path, tag.name))
  }

  // ---------- stashes ----------
  const applyStash = (stash: Stash): void => {
    void run(t('action.applyingStash'), () => gitdesk.stashApply(path, stash.ref)).then(reportMerge)
  }
  const popStash = (stash: Stash): void => {
    void run(t('action.poppingStash'), () => gitdesk.stashPop(path, stash.ref)).then((result) => {
      reportMerge(result)
      if (result.ok && !result.data.conflicts) ctx.onSelectionGone()
    })
  }
  const dropStash = async (stash: Stash): Promise<void> => {
    if (!(await confirm(t('action.dropStashConfirm', { ref: stash.ref, message: stash.message }), { danger: true }))) return
    void run(t('action.droppingStash'), () => gitdesk.stashDrop(path, stash.ref)).then((result) => {
      if (result.ok) ctx.onSelectionGone()
    })
  }
  const promptStash = (): void =>
    ctx.prompt({
      title: t('action.stashChanges'),
      label: t('action.messageOptional'),
      submitLabel: t('toolbar.stash'),
      allowEmpty: true,
      option: { label: t('action.includeUntracked'), initial: true },
      onSubmit: (message, includeUntracked) =>
        void run(t('action.stashing'), () => gitdesk.stashPush(path, message, includeUntracked)).then((result) => {
          if (result.ok) ctx.onSelectionGone()
        })
    })

  // ---------- push and pull ----------
  const pull = (): void => {
    void run(t('app.pulling'), () => gitdesk.pull(path)).then(reportMerge)
  }
  const forcePush = (): void => {
    void run(t('app.forcePushing'), () => gitdesk.push(path, true))
  }
  /** Force push after the user agreed; used by menus, where nothing else has asked yet. */
  const confirmForcePush = async (): Promise<void> => {
    if ((await confirm(t('action.forcePushConfirm', { branch: current }), { danger: true }))) forcePush()
  }
  /** Push; when git refuses because history diverged, offer to pull first or to force push. */
  const push = (): void => {
    void run(t('app.pushing'), () => gitdesk.push(path, false), { showError: (error) => !isPushRejected(error) }).then((result) => {
      if (result.ok || !isPushRejected(result.error)) return
      ctx.choose({
        title: t('action.pushRejectedTitle'),
        message: t('action.pushRejected', { branch: current }),
        choices: [
          { label: t('action.pullFirst'), hint: t('action.pullFirstHint'), onSelect: pull },
          { label: t('action.forcePush'), hint: t('action.forcePushHint'), onSelect: forcePush }
        ]
      })
    })
  }

  // ---------- commit message ----------
  const promptReword = (commit: Commit): void =>
    ctx.prompt({
      title: t('action.editMessage', { hash: short(commit.hash) }),
      label: t('action.commitMessage'),
      initial: commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject,
      multiline: true,
      submitLabel: t('action.saveMessage'),
      onSubmit: (message) =>
        void run(t('action.rewording'), () => gitdesk.rewordCommit(path, commit.hash, message)).then((result) => {
          if (!result.ok) return
          ctx.onSelectionGone() // the commit has a new hash now
          reportMerge(result)
          if (result.data.conflicts || !result.data.published || !status?.upstream) return
          ctx.choose({
            title: t('action.rewrittenTitle'),
            message: t('action.rewrittenPublished'),
            choices: [
              { label: t('action.leaveLocal'), hint: t('action.leaveLocalHint'), onSelect: () => undefined },
              { label: t('action.forcePush'), hint: t('action.forcePushHint'), onSelect: forcePush }
            ]
          })
        })
    })

  // ---------- remotes ----------
  const promptAddRemote = (): void =>
    ctx.prompt({
      title: t('action.addRemote'),
      label: t('action.remoteName'),
      initial: 'origin',
      submitLabel: t('action.addRemote'),
      onSubmit: (name) =>
        ctx.prompt({
          title: t('action.addRemoteUrl', { name }),
          label: t('action.remoteUrl'),
          submitLabel: t('action.addRemote'),
          onSubmit: (url) => void run(t('action.addingRemote'), () => gitdesk.addRemote(path, name, url))
        })
    })
  const promptRemoteUrl = (remote: Remote): void =>
    ctx.prompt({
      title: t('action.changeRemoteUrl', { name: remote.name }),
      label: t('action.remoteUrl'),
      initial: remote.fetchUrl,
      submitLabel: t('action.changeUrl'),
      onSubmit: (url) => void run(t('action.changingRemoteUrl'), () => gitdesk.setRemoteUrl(path, remote.name, url))
    })
  const removeRemote = async (remote: Remote): Promise<void> => {
    if (!(await confirm(t('action.removeRemoteConfirm', { name: remote.name, url: maskUrl(remote.fetchUrl) }), { danger: true }))) return
    void run(t('action.removingRemote'), () => gitdesk.removeRemote(path, remote.name))
  }
  const remoteMenu = (remote: Remote): MenuItem[] => [
    heading(remote.name),
    action(t('menu.changeRemoteUrl'), () => promptRemoteUrl(remote), { icon: 'rename' }),
    action(t('menu.copyRemoteUrl'), () => copy(remote.fetchUrl, t('copy.remoteUrl')), { icon: 'copy' }),
    separator,
    action(t('menu.removeRemote', { name: remote.name }), () => removeRemote(remote), { icon: 'delete', danger: true })
  ]

  // ---------- pull requests ----------
  const pullRequestMenu = (pr: PullRequest): MenuItem[] => [
    heading(`#${pr.number} ${pr.title}`),
    action(t('pr.openInBrowser'), () => void window.open(pr.url), { icon: 'link' }),
    action(t('pr.checkout', { branch: `pr-${pr.number}` }), () => void run(t('pr.checkingOut'), () => gitdesk.checkoutPullRequest(path, pr.number)), { icon: 'checkout' }),
    action(t('menu.copyPrLink'), () => copy(pr.url, t('copy.prLink')), { icon: 'copy' })
  ]

  // ---------- drag and drop ----------
  /** The menu shown when a branch is dropped on another: merge it in, or rebase it on top. */
  const branchDropMenu = (source: DragBranch, target: DragBranch, branches: readonly Branch[]): MenuItem[] => {
    const params = { source: source.name, target: target.name }
    const merge = async (): Promise<void> => {
      void run(t('action.merging'), () => gitdesk.mergeBranchInto(path, source.name, target.name)).then(reportMerge)
    }
    const rebase = async (): Promise<void> => {
      // Rewriting commits that were already pushed makes the next push fail without a force push.
      const published = branches.some((branch) => branch.kind === 'local' && branch.name === source.name && branch.upstream !== null)
      if (published && !(await confirm(t('dnd.rebasePublishedConfirm', { name: source.name }), { danger: true }))) return
      void run(t('app.rebasing'), () => gitdesk.rebaseBranch(path, source.name, target.name)).then(reportMerge)
    }
    return [
      heading(`${source.name} → ${target.name}`),
      ...branchDropActions(source, target).map((kind) =>
        kind === 'merge'
          ? action(t('dnd.merge', params), merge, { icon: 'merge' })
          : action(t('dnd.rebase', params), rebase, { icon: 'rebase' })
      )
    ]
  }

  // ---------- git flow ----------
  const baseOf = (kind: GitflowKind, state: GitflowState): string => (kind === 'hotfix' ? state.config.main : state.config.develop)

  const promptStartGitflow = (kind: GitflowKind, state: GitflowState): void =>
    ctx.prompt({
      title: t('gitflow.startTitle', { kind: t(`gitflow.kind.${kind}`) }),
      label: t('gitflow.nameLabel', { prefix: state.config[kind], base: baseOf(kind, state) }),
      submitLabel: t('gitflow.startSubmit'),
      onSubmit: (name) => void run(t('gitflow.starting'), () => gitdesk.startGitflow(path, kind, name))
    })

  const finishGitflow = (kind: GitflowKind, name: string, deleteBranch: boolean, tagMessage: string | null): void => {
    void run(t('gitflow.finishing'), () => gitdesk.finishGitflow(path, kind, name, deleteBranch, tagMessage)).then((result) => {
      if (!result.ok || !result.data.conflicts) return
      controller.setNotice(t('gitflow.conflictNotice'))
      ctx.onConflicts()
    })
  }

  const promptFinishGitflow = (kind: GitflowKind, name: string, state: GitflowState): void => {
    const branch = `${state.config[kind]}${name}`
    const kindLabel = t(`gitflow.kind.${kind}`)
    if (kind === 'feature') {
      const develop = state.config.develop
      ctx.choose({
        title: t('gitflow.finishTitle', { kind: kindLabel, name }),
        message: t('gitflow.finishFeatureMessage', { branch, develop }),
        choices: [
          { label: t('gitflow.finishDelete', { branch }), hint: t('gitflow.finishDeleteHint', { develop }), onSelect: () => finishGitflow(kind, name, true, null) },
          { label: t('gitflow.finishKeep', { branch }), hint: t('gitflow.finishKeepHint', { develop }), onSelect: () => finishGitflow(kind, name, false, null) }
        ]
      })
      return
    }
    const tag = `${state.config.versionTag}${name}`
    ctx.prompt({
      title: t('gitflow.finishTitle', { kind: kindLabel, name }),
      label: t('gitflow.tagMessage', { tag, main: state.config.main }),
      initial: `${kindLabel} ${name}`,
      allowEmpty: true,
      option: { label: t('gitflow.deleteBranch', { branch }), initial: true },
      submitLabel: t('gitflow.finishSubmit'),
      onSubmit: (message, deleteBranch) => finishGitflow(kind, name, deleteBranch, message === '' ? null : message)
    })
  }

  /** The toolbar's Git Flow menu: set up, start, and finish whatever is in progress. */
  const gitflowMenu = (state: GitflowState): MenuItem[] => {
    if (!state.initialized) {
      return [
        heading(t('gitflow.title')),
        heading(t('gitflow.notInitialized')),
        action(t('gitflow.initialize') + '…', () => ctx.openGitflowInit(state), { icon: 'gitflow' })
      ]
    }
    const kinds: GitflowKind[] = ['feature', 'release', 'hotfix']
    const inProgress = kinds.flatMap((kind) => state.open[kind].map((name) => ({ kind, name })))
    return [
      heading(t('gitflow.title')),
      ...kinds.map((kind) =>
        action(t('gitflow.start', { kind: t(`gitflow.kind.${kind}`) }), () => promptStartGitflow(kind, state), {
          icon: 'newBranch',
          // Like git-flow: one release and one hotfix at a time.
          disabled: kind !== 'feature' && state.open[kind].length > 0
        })
      ),
      ...(inProgress.length > 0
        ? [
            separator,
            heading(t('gitflow.inProgress')),
            ...inProgress.map(({ kind, name }) =>
              action(t('gitflow.finish', { kind: t(`gitflow.kind.${kind}`), name }), () => promptFinishGitflow(kind, name, state), {
                icon: 'merge'
              })
            )
          ]
        : []),
      separator,
      action(t('gitflow.settings'), () => ctx.openGitflowInit(state), { icon: 'settings' })
    ]
  }

  // ---------- menus ----------
  const commitMenu = (commit: Commit, picked: readonly string[]): MenuItem[] => {
    const many = picked.length > 1 && picked.includes(commit.hash)
    return [
      heading(`${short(commit.hash)} ${commit.subject}`),
      action(t('menu.editMessage'), () => promptReword(commit), { icon: 'rename', disabled: many }),
      many
        ? action(t('menu.cherryPickCommits', { count: picked.length }), () => cherryPick([...picked]), { icon: 'cherryPick' })
        : action(t('menu.cherryPickCommit'), () => cherryPick([commit.hash]), { icon: 'cherryPick' }),
      action(t('menu.revertCommit'), () => revert(commit), { icon: 'revert' }),
      separator,
      action(t('menu.createBranchHere'), () => promptCreateBranch(commit.hash), { icon: 'newBranch' }),
      action(t('menu.createTagHere'), () => promptTag(commit, false), { icon: 'tag' }),
      action(t('menu.createAnnotatedTagHere'), () => promptTag(commit, true), { icon: 'annotatedTag' }),
      action(t('menu.checkoutCommit'), () => checkoutCommit(commit), { icon: 'commit' }),
      separator,
      heading(t('menu.resetToCommit', { branch: current })),
      ...(['soft', 'mixed', 'hard'] as const).map((mode) => action(t(`menu.reset${mode[0]!.toUpperCase()}${mode.slice(1)}` as 'menu.resetSoft' | 'menu.resetMixed' | 'menu.resetHard'), () => reset(commit, mode), { danger: mode === 'hard', icon: 'reset' })),
      separator,
      action(t('menu.interactiveRebase', { branch: current }), () => ctx.openRebase(commit.hash), { icon: 'rebase' }),
      separator,
      action(t('menu.copyCommitSha'), () => copy(commit.hash, t('copy.commitSha')), { icon: 'copy' })
    ]
  }

  /** Right-click on a file in the changes or commit panels. */
  const fileMenu = (filePath: string): MenuItem[] => [
    heading(filePath),
    action(t('menu.fileHistory'), () => ctx.openFileHistory(filePath), { icon: 'reflog' }),
    action(t('menu.blame'), () => ctx.openBlame(filePath), { icon: 'user' }),
    action(t('menu.copyPath'), () => copy(filePath, t('copy.filePath')), { icon: 'copy' })
  ]

  /** Right-click on a reflog row: ways back to that state, without touching the entry itself. */
  const reflogMenu = (entry: ReflogEntry): MenuItem[] => [
    heading(`${short(entry.hash)} ${entry.selector}`),
    action(t('menu.checkoutCommit'), () => checkoutCommit(entry), { icon: 'commit' }),
    action(t('menu.createBranchHere'), () => promptCreateBranch(entry.hash), { icon: 'newBranch' }),
    separator,
    heading(t('menu.resetToCommit', { branch: current })),
    ...(['soft', 'mixed', 'hard'] as const).map((mode) => action(t(`menu.reset${mode[0]!.toUpperCase()}${mode.slice(1)}` as 'menu.resetSoft' | 'menu.resetMixed' | 'menu.resetHard'), () => reset(entry, mode), { danger: mode === 'hard', icon: 'reset' })),
    separator,
    action(t('menu.copyCommitSha'), () => copy(entry.hash, t('copy.commitSha')), { icon: 'copy' })
  ]

  const branchMenu = (branch: Branch): MenuItem[] => {
    const isRemote = branch.kind === 'remote'
    return [
      heading(branch.name),
      action(isRemote ? t('menu.checkoutLocalBranch') : t('menu.checkoutBranch', { name: branch.name }), () => checkout(branch), {
        disabled: branch.isHead,
        icon: 'checkout'
      }),
      action(t('menu.mergeBranch', { name: branch.name, current }), () => merge(branch.name), { icon: 'merge', disabled: branch.isHead }),
      ...(!isRemote && branch.isHead && branch.upstream !== null
        ? [action(t('menu.forcePushBranch', { name: branch.name }), confirmForcePush, { icon: 'upload', danger: true })]
        : []),
      ...(isRemote
        ? [separator, action(t('menu.deleteRemoteBranch', { name: branch.name }), () => deleteRemoteBranch(branch.name), { icon: 'deleteRemote', danger: true })]
        : [
            separator,
            action(t('menu.renameBranch', { name: branch.name }), () => promptRename(branch.name), { icon: 'rename' }),
            action(t('menu.deleteBranch', { name: branch.name }), () => deleteBranch(branch.name), { icon: 'delete', danger: true, disabled: branch.isHead }),
            ...(branch.upstream
              ? [action(t('menu.deleteRemoteBranch', { name: branch.upstream }), () => deleteRemoteBranch(branch.upstream!), { icon: 'deleteRemote', danger: true })]
              : [])
          ]),
      ...(!isRemote && ctx.canPullRequest
        ? [separator, action(t('pr.createFrom', { name: branch.name }), () => ctx.openPullRequestDialog(branch.name), { icon: 'merge' })]
        : []),
      separator,
      action(t('menu.copyBranchName'), () => copy(branch.name, t('copy.branchName')), { icon: 'copy' })
    ]
  }

  const tagMenu = (tag: Tag): MenuItem[] => [
    heading(tag.name),
    action(t('menu.pushTag'), () => pushTag(tag), { icon: 'upload' }),
    separator,
    action(t('menu.deleteTagLocal', { name: tag.name }), () => deleteTag(tag), { icon: 'delete', danger: true }),
    action(t('menu.deleteTagRemote', { name: tag.name }), () => deleteRemoteTag(tag), { icon: 'deleteRemote', danger: true }),
    separator,
    action(t('menu.copyTagName'), () => copy(tag.name, t('copy.tagName')), { icon: 'copy' })
  ]

  const stashMenu = (stash: Stash): MenuItem[] => [
    heading(`${stash.ref} ${stash.message}`),
    action(t('menu.applyStash'), () => applyStash(stash), { icon: 'apply' }),
    action(t('menu.popStash'), () => popStash(stash), { icon: 'popStash' }),
    separator,
    action(t('menu.deleteStash'), () => dropStash(stash), { icon: 'delete', danger: true })
  ]

  return {
    reportMerge,
    pull,
    push,
    confirmForcePush,
    checkout,
    merge,
    deleteBranch,
    createBranch,
    promptCreateBranch,
    applyStash,
    popStash,
    dropStash,
    promptStash,
    promptAddRemote,
    remoteMenu,
    gitflowMenu,
    branchDropMenu,
    commitMenu,
    pullRequestMenu,
    undoLast,
    fileMenu,
    reflogMenu,
    branchMenu,
    tagMenu,
    stashMenu
  }
}

export type Actions = ReturnType<typeof createActions>
