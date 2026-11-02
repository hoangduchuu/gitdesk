import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { Icon } from '../icons'

export interface ConfirmOptions {
  /** Destructive actions get a red button and start with Cancel focused. */
  danger?: boolean
  confirmLabel?: string
}

type Confirm = (message: string, options?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false))

/** Promise-based replacement for window.confirm, styled like the app's other dialogs. */
export const useConfirm = (): Confirm => useContext(ConfirmContext)

interface Pending extends ConfirmOptions {
  message: string
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [pending, setPending] = useState<Pending | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<Confirm>((message, options = {}) => {
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setPending({ message, ...options })
    })
  }, [])

  const settle = (ok: boolean): void => {
    resolver.current?.(ok)
    resolver.current = null
    setPending(null)
  }

  const value = useMemo(() => confirm, [confirm])
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <div className="modal-backdrop" onMouseDown={() => settle(false)}>
          <div
            className="modal confirm-dialog"
            role="alertdialog"
            aria-modal
            aria-labelledby="confirm-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.key === 'Escape' && settle(false)}
          >
            <h2 id="confirm-dialog-title">
              <Icon name={pending.danger ? 'error' : 'info'} size={18} />
              {t('dialog.confirm')}
            </h2>
            <pre className="message-text">{pending.message}</pre>
            <div className="modal-actions">
              <button type="button" className="ghost" autoFocus={pending.danger} onClick={() => settle(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className={pending.danger ? 'danger' : ''} autoFocus={!pending.danger} onClick={() => settle(true)}>
                {pending.confirmLabel ?? t('dialog.confirmOk')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
