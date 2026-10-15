import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { TerminalManager, type TerminalEvent } from '../src/main/terminal'
import { removeDir, tempDir } from './helpers/repo'

let dir: string
let events: TerminalEvent[]
let manager: TerminalManager

beforeEach(() => {
  dir = tempDir('gitdesk-term-')
  // Each test gets its own array: a stopped session's late exit event must not leak into the next test.
  const sink: TerminalEvent[] = []
  events = sink
  manager = new TerminalManager((event) => sink.push(event), { shell: '/bin/sh', args: [] })
})
afterEach(() => {
  manager.stopAll()
  removeDir(dir)
})

const output = (id: number) =>
  events.filter((e): e is Extract<TerminalEvent, { kind: 'data' }> => e.kind === 'data' && e.id === id).map((e) => e.data).join('')

const waitFor = async (check: () => boolean, ms = 3000): Promise<void> => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('TerminalManager', () => {
  test('runs a shell in the repository folder and streams its output', async () => {
    const id = manager.start(dir, 80, 24)
    manager.write(id, 'pwd -P; echo DONE_$((40+2))\r')
    await waitFor(() => output(id).includes('DONE_42'))
    expect(output(id)).toContain(require('node:fs').realpathSync(dir))
  })

  test('keeps sessions separate and reports exit', async () => {
    const a = manager.start(dir, 80, 24)
    const b = manager.start(dir, 80, 24)
    expect(a).not.toBe(b)
    manager.write(b, 'echo ONLY_B\r')
    await waitFor(() => output(b).includes('ONLY_B'))
    expect(output(a)).not.toContain('ONLY_B')

    manager.write(a, 'exit 3\r')
    await waitFor(() => events.some((e) => e.kind === 'exit' && e.id === a))
    expect(events.find((e) => e.kind === 'exit' && e.id === a)).toEqual({ kind: 'exit', id: a, code: 3 })
  })

  test('resizes and stops sessions; unknown ids are rejected', async () => {
    const id = manager.start(dir, 80, 24)
    manager.resize(id, 120, 40)
    manager.write(id, 'stty size\r')
    await waitFor(() => output(id).includes('40 120'))
    manager.stop(id)
    expect(() => manager.write(id, 'x')).toThrow('No terminal')
  })
})
