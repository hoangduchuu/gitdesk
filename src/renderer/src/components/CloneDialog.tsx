import { useEffect, useState, type FormEvent } from 'react'
import type { CloneProfile } from '../../../shared/api'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Icon } from '../icons'

interface Props {
  /** Runs the clone (folder dialog included); resolves when done. Throws to show an error here. */
  onClone: (url: string, profileId: string | null) => Promise<void>
  onClose: () => void
}

/** Clone a public repository, or a private one through a connected profile. */
export function CloneDialog({ onClone, onClose }: Props) {
  const t = useT()
  const [url, setUrl] = useState('')
  const [profiles, setProfiles] = useState<CloneProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api().getCloneProfiles().then(unwrap).then(setProfiles).catch((failure) => setError(errorMessage(failure)))
  }, [])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (url.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onClone(url.trim(), profileId === '' ? null : profileId)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <form
        className="modal profile-form"
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && !busy && onClose()}
      >
        <h2>{t('clone.title')}</h2>
        <label>
          {t('clone.url')}
          <input
            autoFocus
            value={url}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            placeholder="https://github.com/owner/repo.git"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          {t('clone.profile')}
          <select value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">{t('clone.public')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} — {profile.connection}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{t('clone.hint')}</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy || url.trim() === ''}>
            <Icon name="download" size={14} />
            {busy ? t('clone.cloning') : t('clone.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
