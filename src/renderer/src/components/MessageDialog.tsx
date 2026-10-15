import { useT } from '../i18n'
import { Icon } from '../icons'

interface Props {
  kind: 'error' | 'notice'
  message: string
  onClose: () => void
}

/** Modal for an operation's error or notice; git's own text is kept as written. */
export function MessageDialog({ kind, message, onClose }: Props) {
  const t = useT()
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal message-dialog ${kind}`}
        role={kind === 'error' ? 'alertdialog' : 'dialog'}
        aria-modal
        aria-labelledby="message-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2 id="message-dialog-title">
          <Icon name={kind === 'error' ? 'error' : 'info'} size={18} />
          {t(kind === 'error' ? 'dialog.error' : 'dialog.notice')}
        </h2>
        <pre className="message-text">{message}</pre>
        <div className="modal-actions">
          <button type="button" autoFocus onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
