import { useRef, useState, type MouseEvent } from 'react'
import type { DiffTarget, FileChange, WorkingTreeStatus } from '../../../shared/model'
import { api } from '../api'
import type { RepositoryController } from '../hooks/useRepository'
import { useT, useTCount } from '../i18n'
import { useConfirm } from './ConfirmDialog'
import { FileList, type FileListItem } from './FileList'
import { ProfileSelect } from './ProfileSelect'
import { ViewModeToggle } from './ViewModeToggle'
import { Icon } from '../icons'

interface Props {
  repo: string
  status: WorkingTreeStatus
  controller: RepositoryController
  selectedKey: string | null
  onOpenDiff: (target: DiffTarget, title: string, key: string) => void
  onFileMenu: (path: string, event: MouseEvent) => void
  onOpenConflict: (path: string) => void
  profileVersion: number
  onManageProfiles: () => void
}

const SUBJECT_LIMIT = 72

type ChangeItem = FileListItem & { change: FileChange }

const toItems = (changes: readonly FileChange[], prefix: string): ChangeItem[] =>
  changes.map((change) => ({ ...change, key: `${prefix}:${change.path}`, change }))

export function ChangesPanel(props: Props) {
  const { repo, status, controller, selectedKey, onOpenDiff, onFileMenu, onOpenConflict, profileVersion, onManageProfiles } = props
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  /** Draft typed before amending, and the HEAD message loaded in its place, to undo on uncheck. */
  const amendDraft = useRef<{ draft: string; loaded: string } | null>(null)
  const { run } = controller
  const gitdesk = api()
  const t = useT()
  const confirm = useConfirm()
  const tCount = useTCount()

  const unstaged = toItems(status.unstaged, 'unstaged')
  const staged = toItems(status.staged, 'staged')
  const conflicted = status.conflicted.map((file) => ({ ...file, key: `conflict:${file.path}` }))

  const openWorking = (item: ChangeItem, isStaged: boolean): void =>
    onOpenDiff(
      { kind: 'working', path: item.path, staged: isStaged, untracked: item.kind === 'untracked' },
      `${item.path} — ${t(isStaged ? 'changes.staged' : 'changes.unstaged')}`,
      item.key
    )

  const discardChanges = async (changes: FileChange[]): Promise<void> => {
    const names = changes.map((change) => change.path).join('\n')
    if (!(await confirm(t('changes.discardConfirm', { names }), { danger: true }))) return
    void run(t('changes.discarding'), () => gitdesk.discard(repo, changes))
  }

  const commit = async (): Promise<void> => {
    const result = await run(t(amend ? 'changes.amending' : 'changes.committing'), () => gitdesk.commit(repo, message, amend))
    if (result.ok) {
      setMessage('')
      setAmend(false)
      amendDraft.current = null
    }
  }

  const toggleAmend = async (checked: boolean): Promise<void> => {
    setAmend(checked)
    if (!checked) {
      // Put the draft back only if the loaded message was left untouched.
      const saved = amendDraft.current
      amendDraft.current = null
      if (saved && message === saved.loaded) setMessage(saved.draft)
      return
    }
    try {
      const [head] = await gitdesk.getLog(repo, 1).then((result) => (result.ok ? result.data : []))
      if (!head) return
      const loaded = head.body ? `${head.subject}\n\n${head.body}` : head.subject
      amendDraft.current = { draft: message, loaded }
      setMessage(loaded)
    } catch {
      // No commit to amend yet; leave the message as typed.
    }
  }

  const subjectLength = [...(message.split('\n')[0] ?? '')].length
  /** HEAD is already on the upstream, so amending it needs a force push afterwards. */
  const pushedHead = status.upstream !== null && status.ahead === 0 && !status.unborn

  const canCommit = message.trim() !== '' && (staged.length > 0 || amend) && conflicted.length === 0

  return (
    <div className="panel changes-panel">
      <div className="panel-toolbar">
        <ViewModeToggle />
      </div>
      {conflicted.length > 0 && (
        <section>
          <h3 className="panel-heading conflict-heading">{t('changes.conflicts', { count: conflicted.length })}</h3>
          <FileList files={conflicted} selectedKey={selectedKey} onOpen={(file) => onOpenConflict(file.path)} />
        </section>
      )}

      <section>
        <h3 className="panel-heading">
          {t('changes.unstagedCount', { count: unstaged.length })}
          {unstaged.length > 0 && (
            <span className="heading-actions">
              <button
                type="button"
                className="link danger"
                onClick={() => discardChanges(unstaged.map((item) => item.change))}
              >
                <Icon name="discard" size={14} />{t('changes.discardAll')}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => void run(t('changes.staging'), () => gitdesk.stage(repo, unstaged.map((item) => item.path)))}
              >
                <Icon name="stage" size={14} />{t('changes.stageAll')}
              </button>
            </span>
          )}
        </h3>
        <FileList
          files={unstaged}
          selectedKey={selectedKey}
          empty={t('changes.noUnstagedChanges')}
          onFileMenu={(item, event) => onFileMenu(item.path, event)}
          onOpen={(item) => openWorking(item, false)}
          actions={(item) => (
            <>
              <button type="button" className="link danger" onClick={() => discardChanges([item.change])}>
                <Icon name="discard" size={14} />{t('changes.discard')}
              </button>
              <button type="button" className="link" onClick={() => void run(t('changes.staging'), () => gitdesk.stage(repo, [item.path]))}>
                <Icon name="stage" size={14} />{t('changes.stage')}
              </button>
            </>
          )}
        />
      </section>

      <section>
        <h3 className="panel-heading">
          {t('changes.stagedCount', { count: staged.length })}
          {staged.length > 0 && (
            <span className="heading-actions">
              <button
                type="button"
                className="link"
                onClick={() =>
                  void run(t('changes.unstaging'), () =>
                    gitdesk.unstage(repo, staged.flatMap((item) => [item.path, ...(item.origPath ? [item.origPath] : [])]))
                  )
                }
              >
                <Icon name="unstage" size={14} />{t('changes.unstageAll')}
              </button>
            </span>
          )}
        </h3>
        <FileList
          files={staged}
          selectedKey={selectedKey}
          empty={t('changes.nothingStaged')}
          onFileMenu={(item, event) => onFileMenu(item.path, event)}
          onOpen={(item) => openWorking(item, true)}
          actions={(item) => (
            <button
              type="button"
              className="link"
              onClick={() =>
                void run(t('changes.unstaging'), () => gitdesk.unstage(repo, [item.path, ...(item.origPath ? [item.origPath] : [])]))
              }
            >
              <Icon name="unstage" size={14} />{t('changes.unstage')}
            </button>
          )}
        />
      </section>

      <section className="commit-box">
        <ProfileSelect repo={repo} version={profileVersion} onManage={onManageProfiles} />
        <textarea
          placeholder={t('changes.commitMessage')}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit) void commit()
          }}
        />
        {subjectLength > SUBJECT_LIMIT && (
          <p className="commit-hint warn" role="status">{t('changes.subjectLong', { count: subjectLength, limit: SUBJECT_LIMIT })}</p>
        )}
        {amend && pushedHead && <p className="commit-hint warn" role="status">{t('changes.amendPublished')}</p>}
        <div className="commit-actions">
          <label className="checkbox">
            <input type="checkbox" checked={amend} onChange={(event) => void toggleAmend(event.target.checked)} />
            {t('changes.amendLastCommit')}
          </label>
          <button type="button" disabled={!canCommit} onClick={() => void commit()}>
            <Icon name="commit" size={14} />
            {amend ? t('changes.amend') : staged.length > 0 ? tCount('changes.commitFiles', staged.length) : t('changes.commit')}
          </button>
        </div>
      </section>
    </div>
  )
}
