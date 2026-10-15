import type { ResetMode } from '../../shared/api'
import type { Branch, MergeOutcome, Stash, Tag, WorkingTreeStatus } from '../../shared/model'
import type { Commit, Result } from '../../shared/types'
import { api } from './api'
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
  openRebase: (base: string) => void
  t: Translate
  tCount: (base: string, count: number, params?: Params) => string
}

const short = (hash: string): string => hash.slice(0, 7)

/** Every git action the UI offers, plus the right-click menus built from them. */
export function createActions(ctx: ActionContext) {
  const { path, controller, status, t, tCount } = ctx
  const { run } = controller
  const gitdesk = api()
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
  const checkout = (branch: Branch): void => {
    void run(t('action.checkout'), () => gitdesk.checkoutBranch(path, branch.name, branch.kind))
  }
  const merge = (name: string): void => {
    if (!window.confirm(t('action.mergeConfirm', { name, current }))) return
    void run(t('action.merging'), () => gitdesk.mergeBranch(path, name)).then(reportMerge)
  }
  const deleteBranch = (name: string): void => {
    if (!window.confirm(t('action.deleteBranchConfirm', { name }))) return
    void run(t('action.deletingBranch'), async () => {
      const result = await gitdesk.deleteBranch(path, name, false)
      if (result.ok || !result.error.includes('not fully merged')) return result
      return window.confirm(t('action.forceDeleteBranchConfirm', { name }))
        ? gitdesk.deleteBranch(path, name, true)
        : { ok: true as const, data: null }
    })
  }
  const deleteRemoteBranch = (name: string): void => {
    if (!window.confirm(t('action.deleteRemoteBranchConfirm', { name }))) return
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
  const cherryPick = (hashes: string[]): void => {
    const what = hashes.length === 1 ? short(hashes[0]!) : tCount('action.commits', hashes.length)
    if (!window.confirm(t('action.cherryPickConfirm', { what, current }))) return
    void run(t('action.cherryPicking'), () => gitdesk.cherryPick(path, hashes)).then(reportMerge)
  }
  const revert = (commit: Commit): void => {
    if (!window.confirm(t('action.revertConfirm', { hash: short(commit.hash), subject: commit.subject }))) return
    void run(t('action.reverting'), () => gitdesk.revertCommit(path, commit.hash)).then(reportMerge)
  }
  const reset = (commit: Commit, mode: ResetMode): void => {
    const warning = mode === 'hard' ? `\n\n${t('action.resetWarning')}` : ''
    if (!window.confirm(t('action.resetConfirm', { current, hash: short(commit.hash), mode, warning }))) return
    void run(t('action.resetting'), () => gitdesk.resetTo(path, commit.hash, mode))
  }
  const checkoutCommit = (commit: Commit): void => {
    if (!window.confirm(t('action.checkoutCommitConfirm', { hash: short(commit.hash) }))) return
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
  const deleteTag = (tag: Tag): void => {
    if (!window.confirm(t('action.deleteTagLocalConfirm', { name: tag.name }))) return
    void run(t('action.deletingTag'), () => gitdesk.deleteTag(path, tag.name))
  }
  const deleteRemoteTag = (tag: Tag): void => {
    if (!window.confirm(t('action.deleteTagRemoteConfirm', { name: tag.name }))) return
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
  const dropStash = (stash: Stash): void => {
    if (!window.confirm(t('action.dropStashConfirm', { ref: stash.ref, message: stash.message }))) return
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

  // ---------- menus ----------
  const commitMenu = (commit: Commit, picked: readonly string[]): MenuItem[] => {
    const many = picked.length > 1 && picked.includes(commit.hash)
    return [
      heading(`${short(commit.hash)} ${commit.subject}`),
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

  const branchMenu = (branch: Branch): MenuItem[] => {
    const isRemote = branch.kind === 'remote'
    return [
      heading(branch.name),
      action(isRemote ? t('menu.checkoutLocalBranch') : t('menu.checkoutBranch', { name: branch.name }), () => checkout(branch), {
        disabled: branch.isHead,
        icon: 'checkout'
      }),
      action(t('menu.mergeBranch', { name: branch.name, current }), () => merge(branch.name), { icon: 'merge', disabled: branch.isHead }),
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
    checkout,
    merge,
    deleteBranch,
    createBranch,
    promptCreateBranch,
    applyStash,
    popStash,
    dropStash,
    promptStash,
    commitMenu,
    branchMenu,
    tagMenu,
    stashMenu
  }
}

export type Actions = ReturnType<typeof createActions>
