import { changeSummary, type ChangeSummary } from '../../../shared/format'
import { useMemo } from 'react'
import type { DiffTarget } from '../../../shared/model'
import type { Commit } from '../../../shared/types'
import { api } from '../api'
import { useT, localeOf } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { Avatar } from './Avatar'
import { ChangeIcon } from './ChangeIcon'
import { FileList } from './FileList'
import type { PromptRequest } from './PromptDialog'
import { RefBadges } from './RefBadges'
import { useFiles } from './useFiles'
import { ViewModeToggle } from './ViewModeToggle'
import { Icon } from '../icons'

const SUMMARY_PARTS: ReadonlyArray<[keyof ChangeSummary, 'commit.modified' | 'commit.added' | 'commit.deleted' | 'commit.renamed']> = [
  ['modified', 'commit.modified'],
  ['added', 'commit.added'],
  ['deleted', 'commit.deleted'],
  ['renamed', 'commit.renamed']
]

interface Props {
  repo: string
  commit: Commit
  selectedKey: string | null
  onOpenDiff: (target: DiffTarget, title: string, key: string) => void
  onPrompt: (request: PromptRequest) => void
  onCreateBranch: (name: string, hash: string) => void
}

export function CommitPanel({ repo, commit, selectedKey, onOpenDiff, onPrompt, onCreateBranch }: Props) {
  const t = useT()
  const { language } = useSettings()
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'short', timeStyle: 'short' }), [language])
  const files = useFiles(commit.hash, () => api().getCommitFiles(repo, commit.hash))
  const short = commit.hash.slice(0, 7)

  return (
    <div className="panel commit-panel">
      <div className="commit-id">
        {t('commit.commitId')} <span className="mono">{short}</span>
      </div>
      <section className="commit-message-box">
        <h3 className="commit-subject">{commit.subject}</h3>
        {commit.body && <p className="commit-body">{commit.body}</p>}
      </section>

      <section className="commit-author">
        <Avatar name={commit.authorName} email={commit.authorEmail} />
        <div className="author-text">
          <div className="author-name">{commit.authorName}</div>
          <div className="muted">{t('commit.authored', { date: dateFormat.format(commit.authorTime * 1000) })}</div>
        </div>
        {commit.parents.length > 0 && (
          <div className="commit-parents muted">
            {t(commit.parents.length > 1 ? 'commit.parents' : 'commit.parent')}{' '}
            <span className="mono">{commit.parents.map((parent) => parent.slice(0, 7)).join(', ')}</span>
          </div>
        )}
      </section>

      <div className="commit-refs">
        <RefBadges refs={commit.refs} />
        <button
          type="button"
          className="ghost small"
          onClick={() =>
            onPrompt({
              title: t('commit.createBranch'),
              label: t('commit.newBranchAt', { hash: short }),
              submitLabel: t('commit.createAndCheckout'),
              onSubmit: (name) => onCreateBranch(name, commit.hash)
            })
          }
        >
          <Icon name="newBranch" size={14} />{t('commit.branchFromHere')}
        </button>
      </div>

      <section>
        <div className="files-header">
          {files.kind === 'ready' && <Summary summary={changeSummary(files.files)} />}
          <ViewModeToggle />
        </div>
        {files.kind === 'loading' && <p className="file-empty">{t('commit.loading')}</p>}
        {files.kind === 'error' && <p className="error">{files.message}</p>}
        {files.kind === 'ready' && (
          <FileList
            files={files.files.map((file) => ({ ...file, key: `${commit.hash}:${file.path}` }))}
            selectedKey={selectedKey}
            empty={t('commit.noFileChanges')}
            onOpen={(file) =>
              onOpenDiff(
                { kind: 'commit', hash: commit.hash, path: file.path, ...(file.origPath ? { origPath: file.origPath } : {}) },
                `${file.path} — ${short}`,
                file.key
              )
            }
          />
        )}
      </section>
    </div>
  )
}

function Summary({ summary }: { summary: ChangeSummary }) {
  const t = useT()
  return (
    <span className="change-summary">
      {SUMMARY_PARTS.filter(([key]) => summary[key]).map(([key, label]) => (
        <span key={key} className={`summary-item summary-${key}`}>
          <ChangeIcon kind={key} />
          {summary[key]} {t(label)}
        </span>
      ))}
    </span>
  )
}
