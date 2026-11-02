import { useState, type FormEvent } from 'react'
import type { GitProvider, PublishInput, RemoteState } from '../../../shared/model'
import { guessProvider } from '../../../shared/remote-url'
import { useT, type MessageKey } from '../i18n'
import { Icon } from '../icons'

interface Props {
  /** Suggested repository name (the folder's name). */
  defaultName: string
  state: RemoteState
  onCreate: (input: PublishInput) => void
  onUseUrl: (remote: string, url: string) => void
  onClose: () => void
}

const PROVIDERS: ReadonlyArray<[GitProvider, MessageKey]> = [
  ['github', 'publish.provider.github'],
  ['gitlab', 'publish.provider.gitlab'],
  ['gitea', 'publish.provider.gitea']
]

const slug = (name: string): string => name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '')

/** Push a repository that has no remote yet: create it on GitHub, GitLab or Gitea, or point at one that exists. */
export function PublishDialog({ defaultName, state, onCreate, onUseUrl, onClose }: Props) {
  const t = useT()
  const { connection } = state
  const [mode, setMode] = useState<'create' | 'url'>(connection ? 'create' : 'url')
  const [provider, setProvider] = useState<GitProvider>(connection ? guessProvider(connection) : 'github')
  const [name, setName] = useState(slug(defaultName))
  const [description, setDescription] = useState('')
  const [isPrivate, setPrivate] = useState(true)
  const [remote, setRemote] = useState('origin')
  const [url, setUrl] = useState('')

  const where =
    connection === null
      ? ''
      : connection.kind === 'github'
        ? `GitHub (@${connection.login})`
        : `${connection.host} (${connection.username})`
  // GitHub always lives at github.com; the others at the host the profile is connected to.
  const providerChoices = connection?.kind === 'token' && guessProvider(connection) !== 'github' ? PROVIDERS.filter(([value]) => value !== 'github') : PROVIDERS
  const ready = remote.trim() !== '' && (mode === 'create' ? name.trim() !== '' : url.trim() !== '')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!ready) return
    if (mode === 'create') onCreate({ remote: remote.trim(), provider, name: name.trim(), description: description.trim(), private: isPrivate })
    else onUseUrl(remote.trim(), url.trim())
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal profile-form"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <h2>{t('publish.title')}</h2>
        <p className="muted">{t('publish.description')}</p>

        <label className="checkbox">
          <input type="radio" name="publish-mode" checked={mode === 'create'} disabled={connection === null} onChange={() => setMode('create')} />
          {connection ? t('publish.modeCreate', { where }) : t('publish.modeCreateOff')}
        </label>
        {connection === null && (
          <p className="muted publish-hint">{state.profileName ? t('publish.connectProfile', { name: state.profileName }) : t('publish.chooseProfile')}</p>
        )}
        <label className="checkbox">
          <input type="radio" name="publish-mode" checked={mode === 'url'} onChange={() => setMode('url')} />
          {t('publish.modeUrl')}
        </label>

        {mode === 'create' && (
          <>
            {providerChoices.length > 1 && connection?.kind === 'token' && (
              <label>
                {t('publish.provider')}
                <select value={provider} onChange={(event) => setProvider(event.target.value as GitProvider)}>
                  {providerChoices.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t('publish.name')}
              <input autoFocus value={name} spellCheck={false} autoCapitalize="off" onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              {t('publish.descriptionLabel')}
              <input value={description} maxLength={350} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} />
              {t('publish.private')}
            </label>
            {!isPrivate && <p className="muted publish-hint">{t('publish.publicWarning')}</p>}
          </>
        )}
        {mode === 'url' && (
          <label>
            {t('publish.url')}
            <input autoFocus value={url} spellCheck={false} autoCapitalize="off" placeholder="https://github.com/you/repo.git" onChange={(event) => setUrl(event.target.value)} />
          </label>
        )}
        <label>
          {t('publish.remoteName')}
          <input value={remote} spellCheck={false} autoCapitalize="off" onChange={(event) => setRemote(event.target.value)} />
        </label>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!ready}>
            <Icon name="upload" size={14} />
            {t('publish.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
