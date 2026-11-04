import { useEffect, useState, type FormEvent } from 'react'
import type { Profile, ProfileAuthState, ProfileSigning } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { useConfirm } from './ConfirmDialog'
import { Avatar } from './Avatar'
import { Icon } from '../icons'
import { ProfileAuthControls } from './ProfileAuthControls'

interface Props {
  repo: string
  onClose: () => void
}

type Draft = { id?: string; name: string; email: string; signing?: ProfileSigning }
const EMPTY_DRAFT: Draft = { name: '', email: '' }

/** Add, edit and delete commit profiles (name + email). */
export function ProfilesDialog({ repo, onClose }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [auth, setAuth] = useState<ProfileAuthState>({ githubConfigured: false, byProfile: {} })
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    api()
      .getProfiles(repo)
      .then(unwrap)
      .then((state) => setProfiles(state.profiles))
      .catch((failure) => setError(errorMessage(failure)))
    api()
      .getProfileAuth()
      .then(unwrap)
      .then(setAuth)
      .catch((failure) => setError(errorMessage(failure)))
  }
  useEffect(load, [repo])

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const result = await api().saveProfile(repo, draft)
    if (!result.ok) return setError(result.error)
    setError(null)
    setDraft(EMPTY_DRAFT)
    load()
  }

  const remove = async (profile: Profile): Promise<void> => {
    if (!(await confirm(t('profiles.deleteConfirm', { name: profile.name, email: profile.email }), { danger: true }))) {
      return
    }
    const result = await api().deleteProfile(repo, profile.id)
    if (!result.ok) return setError(result.error)
    if (draft.id === profile.id) setDraft(EMPTY_DRAFT)
    load()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal profiles-modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{t('profiles.title')}</h2>
        <p className="muted">{t('profiles.description')}</p>
        <ul className="profile-list">
          {profiles.length === 0 && <li className="muted">{t('profiles.empty')}</li>}
          {profiles.map((profile) => (
            <li key={profile.id} className={`profile-row${draft.id === profile.id ? ' editing' : ''}`}>
              <Avatar name={profile.name} email={profile.email} size={28} />
              <span className="profile-text">
                <span className="author-name">{profile.name}</span>
                <span className="muted">{profile.email}{profile.signing ? ` · ${t('profiles.signed')}` : ''}</span>
              </span>
              <button type="button" className="link" onClick={() => setDraft(profile)}>
                <Icon name="rename" size={14} />{t('common.edit')}
              </button>
              <button type="button" className="link danger" onClick={() => void remove(profile)}>
                <Icon name="delete" size={14} />{t('common.delete')}
              </button>
              <ProfileAuthControls
                profileId={profile.id}
                auth={auth.byProfile[profile.id]}
                githubConfigured={auth.githubConfigured}
                onChanged={load}
              />
            </li>
          ))}
        </ul>
        <form className="profile-form" onSubmit={(event) => void save(event)}>
          <h3>{draft.id ? t('profiles.edit') : t('profiles.add')}</h3>
          <label>
            {t('profiles.name')}
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            {t('profiles.email')}
            <input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.signing !== undefined}
              onChange={(event) => {
                const { signing: _removed, ...rest } = draft
                setDraft(event.target.checked ? { ...rest, signing: { format: 'ssh', key: '' } } : rest)
              }}
            />
            {t('profiles.sign')}
          </label>
          {draft.signing && (
            <>
              <label>
                {t('profiles.signFormat')}
                <select value={draft.signing.format} onChange={(event) => setDraft({ ...draft, signing: { ...draft.signing!, format: event.target.value as ProfileSigning['format'] } })}>
                  <option value="ssh">{t('profiles.signSsh')}</option>
                  <option value="openpgp">{t('profiles.signGpg')}</option>
                </select>
              </label>
              <label>
                {t('profiles.signKey')}
                <input
                  value={draft.signing.key}
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder={draft.signing.format === 'ssh' ? '~/.ssh/id_ed25519.pub' : '3AA5C34371567BD2'}
                  onChange={(event) => setDraft({ ...draft, signing: { ...draft.signing!, key: event.target.value } })}
                />
              </label>
              <p className="muted">{t(draft.signing.format === 'ssh' ? 'profiles.signSshHelp' : 'profiles.signGpgHelp')}</p>
            </>
          )}
          {error && <p className="error-inline">{error}</p>}
          <div className="modal-actions">
            {draft.id && (
              <button type="button" className="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                {t('profiles.cancelEdit')}
              </button>
            )}
            <button type="button" className="ghost" onClick={onClose}>
              <Icon name="close" size={14} />{t('common.close')}
            </button>
            <button type="submit" disabled={draft.name.trim() === '' || draft.email.trim() === '' || (draft.signing !== undefined && draft.signing.key.trim() === '')}>
              <Icon name={draft.id ? 'save' : 'stage'} size={14} />
              {draft.id ? t('common.save') : t('profiles.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
