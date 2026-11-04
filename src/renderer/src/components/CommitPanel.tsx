import { changeSummary, type ChangeSummary } from '../../../shared/format'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { CommitDetails, DiffTarget } from '../../../shared/model'
import type { Commit } from '../../../shared/types'
import { api } from '../api'
import { useT, localeOf } from '../i18n'
import { useAvatars } from '../hooks/useAvatars'
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
  onFileMenu: (path: string, event: MouseEvent) => void
  onPrompt: (request: PromptRequest) => void
  onCreateBranch: (name: string, hash: string) => void
}

export function CommitPanel({ repo, commit, selectedKey, onOpenDiff, onFileMenu, onPrompt, onCreateBranch }: Props) {
  const t = useT()
  const { language } = useSettings()
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'short', timeStyle: 'short' }), [language])
  const files = useFiles(commit.hash, () => api().getCommitFiles(repo, commit.hash))
  const short = commit.hash.slice(0, 7)
  const [details, setDetails] = useState<CommitDetails | null>(null)
  useEffect(() => {
    let cancelled = false
    setDetails(null)
    api()
      .getCommitDetails(repo, commit.hash)
      .then((result) => !cancelled && result.ok && setDetails(result.data))
      .catch(() => undefined) // the author is already shown from the log; only the committer is missing
    return () => {
      cancelled = true
    }
  }, [repo, commit.hash])

  const sameCommitter =
    details === null || (details.committerEmail === commit.authorEmail && details.committerName === commit.authorName)
  const emails = [commit.authorEmail, ...(details && !sameCommitter ? [details.committerEmail] : [])]
  const pictures = useAvatars(repo, commit.hash, emails)
  const format = (seconds: number): string => dateFormat.format(seconds * 1000)
  // Rebases and amends change the commit date; mention it when it is more than a minute off.
  const recordedLater = details !== null && sameCommitter && Math.abs(details.committerTime - commit.authorTime) >= 60

  return (
    <div className="panel commit-panel">
      <div className="commit-id">
        {t('commit.commitId')} <span className="mono full-hash" title={commit.hash}>{commit.hash}</span>
      </div>
      <section className="commit-message-box">
        <h3 className="commit-subject">{commit.subject}</h3>
        {commit.body && <p className="commit-body">{commit.body}</p>}
      </section>

      {details && details.signature !== 'none' && (
        <p className={`commit-signature signature-${details.signature}`} role="status">
          <Icon name={details.signature === 'bad' ? 'abort' : 'save'} size={14} />
          {t(`commit.signature.${details.signature}`)}
        </p>
      )}

      <section className="commit-people">
        <Person
          role={sameCommitter ? undefined : t('commit.author')}
          name={commit.authorName}
          email={commit.authorEmail}
          date={t('commit.authored', { date: format(commit.authorTime) })}
          picture={pictures[commit.authorEmail]}
        />
        {recordedLater && <div className="muted person-extra">{t('commit.committedAt', { date: format(details.committerTime) })}</div>}
        {details && !sameCommitter && (
          <Person
            role={t('commit.committer')}
            name={details.committerName}
            email={details.committerEmail}
            date={t('commit.committedAt', { date: format(details.committerTime) })}
            picture={pictures[details.committerEmail]}
          />
        )}
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
            onFileMenu={(file, event) => onFileMenu(file.path, event)}
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

interface PersonProps {
  /** "Author" or "Committer"; left out when one person is both. */
  role: string | undefined
  name: string
  email: string
  date: string
  picture: string | null | undefined
}

function Person({ role, name, email, date, picture }: PersonProps) {
  return (
    <div className="person">
      <Avatar name={name} email={email} src={picture} />
      <div className="author-text">
        {role && <div className="person-role muted">{role}</div>}
        <div className="author-name">{name}</div>
        <div className="person-email mono" title={email}>
          {email}
        </div>
        <div className="muted">{date}</div>
      </div>
    </div>
  )
}
