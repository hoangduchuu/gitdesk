import { useEffect, useRef, useState } from 'react'
import type { UpdateProgress } from '../../../shared/api'
import { formatBytes } from '../../../shared/format'
import type { UpdateInfo } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { localeOf, useT } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { Icon } from '../icons'

/** Version check and one-click update, shown in Settings. */
export function UpdateControls() {
  const t = useT()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState<'check' | 'install' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  const check = (): void => {
    setBusy('check')
    setError(null)
    api().checkForUpdate().then(unwrap).then(setInfo).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(null))
  }
  useEffect(check, [])

  useEffect(() => api().onUpdateProgress(setProgress), [])

  const install = (): void => {
    setBusy('install')
    setError(null)
    setProgress(null)
    api().installUpdate().then(unwrap).catch((failure) => {
      setError(errorMessage(failure))
      setBusy(null)
      setProgress(null)
    })
  }

  return (
    <div className="update-controls">
      {busy === 'install' && <InstallProgress progress={progress} />}
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

/** The download as a bar with the bytes so far; a bar that just moves when the size is not known. */
function InstallProgress({ progress }: { progress: UpdateProgress | null }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  // The update area sits at the bottom of Settings: make sure the bar is in view when the download starts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again when the text line appears and when installing starts
  useEffect(() => box.current?.scrollIntoView({ block: 'nearest' }), [progress === null, progress?.phase])
  const { language } = useSettings()
  const locale = localeOf(language)
  if (progress?.phase === 'installing') {
    return (
      <div className="update-progress" role="status" ref={box}>
        <progress aria-label={t('update.installingNow')} />
        <span className="muted">{t('update.installingNow')}</span>
      </div>
    )
  }
  const received = progress?.received ?? 0
  const total = progress?.total ?? null
  const percent = total === null ? null : Math.min(100, Math.floor((received / total) * 100))
  const label =
    total === null
      ? t('update.downloadingUnknown', { done: formatBytes(received, locale) })
      : t('update.downloading', { done: formatBytes(received, locale), total: formatBytes(total, locale), percent: percent ?? 0 })
  return (
    <div className="update-progress" role="status" aria-live="polite" ref={box}>
      <progress aria-label={t('update.installing')} {...(total === null ? {} : { value: received, max: total })} />
      <span className="muted">{label}</span>
    </div>
  )
}
