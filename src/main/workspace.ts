import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const RECENT_LIMIT = 10

export interface WorkspaceState {
  /** Repository paths of the open tabs, left to right. */
  tabs: string[]
  /** Index into tabs of the selected tab, or -1. */
  active: number
  /** Most recently opened repositories first. */
  recent: string[]
}

const EMPTY: WorkspaceState = { tabs: [], active: -1, recent: [] }

const isPathList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')

/** Move a path to the front of the recent list, without duplicates, capped at the limit. */
export const pushRecent = (recent: readonly string[], path: string, limit = RECENT_LIMIT): string[] =>
  [path, ...recent.filter((item) => item !== path)].slice(0, limit)

/** Open tabs and recently opened repositories, kept in a JSON file in the app's data folder. */
export class WorkspaceStore {
  /** Writes run one after another so concurrent updates never lose each other. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  async read(): Promise<WorkspaceState> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return EMPTY
    }
    try {
      const parsed = JSON.parse(text) as Partial<WorkspaceState>
      const tabs = isPathList(parsed.tabs) ? parsed.tabs : []
      const active = typeof parsed.active === 'number' && parsed.active < tabs.length ? parsed.active : -1
      const recent = isPathList(parsed.recent) ? parsed.recent.slice(0, RECENT_LIMIT) : []
      return { tabs, active, recent }
    } catch (error) {
      // Keep the unreadable file for the user instead of silently overwriting it.
      console.error('[gitdesk] workspace file is not valid JSON; moving it aside', error)
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined)
      return EMPTY
    }
  }

  private update(change: (state: WorkspaceState) => WorkspaceState): Promise<void> {
    const next = this.queue.then(async () => {
      const state = change(await this.read())
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      await rename(temp, this.file)
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  saveTabs(tabs: string[], active: number): Promise<void> {
    return this.update((state) => ({ ...state, tabs, active: active < tabs.length ? active : -1 }))
  }

  addRecent(path: string): Promise<void> {
    return this.update((state) => ({ ...state, recent: pushRecent(state.recent, path) }))
  }

  /** A repository the user opened before, so the app may reopen it without a dialog. */
  async knows(path: string): Promise<boolean> {
    const state = await this.read()
    return state.tabs.includes(path) || state.recent.includes(path)
  }
}
