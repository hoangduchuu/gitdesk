import { useEffect, useRef } from 'react'
import { useT } from '../i18n'
import { Icon } from '../icons'

const AUTO_DISMISS_MS = 6000

/** Non-blocking message for routine results; errors keep using the modal MessageDialog. */
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useT()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const timer = window.setTimeout(() => close.current(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [message])
  return (
    <div className="toast" role="status" aria-live="polite">
      <Icon name="info" size={16} />
      <span className="toast-text">{message}</span>
      <button type="button" className="ghost" onClick={onClose} aria-label={t('common.dismiss')}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
