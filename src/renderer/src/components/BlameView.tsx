import { useEffect, useMemo, useState } from 'react'
import { UNCOMMITTED_HASH_PATTERN } from '../../../shared/blame-parse'
import { relativeAge } from '../../../shared/format'
import type { BlameLine } from '../../../shared/model'
import { api, errorMessage, unwrap } from '../api'
import { highlightLine, languageFor } from '../highlight'
import { localeOf, useT, useTCount } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { Icon } from '../icons'

/** Rendering every line of a huge file would freeze the window: show the start and say so. */
const MAX_LINES = 5000

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; lines: BlameLine[] }

interface Props {
  repo: string
  path: string
  /** Commit to blame as of; null blames the working tree. */
  rev: string | null
  /** Changes whenever the repository data is reloaded, so the blame follows new commits. */
  reloadKey: unknown
  onReveal: (hash: string) => void
  onClose: () => void
}

/** The file with, beside each line, the commit and author that last changed it. */
export function BlameView({ repo, path, rev, reloadKey, onReveal, onClose }: Props) {
  const t = useT()
  const tCount = useTCount()
  const { language } = useSettings()
  const locale = localeOf(language)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const now = useMemo(() => Date.now() / 1000, [state])
  const syntax = languageFor(path)

  useEffect(() => {
    let cancelled = false
    api()
      .getBlame(repo, path, rev)
      .then(unwrap)
      .then((lines) => !cancelled && setState({ kind: 'ready', lines }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, path, rev, reloadKey])

  const shown = state.kind === 'ready' ? state.lines.slice(0, MAX_LINES) : []
  // Lines of one commit that follow each other read as a block: the gutter is written once, on its first line.
  let block = 0

  return (
    <section className="blame-view">
      <header className="view-header">
        <span className="view-title">{rev === null ? t('blame.title', { path }) : t('blame.titleAt', { path, hash: rev.slice(0, 7) })}</span>
        <span className="heading-actions">
          <button type="button" className="ghost" onClick={onClose}>
            <Icon name="close" size={14} />{t('common.close')}
          </button>
        </span>
      </header>
      {state.kind === 'loading' && <p className="hint">{t('blame.loading')}</p>}
      {state.kind === 'error' && <p className="error">{state.message}</p>}
      {state.kind === 'ready' && (
        <div className="blame-body">
          {state.lines.length > MAX_LINES && (
            <p className="hint">{tCount('blame.truncated', MAX_LINES, { total: state.lines.length })}</p>
          )}
          <table className="blame-table">
            <tbody>
              {shown.map((line, index) => {
                const first = index === 0 || shown[index - 1]!.hash !== line.hash
                if (first) block += 1
                const uncommitted = UNCOMMITTED_HASH_PATTERN.test(line.hash)
                return (
                  <tr key={line.line} className={`blame-row${block % 2 === 0 ? ' alt' : ''}${first ? ' first' : ''}`}>
                    <td
                      className={`blame-gutter${uncommitted ? ' uncommitted' : ''}`}
                      title={uncommitted ? undefined : `${line.summary}\n${line.hash}`}
                    >
                      {first && (
                        uncommitted ? (
                          <span className="muted">{t('blame.uncommitted')}</span>
                        ) : (
                          <button type="button" className="link blame-commit" onClick={() => onReveal(line.hash)} title={t('history.showInGraph')}>
                            <span className="mono">{line.hash.slice(0, 7)}</span>
                            <span className="blame-author">{line.author}</span>
                            <span className="muted">{relativeAge(line.time, now, locale)}</span>
                          </button>
                        )
                      )}
                    </td>
                    <td className="blame-no">{line.line}</td>
                    {/* highlightLine escapes the code, so this HTML only contains highlight spans. */}
                    <td className="blame-text hljs" dangerouslySetInnerHTML={{ __html: highlightLine(line.text, syntax) || ' ' }} />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
