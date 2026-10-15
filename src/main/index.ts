import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { basename, join } from 'node:path'
import {
  channelFor,
  MENU_COMMAND_CHANNEL,
  REPO_METHODS,
  REPO_OPENED_CHANNEL,
  TERMINAL_EVENT_CHANNEL,
  type MenuCommand
} from '../shared/api'
import type { RecentRepo, Workspace } from '../shared/api'
import type { RepoInfo, Result } from '../shared/types'
import { resolveRepo } from './git/repo'
import { createHandlers } from './handlers'
import { ProfileStore } from './profiles'
import { TerminalManager } from './terminal'
import { requireInteger, requireString } from './validate'
import { WorkspaceStore } from './workspace'

const REPO_ARG_PREFIX = '--repo='

const repoFromArgv = (argv: readonly string[]): string | null => {
  const arg = argv.find((value) => value.startsWith(REPO_ARG_PREFIX))
  return arg ? arg.slice(REPO_ARG_PREFIX.length) || null : null
}

/** Repositories the user explicitly opened; git only ever runs inside these. */
const openedRepos = new Set<string>()

const toResult = async <T>(work: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { ok: true, data: await work() }
  } catch (error) {
    console.error('[gitdesk]', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const requireOpenedRepo = (repoPath: unknown): string => {
  if (typeof repoPath !== 'string' || !openedRepos.has(repoPath)) {
    throw new Error('Repository has not been opened in this session')
  }
  return repoPath
}

const workspace = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))

const openRepo = async (folder: string): Promise<RepoInfo> => {
  const repo = await resolveRepo(folder)
  openedRepos.add(repo.path)
  await workspace.addRecent(repo.path)
  return repo
}

/** Reopen the saved tabs (skipping repositories that are gone) and add the --repo argument. */
const restoreWorkspace = async (): Promise<Workspace> => {
  const saved = await workspace.read()
  const tabs: RepoInfo[] = []
  let active = -1
  for (const [index, path] of saved.tabs.entries()) {
    try {
      const repo = await resolveRepo(path)
      if (tabs.some((tab) => tab.path === repo.path)) continue
      openedRepos.add(repo.path)
      if (index === saved.active) active = tabs.length
      tabs.push(repo)
    } catch (error) {
      console.error('[gitdesk] skipping a saved tab that no longer opens:', path, error)
    }
  }
  const folder = repoFromArgv(process.argv)
  if (folder !== null) {
    const repo = await openRepo(folder)
    const existing = tabs.findIndex((tab) => tab.path === repo.path)
    active = existing >= 0 ? existing : tabs.push(repo) - 1
  }
  return { tabs, active: active >= 0 ? active : tabs.length > 0 ? 0 : -1 }
}

const requireTabs = (paths: unknown): string[] => {
  if (!Array.isArray(paths)) throw new Error('Invalid tab list')
  return paths.map((path) => {
    if (typeof path !== 'string' || !openedRepos.has(path)) throw new Error('Tab is not an opened repository')
    return path
  })
}

function registerIpc(window: BrowserWindow): void {
  ipcMain.handle(channelFor('openRepoDialog'), () =>
    toResult(async () => {
      const picked = await dialog.showOpenDialog(window, {
        title: 'Open repository',
        properties: ['openDirectory']
      })
      const folder = picked.filePaths[0]
      if (picked.canceled || folder === undefined) return null
      return openRepo(folder)
    })
  )

  ipcMain.handle(channelFor('getWorkspace'), () => toResult(restoreWorkspace))

  ipcMain.handle(channelFor('getRecentRepos'), () =>
    toResult(async (): Promise<RecentRepo[]> =>
      (await workspace.read()).recent.map((path) => ({ path, name: basename(path) }))
    )
  )

  ipcMain.handle(channelFor('openRecentRepo'), (_event, path: unknown) =>
    toResult(async () => {
      const folder = requireString(path, 'repository path')
      if (!(await workspace.knows(folder))) throw new Error('Repository is not in the recent list')
      return openRepo(folder)
    })
  )

  ipcMain.handle(channelFor('saveTabs'), (_event, paths: unknown, active: unknown) =>
    toResult(async () => {
      const tabs = requireTabs(paths)
      await workspace.saveTabs(tabs, requireInteger(active, 'selected tab', -1, Math.max(tabs.length - 1, -1)))
      return null
    })
  )

  const terminals = new TerminalManager((event) => {
    if (!window.isDestroyed()) window.webContents.send(TERMINAL_EVENT_CHANNEL, event)
  })
  // Shells must not outlive the window: stop them when it closes or the page reloads.
  window.on('closed', () => terminals.stopAll())
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) terminals.stopAll()
  })
  const handlers = createHandlers(new ProfileStore(join(app.getPath('userData'), 'profiles.json')), terminals)
  for (const method of REPO_METHODS) {
    const handler = handlers[method] as (repo: string, ...args: unknown[]) => Promise<unknown>
    ipcMain.handle(channelFor(method), (_event, repoPath: unknown, ...args: unknown[]) =>
      toResult(() => handler(requireOpenedRepo(repoPath), ...args))
    )
  }
}

/**
 * The standard menus, with a Tabs menu in place of File so Cmd+W closes a tab instead of
 * the window, as in GitKraken and browsers.
 */
function installMenu(window: BrowserWindow): void {
  const send = (command: MenuCommand) => () => {
    if (!window.isDestroyed()) window.webContents.send(MENU_COMMAND_CHANNEL, command)
  }
  const tabs: MenuItemConstructorOptions = {
    label: 'Tabs',
    submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: send('newTab') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
      { type: 'separator' },
      { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: send('nextTab') },
      { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: send('previousTab') }
    ]
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    tabs,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // Listed by hand: the stock Window menu has a Close item that would take Ctrl+W back.
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'GitDesk',
    show: false,
    // On macOS the tab bar is the title bar, with the window buttons inset into it.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // Links open in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

// Only one GitDesk runs at a time: launching it again focuses the running window and opens
// any repository passed with --repo=<path> there.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    const folder = repoFromArgv(argv)
    if (folder === null) return
    const target = mainWindow
    toResult(() => openRepo(folder)).then((result) => target.webContents.send(REPO_OPENED_CHANNEL, result))
  })

  app.whenReady().then(() => {
    mainWindow = createWindow()
    registerIpc(mainWindow)
    installMenu(mainWindow)
  })

  app.on('window-all-closed', () => app.quit())
}
