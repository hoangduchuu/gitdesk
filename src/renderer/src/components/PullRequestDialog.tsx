import { useState, type FormEvent } from 'react'
import type { CreatePullRequestInput } from '../../../shared/model'
import { useT } from '../i18n'
import { Icon } from '../icons'

interface Props {
  /** Branch with the changes. */
  head: string
  /** The branch is known not to be on the remote yet (no upstream). */
  notPushed: boolean
  /** Branches the pull request can target (remote branches without the remote name). */
  bases: readonly string[]
  defaultTitle: string
  onCreate: (input: CreatePullRequestInput) => void
  onClose: () => void
}

const PREFERRED_BASES = ['main', 'master', 'develop']

export function PullRequestDialog({ head, notPushed, bases, defaultTitle, onCreate, onClose }: Props) {
  const t = useT()
  const choices = bases.filter((name) => name !== head)
  const [title, setTitle] = useState(defaultTitle)
  const [body, setBody] = useState('')
  const [base, setBase] = useState(PREFERRED_BASES.find((name) => choices.includes(name)) ?? choices[0] ?? 'main')
  const [draft, setDraft] = useState(false)
  const ready = title.trim() !== '' && base !== '' && !notPushed

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (ready) onCreate({ title: title.trim(), body, head, base, draft })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal profile-form"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2>{t('pr.dialogTitle')}</h2>
        <p className="muted">{t('pr.dialogBranches', { head, base: base || '…' })}</p>
        {notPushed && <p className="error">{t('pr.pushFirst', { head })}</p>}
        <label>
          {t('pr.base')}
          {choices.length > 0 ? (
            <select value={base} onChange={(event) => setBase(event.target.value)}>
              {choices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            // No remote branches are known yet (nothing fetched): let the user name the branch.
            <input value={base} spellCheck={false} autoCapitalize="off" onChange={(event) => setBase(event.target.value.trim())} />
          )}
        </label>
        <label>
          {t('pr.titleLabel')}
          <input autoFocus value={title} maxLength={256} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {t('pr.body')}
          <textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
          {t('pr.asDraft')}
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!ready}>
            <Icon name="merge" size={14} />
            {t('pr.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
