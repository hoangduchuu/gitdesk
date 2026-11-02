import { useEffect, useMemo, useState } from 'react'
import type { DiffTarget } from '../../../shared/model'
import { formatBytes, hexDump, viewerFor, type FileBlob, type FileSides, type ViewerKind } from '../../../shared/viewers'
import { api, errorMessage, unwrap } from '../api'
import { useT } from '../i18n'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; sides: FileSides }
type Mode = 'side' | 'swipe' | 'onion'

const decode = (blob: FileBlob): Uint8Array => {
  const raw = atob(blob.base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Object URL for a blob's bytes, revoked when the blob changes or the viewer unmounts. */
function useObjectUrl(blob: FileBlob | null, mime: string): string | null {
  const url = useMemo(
    () => (blob && blob.base64 ? URL.createObjectURL(new Blob([decode(blob) as BlobPart], { type: mime })) : null),
    [blob, mime]
  )
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}

/** Viewer for non-text files: images (with compare modes and zoom), audio, video, PDF, and a hex dump fallback. */
export function FileViewer({ repo, target }: { repo: string; target: DiffTarget }) {
  const t = useT()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const viewer = viewerFor(target.path)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    api()
      .getFileSides(repo, target)
      .then(unwrap)
      .then((sides) => !cancelled && setState({ kind: 'ready', sides }))
      .catch((error) => !cancelled && setState({ kind: 'error', message: errorMessage(error) }))
    return () => {
      cancelled = true
    }
  }, [repo, target])

  if (state.kind === 'loading') return <p className="hint">{t('viewer.loading')}</p>
  if (state.kind === 'error') return <p className="error">{state.message}</p>
  const { old, new: current } = state.sides
  if (!old && !current) return <p className="hint">{t('viewer.missing')}</p>
  if (!viewer) return <HexPane old={old} current={current} />
  return <MediaPane kind={viewer.kind} mime={viewer.mime} old={old} current={current} />
}

function MediaPane(props: { kind: ViewerKind; mime: string; old: FileBlob | null; current: FileBlob | null; }) {
  const { kind, mime, old, current } = props
  const t = useT()
  const [mode, setMode] = useState<Mode>('side')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [split, setSplit] = useState(50)
  const [opacity, setOpacity] = useState(50)
  const oldUrl = useObjectUrl(old, mime)
  const newUrl = useObjectUrl(current, mime)
  const tooLarge = (blob: FileBlob | null): boolean => !!blob && blob.truncated

  const render = (url: string | null, blob: FileBlob | null, extra?: { className?: string; style?: React.CSSProperties }) => {
    if (!blob) return <p className="hint">{t('viewer.none')}</p>
    if (!url || tooLarge(blob)) return <p className="hint">{t('viewer.tooLarge')}</p>
    const className = `viewer-media ${extra?.className ?? ''}`
    const style = { ...(zoom === 'fit' ? { maxWidth: '100%', maxHeight: '70vh' } : { width: `${zoom * 100}%`, maxWidth: 'none' }), ...extra?.style }
    if (kind === 'image') return <img className={className} style={style} src={url} alt="" draggable={false} />
    if (kind === 'audio') return <audio controls src={url} />
    if (kind === 'video') return <video className="viewer-media" controls src={url} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
    return <iframe className="viewer-pdf" src={url} title="pdf" />
  }

  const both = old && current && kind === 'image'
  const info = (blob: FileBlob | null): string => (blob ? formatBytes(blob.size) : '—')

  return (
    <div className="file-viewer">
      <div className="viewer-toolbar">
        {both && (
          <span className="seg">
            {(['side', 'swipe', 'onion'] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? 'ghost active' : 'ghost'} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`viewer.mode.${m}`)}
              </button>
            ))}
          </span>
        )}
        {kind === 'image' && (
          <span className="seg">
            <button type="button" className={zoom === 'fit' ? 'ghost active' : 'ghost'} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>{t('viewer.fit')}</button>
            {[0.5, 1, 2, 4].map((z) => (
              <button key={z} type="button" className={zoom === z ? 'ghost active' : 'ghost'} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z * 100}%
              </button>
            ))}
          </span>
        )}
      </div>
      {both && mode === 'swipe' ? (
        <div className="viewer-swipe">
          <div className="viewer-stack">
            {render(oldUrl, old)}
            <div className="viewer-overlay" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>{render(newUrl, current)}</div>
            <div className="viewer-handle" style={{ left: `${split}%` }} />
          </div>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label={t('viewer.mode.swipe')} />
        </div>
      ) : both && mode === 'onion' ? (
        <div className="viewer-swipe">
          <div className="viewer-stack">
            {render(oldUrl, old)}
            <div className="viewer-overlay" style={{ opacity: opacity / 100 }}>{render(newUrl, current)}</div>
          </div>
          <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label={t('viewer.mode.onion')} />
        </div>
      ) : (
        <div className="viewer-sides">
          {old && (
            <figure className="viewer-side viewer-old">
              <figcaption>{t('viewer.before')} · {info(old)}</figcaption>
              {render(oldUrl, old)}
            </figure>
          )}
          {current && (
            <figure className="viewer-side viewer-new">
              <figcaption>{old ? t('viewer.after') : t('viewer.file')} · {info(current)}</figcaption>
              {render(newUrl, current)}
            </figure>
          )}
          {!current && old && <p className="hint">{t('viewer.deleted')}</p>}
        </div>
      )}
    </div>
  )
}

function HexPane({ old, current }: { old: FileBlob | null; current: FileBlob | null }) {
  const t = useT()
  const blob = current ?? old
  const rows = useMemo(() => (blob && blob.base64 ? hexDump(decode(blob)) : []), [blob])
  if (!blob) return null
  return (
    <div className="file-viewer">
      <div className="viewer-toolbar"><span className="muted">{t('viewer.hex')} · {formatBytes(blob.size)}</span></div>
      {rows.length === 0 ? <p className="hint">{t('viewer.tooLarge')}</p> : <pre className="viewer-hex">{rows.join('\n')}</pre>}
      {blob.size > 4096 && <p className="hint">{t('viewer.hexTruncated')}</p>}
    </div>
  )
}
