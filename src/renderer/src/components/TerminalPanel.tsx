import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import type { TerminalEvent } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useSettings, type Theme } from '../hooks/useSettings'
import { useT } from '../i18n'
import { Icon } from '../icons'

/** xterm colours per app theme (xterm draws its own canvas, so CSS variables do not reach it). */
const TERMINAL_THEMES: Record<Theme, { background: string; foreground: string; cursor: string; selectionBackground: string }> = {
  dark: { background: '#16181d', foreground: '#d7dae0', cursor: '#d7dae0', selectionBackground: '#2c3a55' },
  light: { background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: '#dbe6fb' }
}

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 280

interface Props {
  repo: string
  visible: boolean
  onClose: () => void
}

/**
 * Integrated terminal: a login shell started in the repository folder. The session keeps
 * running while the panel is hidden and is stopped when the repository changes.
 */
export function TerminalPanel({ repo, visible, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [session, setSession] = useState(0)
  const [exited, setExited] = useState<number | null>(null)
  const { theme } = useSettings()
  const t = useT()
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const gitdesk = api()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      fontSize: 12,
      theme: TERMINAL_THEMES[theme]
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)
    fitRef.current = fit
    setExited(null)

    let id: number | null = null
    let disposed = false
    // Output can arrive before start() returns the id, so hold it until then.
    const early: TerminalEvent[] = []
    const handle = (event: TerminalEvent): void => {
      if (event.kind === 'data') term.write(event.data)
      else {
        term.write(`\r\n\x1b[2m${t('terminal.processExited', { code: event.code })}\x1b[0m\r\n`)
        setExited(event.code)
      }
    }
    const unsubscribe = gitdesk.onTerminalEvent((event) => {
      if (id === null) early.push(event)
      else if (event.id === id) handle(event)
    })

    const safeFit = (): void => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) fit.fit()
    }
    safeFit()
    void gitdesk.terminalStart(repo, Math.max(term.cols, 2), Math.max(term.rows, 2)).then((result) => {
      if (!result.ok) {
        term.write(`\x1b[31m${t('terminal.startFailed', { error: result.error })}\x1b[0m\r\n`)
        return
      }
      if (disposed) {
        void gitdesk.terminalStop(repo, result.data)
        return
      }
      id = result.data
      early.filter((event) => event.id === id).forEach(handle)
      early.length = 0
    })

    const input = term.onData((data) => {
      if (id !== null) void gitdesk.terminalWrite(repo, id, data)
    })
    const resized = term.onResize(({ cols, rows }) => {
      if (id !== null) void gitdesk.terminalResize(repo, id, cols, rows)
    })
    const observer = new ResizeObserver(() => {
      try {
        safeFit()
      } catch (error) {
        console.error('[gitdesk] terminal fit failed', errorMessage(error))
      }
    })
    observer.observe(element)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      resized.dispose()
      unsubscribe()
      if (id !== null) void gitdesk.terminalStop(repo, id)
      fitRef.current = null
      termRef.current = null
      term.dispose()
    }
  }, [repo, session, t])

  // Follow theme changes without restarting the shell.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERMINAL_THEMES[theme]
  }, [theme])

  // Refit when the panel is shown again or resized by dragging.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit())
  }, [visible, height])

  const startDrag = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (moveEvent: MouseEvent): void =>
      setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 200, startHeight + startY - moveEvent.clientY)))
    const stop = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  return (
    <section className="terminal-panel" style={{ height, display: visible ? 'flex' : 'none' }} aria-label={t('toolbar.terminal')}>
      <div className="terminal-resize" onMouseDown={startDrag} title={t('terminal.dragResize')} />
      <header className="terminal-header">
        <span className="terminal-title">{t('toolbar.terminal')}</span>
        <span className="muted terminal-cwd">{repo}</span>
        {exited !== null && (
          <button type="button" className="ghost small" onClick={() => setSession((value) => value + 1)}>
            <Icon name="restart" size={14} />{t('terminal.restart')}
          </button>
        )}
        <button type="button" className="ghost small" onClick={onClose} title={t('terminal.hideShortcut')}>
          <Icon name="hide" size={14} />{t('terminal.hide')}
        </button>
      </header>
      <div className="terminal-host" ref={host} />
    </section>
  )
}
