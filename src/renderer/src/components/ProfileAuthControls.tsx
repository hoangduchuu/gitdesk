import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GithubDeviceLogin, ProfileAuth } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'

interface Props {
  profileId: string
  auth: ProfileAuth | undefined
  /** False when GitHub browser sign-in is not set up in this build. */
  githubConfigured: boolean
  onChanged: () => void
}

type Mode = 'idle' | 'github' | 'token'

/** Connect one profile to GitHub (browser sign-in) or to any git server with an access token. */
export function ProfileAuthControls({ profileId, auth, githubConfigured, onChanged }: Props) {
  const t = useT()
  const [mode, setMode] = useState<Mode>('idle')
  const [login, setLogin] = useState<GithubDeviceLogin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void api().githubLoginCancel() // Closing the dialog abandons a sign-in in progress.
    }
  }, [])

  const signInWithGithub = async (): Promise<void> => {
    setError(null)
    setMode('github')
    try {
      setLogin(unwrap(await api().githubLoginStart()))
      unwrap(await api().githubLoginComplete(profileId))
      if (alive.current) onChanged()
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure))
    } finally {
      if (alive.current) {
        setLogin(null)
        setMode('idle')
      }
    }
  }

  const saveToken = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const result = await api().setProfileToken(profileId, host, username, token)
    if (!result.ok) return setError(result.error)
    setToken('')
    setError(null)
    setMode('idle')
    onChanged()
  }

  const disconnect = async (): Promise<void> => {
    const result = await api().removeProfileAuth(profileId)
    if (!result.ok) return setError(result.error)
    onChanged()
  }

  return (
    <div className="profile-auth">
      {mode === 'idle' && auth && (
        <>
          <span>
            {auth.kind === 'github'
              ? t('auth.github', { login: auth.login })
              : t('auth.tokenAccount', { username: auth.username, host: auth.host })}
          </span>
          <button type="button" className="link danger" onClick={() => void disconnect()}>
            {t('auth.disconnect')}
          </button>
        </>
      )}
      {mode === 'idle' && !auth && (
        <>
          <span className="muted">{t('auth.notConnected')}</span>
          <button type="button" className="link" disabled={!githubConfigured} title={githubConfigured ? '' : t('auth.githubNotConfigured')} onClick={() => void signInWithGithub()}>
            {t('auth.signInGithub')}
          </button>
          <button type="button" className="link" onClick={() => setMode('token')}>
            {t('auth.useToken')}
          </button>
        </>
      )}
      {mode === 'github' && (
        <>
          {login === null ? (
            <span className="muted">{t('auth.starting')}</span>
          ) : (
            <>
              <span>{t('auth.enterCode')}</span>
              <code className="github-user-code">{login.userCode}</code>
              <span className="muted">{t('auth.waiting')}</span>
            </>
          )}
          <button type="button" className="link" onClick={() => void api().githubLoginCancel()}>
            {t('common.cancel')}
          </button>
        </>
      )}
      {mode === 'token' && (
        <form onSubmit={(event) => void saveToken(event)}>
          <input placeholder={t('auth.host')} value={host} onChange={(event) => setHost(event.target.value)} autoCapitalize="off" spellCheck={false} />
          <input placeholder={t('auth.username')} value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="off" spellCheck={false} />
          <input type="password" placeholder={t('auth.token')} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
          <button type="submit" disabled={host.trim() === '' || username.trim() === '' || token === ''}>
            {t('common.save')}
          </button>
          <button type="button" className="ghost" onClick={() => setMode('idle')}>
            {t('common.cancel')}
          </button>
        </form>
      )}
      {error !== null && <span className="error-inline">{error}</span>}
    </div>
  )
}
