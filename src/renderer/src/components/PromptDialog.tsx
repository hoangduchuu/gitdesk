import { useState, type FormEvent } from 'react'
import { useT } from '../i18n'

export interface PromptRequest {
  title: string
  label: string
  initial?: string
  submitLabel: string
  /** Optional checkbox, e.g. "Include untracked files". */
  option?: { label: string; initial: boolean }
  /** Allow submitting an empty value (e.g. stash without a message). */
  allowEmpty?: boolean
  onSubmit: (value: string, option: boolean) => void
}

interface Props {
  request: PromptRequest
  onClose: () => void
}

/** Small modal text input; Electron does not implement window.prompt(). */
export function PromptDialog({ request, onClose }: Props) {
  const t = useT()
  const [value, setValue] = useState(request.initial ?? '')
  const [option, setOption] = useState(request.option?.initial ?? false)
  const canSubmit = request.allowEmpty || value.trim() !== ''

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    onClose()
    request.onSubmit(value.trim(), option)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2>{request.title}</h2>
        <label>
          {request.label}
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        {request.option && (
          <label className="checkbox">
            <input type="checkbox" checked={option} onChange={(event) => setOption(event.target.checked)} />
            {request.option.label}
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit}>
            {request.submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
