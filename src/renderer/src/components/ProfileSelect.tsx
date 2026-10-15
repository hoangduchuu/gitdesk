import { useEffect, useState } from 'react'
import type { ProfileState } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Avatar } from './Avatar'

const GIT_CONFIG = ''
const MANAGE = '__manage__'

interface Props {
  repo: string
  /** Changes whenever profiles may have been edited elsewhere, to reload them. */
  version: number
  onManage: () => void
}

/** "Commit as" picker; the choice is remembered for this repository. */
export function ProfileSelect({ repo, version, onManage }: Props) {
  const t = useT()
  const [state, setState] = useState<ProfileState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    api()
      .getProfiles(repo)
      .then(unwrap)
      .then((next) => {
        setState(next)
        setError(null)
      })
      .catch((failure) => setError(errorMessage(failure)))
  }
  useEffect(load, [repo, version])

  if (error) return <p className="error-inline">{error}</p>
  if (!state) return null

  const selected = state.profiles.find((profile) => profile.id === state.selectedId) ?? null
  const shown = selected ?? { name: state.gitIdentity.name ?? t('profile.unknown'), email: state.gitIdentity.email ?? '' }
  const gitLabel = t('profile.gitConfig', {
    name: state.gitIdentity.name ?? t('profile.nameNotSet'),
    email: state.gitIdentity.email ?? t('profile.emailNotSet')
  })

  const change = async (value: string): Promise<void> => {
    if (value === MANAGE) return onManage()
    const result = await api().setRepoProfile(repo, value === GIT_CONFIG ? null : value)
    if (!result.ok) return setError(result.error)
    load()
  }

  return (
    <label className="profile-select">
      <Avatar name={shown.name} email={shown.email} size={22} />
      <span className="muted">{t('profile.commitAs')}</span>
      <select value={state.selectedId ?? GIT_CONFIG} onChange={(event) => void change(event.target.value)}>
        <option value={GIT_CONFIG}>{gitLabel}</option>
        {state.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} &lt;{profile.email}&gt;
          </option>
        ))}
        <option value={MANAGE}>{t('profile.manage')}</option>
      </select>
    </label>
  )
}
