import type { DiffTarget, Stash } from '../../../shared/model'
import { useMemo } from 'react'
import { api } from '../api'
import { localeOf, useT } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { FileList } from './FileList'
import { useFiles } from './useFiles'
import { ViewModeToggle } from './ViewModeToggle'
import { Icon } from '../icons'

interface Props {
  repo: string
  stash: Stash
  selectedKey: string | null
  onOpenDiff: (target: DiffTarget, title: string, key: string) => void
  onApply: (stash: Stash) => void
  onPop: (stash: Stash) => void
  onDrop: (stash: Stash) => void
}

export function StashPanel({ repo, stash, selectedKey, onOpenDiff, onApply, onPop, onDrop }: Props) {
  const t = useT()
  const { language } = useSettings()
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(localeOf(language), { dateStyle: 'medium', timeStyle: 'short' }), [language])
  // Keyed by hash: stash@{n} indexes shift when other stashes are added or dropped.
  const files = useFiles(stash.hash, () => api().getStashFiles(repo, stash.ref))

  return (
    <div className="panel stash-panel">
      <section className="commit-meta">
        <span className="ref-badge ref-stash">{stash.ref}</span>
        <h3 className="commit-subject">{stash.message}</h3>
        <p className="muted">{dateFormat.format(stash.time * 1000)}</p>
        <div className="button-row">
          <button type="button" onClick={() => onApply(stash)} title={t('stash.applyKeep')}>
            <Icon name="apply" size={14} />{t('stash.apply')}
          </button>
          <button type="button" onClick={() => onPop(stash)} title={t('stash.applyRemove')}>
            <Icon name="popStash" size={14} />{t('toolbar.pop')}
          </button>
          <button type="button" className="danger" onClick={() => onDrop(stash)}>
            <Icon name="delete" size={14} />{t('stash.drop')}
          </button>
        </div>
      </section>
      <section>
        <h3 className="panel-heading">
          {t('stash.files')}
          <span className="heading-actions">
            <ViewModeToggle />
          </span>
        </h3>
        {files.kind === 'loading' && <p className="file-empty">{t('stash.loading')}</p>}
        {files.kind === 'error' && <p className="error">{files.message}</p>}
        {files.kind === 'ready' && (
          <FileList
            files={files.files.map((file) => ({
              ...file,
              kind: file.untracked ? ('untracked' as const) : file.kind,
              key: `${stash.hash}:${file.untracked ? 'u' : 't'}:${file.path}`
            }))}
            selectedKey={selectedKey}
            onOpen={(file) =>
              onOpenDiff(
                {
                  kind: 'stash',
                  ref: stash.ref,
                  path: file.path,
                  untracked: file.untracked,
                  ...(file.origPath ? { origPath: file.origPath } : {})
                },
                `${file.path} — ${stash.ref}`,
                file.key
              )
            }
          />
        )}
      </section>
    </div>
  )
}
