import { useState, type FormEvent } from 'react'
import type { GitflowConfig, GitflowState } from '../../../shared/model'
import { useT, type MessageKey } from '../i18n'
import { Icon } from '../icons'

interface Props {
  state: GitflowState
  onSubmit: (config: GitflowConfig) => void
  onClose: () => void
}

const FIELDS: ReadonlyArray<[keyof GitflowConfig, MessageKey]> = [
  ['main', 'gitflow.field.main'],
  ['develop', 'gitflow.field.develop'],
  ['feature', 'gitflow.field.feature'],
  ['release', 'gitflow.field.release'],
  ['hotfix', 'gitflow.field.hotfix'],
  ['versionTag', 'gitflow.field.versionTag']
]

/** Branch names and prefixes Git Flow uses in this repository (the same as `git flow init`). */
export function GitflowInitDialog({ state, onSubmit, onClose }: Props) {
  const t = useT()
  const [config, setConfig] = useState<GitflowConfig>(state.config)
  const required = FIELDS.filter(([key]) => key !== 'versionTag').every(([key]) => config[key].trim() !== '')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (required) onSubmit(config)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal profile-form"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2>{state.initialized ? t('gitflow.settingsTitle') : t('gitflow.initTitle')}</h2>
        <p className="muted">{t('gitflow.initDescription')}</p>
        {FIELDS.map(([key, label], index) => (
          <label key={key}>
            {t(label)}
            <input
              autoFocus={index === 0}
              value={config[key]}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => setConfig({ ...config, [key]: event.target.value })}
            />
          </label>
        ))}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!required}>
            <Icon name="gitflow" size={14} />
            {state.initialized ? t('common.save') : t('gitflow.initialize')}
          </button>
        </div>
      </form>
    </div>
  )
}
