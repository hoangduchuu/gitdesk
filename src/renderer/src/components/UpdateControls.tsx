import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'
import { Icon } from '../icons'

/** Version check and one-click update, shown in Settings. */
export function UpdateControls() {
  const t = useT()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState<'check' | 'install' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = (): void => {
    setBusy('check')
    setError(null)
    api().checkForUpdate().then(unwrap).then(setInfo).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(null))
  }
  useEffect(check, [])

  const install = (): void => {
    setBusy('install')
    setError(null)
    api().installUpdate().then(unwrap).catch((failure) => {
      setError(errorMessage(failure))
      setBusy(null)
    })
  }

  return (
    <div className="update-controls">
      {busy === 'install' && <span className="muted">{t('update.installing')}</span>}
      {busy !== 'install' && info?.available && (
        <>
          <span>{t('update.available', { version: info.latest })}</span>
          <button type="button" onClick={install}>
            <Icon name="download" size={14} />
            {t('update.install')}
          </button>
        </>
      )}
      {busy !== 'install' && info && !info.available && <span className="muted">{t('update.upToDate')}</span>}
      {busy === 'check' && <span className="muted">{t('update.checking')}</span>}
      {busy === null && (
        <button type="button" className="ghost" onClick={check}>
          {t('update.check')}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
