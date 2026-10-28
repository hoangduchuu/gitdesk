import { useT } from '../i18n'

export interface Choice {
  label: string
  hint: string
  onSelect: () => void
}

export interface ChoiceRequest {
  title: string
  message: string
  /** The first choice is the default and has focus. */
  choices: Choice[]
}

interface Props {
  request: ChoiceRequest
  onClose: () => void
}

/** Modal offering a few ways to go on, e.g. what to do with local changes when switching branch. */
export function ChoiceDialog({ request, onClose }: Props) {
  const t = useT()
  const pick = (choice: Choice): void => {
    onClose()
    choice.onSelect()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal choice-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="choice-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2 id="choice-dialog-title">{request.title}</h2>
        <p>{request.message}</p>
        <div className="choice-list">
          {request.choices.map((choice, index) => (
            <button key={choice.label} type="button" className={index === 0 ? 'choice' : 'choice ghost'} autoFocus={index === 0} onClick={() => pick(choice)}>
              <span className="choice-label">{choice.label}</span>
              <span className="choice-hint">{choice.hint}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
