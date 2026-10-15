import { spawn, type IPty } from 'node-pty'
import type { TerminalEvent } from '../shared/api'

export type { TerminalEvent }

export interface ShellCommand {
  shell: string
  args: string[]
}

/** The user's login shell, so PATH and aliases match their own terminal. */
export const defaultShell = (): ShellCommand =>
  process.platform === 'win32'
    ? { shell: process.env['COMSPEC'] ?? 'powershell.exe', args: [] }
    : { shell: process.env['SHELL'] ?? '/bin/zsh', args: ['-l'] }

/** Pseudo-terminals owned by the main process; output is pushed to the window through `send`. */
export class TerminalManager {
  private readonly sessions = new Map<number, IPty>()
  private nextId = 1

  constructor(
    private readonly send: (event: TerminalEvent) => void,
    private readonly command: ShellCommand = defaultShell()
  ) {}

  start(cwd: string, cols: number, rows: number): number {
    const id = this.nextId++
    const pty = spawn(this.command.shell, this.command.args, {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
    this.sessions.set(id, pty)
    pty.onData((data) => this.send({ kind: 'data', id, data }))
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.send({ kind: 'exit', id, code: exitCode })
    })
    return id
  }

  private session(id: number): IPty {
    const pty = this.sessions.get(id)
    if (!pty) throw new Error(`No terminal with id ${id}`)
    return pty
  }

  write(id: number, data: string): void {
    this.session(id).write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    this.session(id).resize(cols, rows)
  }

  stop(id: number): void {
    const pty = this.session(id)
    this.sessions.delete(id)
    pty.kill()
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id)
  }
}
