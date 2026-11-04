import { app, BrowserWindow, safeStorage, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { basename, join } from 'node:path'
import {
  channelFor,
  MENU_COMMAND_CHANNEL,
  REPO_METHODS,
  REPO_OPENED_CHANNEL,
  TERMINAL_EVENT_CHANNEL,
  UPDATE_PROGRESS_CHANNEL,
  type MenuCommand
} from '../shared/api'
import type { CloneProfile, RecentRepo, Workspace } from '../shared/api'
import type { RepoInfo, Result } from '../shared/types'
import { cloneRepository } from './git/clone'
import { resolveRepo } from './git/repo'
import { readSubmodules } from './git/submodules'
import { findWorktree } from './git/worktrees'
import { AvatarService } from './avatars'
import { Credentials } from './credentials'
import { createHandlers } from './handlers'
import { ProfileStore } from './profiles'
import { checkForUpdate, installUpdate } from './updater'
import { TerminalManager } from './terminal'
import { requireInteger, requireString } from './validate'
import { WorkspaceStore } from './workspace'

const REPO_ARG_PREFIX = '--repo='

/** Public client ID of GitDesk's GitHub OAuth App (device flow); GITDESK_GITHUB_CLIENT_ID overrides it. */
const DEFAULT_GITHUB_CLIENT_ID = 'Ov23li6mUVghPm7rlehT'

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

  ipcMain.handle(channelFor('checkForUpdate'), () => toResult(() => checkForUpdate(app.getVersion())))
  ipcMain.handle(channelFor('installUpdate'), () =>
    toResult(async () => {
      if (!app.isPackaged) throw new Error('Updating works only from the installed app')
      const info = await checkForUpdate(app.getVersion())
      // <bundle>.app/Contents/MacOS/GitDesk -> <bundle>.app
      const bundle = join(app.getPath('exe'), '..', '..', '..')
      await installUpdate(info, bundle, () => app.quit(), (progress) => {
        if (!window.isDestroyed()) window.webContents.send(UPDATE_PROGRESS_CHANNEL, progress)
      })
      return null
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

  ipcMain.handle(channelFor('openWorktree'), (_event, repo: unknown, path: unknown) =>
    toResult(async () => {
      const base = requireOpenedRepo(repo)
      const worktree = await findWorktree(base, requireString(path, 'worktree path'))
      if (worktree === null) throw new Error('That folder is not a worktree of this repository')
      return openRepo(worktree.path)
    })
  )

  ipcMain.handle(channelFor('openSubmodule'), (_event, repo: unknown, path: unknown) =>
    toResult(async () => {
      const base = requireOpenedRepo(repo)
      const wanted = requireString(path, 'submodule path')
      const submodule = (await readSubmodules(base)).find((candidate) => candidate.path === wanted)
      if (!submodule || submodule.state === 'uninitialized') throw new Error('That submodule is not cloned yet')
      return openRepo(join(base, submodule.path))
    })
  )

  ipcMain.handle(channelFor('saveTabs'), (_event, paths: unknown, active: unknown) =>
    toResult(async () => {
      const tabs = requireTabs(paths)
      await workspace.saveTabs(tabs, requireInteger(active, 'selected tab', -1, Math.max(tabs.length - 1, -1)))
      return null
    })
  )

  const profiles = new ProfileStore(join(app.getPath('userData'), 'profiles.json'))
  const credentials = new Credentials({
    file: join(app.getPath('userData'), 'credentials.json'),
    clientId: process.env['GITDESK_GITHUB_CLIENT_ID'] ?? DEFAULT_GITHUB_CLIENT_ID,
    secrets: safeStorage,
    openExternal: (url) => shell.openExternal(url)
  })
  const requireProfile = async (value: unknown): Promise<string> => {
    const id = requireString(value, 'profile id')
    if (!(await profiles.list()).some((profile) => profile.id === id)) throw new Error('Profile not found')
    return id
  }
  ipcMain.handle(channelFor('getProfileAuth'), () => toResult(() => credentials.status()))
  ipcMain.handle(channelFor('githubLoginStart'), () => toResult(() => credentials.startGithubLogin()))
  ipcMain.handle(channelFor('githubLoginComplete'), (_event, profileId: unknown) =>
    toResult(async () => credentials.completeGithubLogin(await requireProfile(profileId)))
  )
  ipcMain.handle(channelFor('githubLoginCancel'), () =>
    toResult(async () => {
      credentials.cancelGithubLogin()
      return null
    })
  )
  ipcMain.handle(channelFor('setProfileToken'), (_event, profileId: unknown, host: unknown, username: unknown, token: unknown) =>
    toResult(async () =>
      credentials.setToken(
        await requireProfile(profileId),
        requireString(host, 'host'),
        requireString(username, 'username'),
        requireString(token, 'access token')
      )
    )
  )
  ipcMain.handle(channelFor('removeProfileAuth'), (_event, profileId: unknown) =>
    toResult(async () => {
      await credentials.remove(requireString(profileId, 'profile id'))
      return null
    })
  )

  ipcMain.handle(channelFor('getCloneProfiles'), () =>
    toResult(async (): Promise<CloneProfile[]> => {
      const { byProfile } = await credentials.status()
      return (await profiles.list()).flatMap((profile) => {
        const auth = byProfile[profile.id]
        if (!auth) return []
        const connection = auth.kind === 'github' ? `GitHub (@${auth.login})` : `${auth.host} (${auth.username})`
        return [{ id: profile.id, name: profile.name, connection }]
      })
    })
  )
  ipcMain.handle(channelFor('cloneRepository'), (_event, url: unknown, profileId: unknown, recurse: unknown) =>
    toResult(async () => {
      const address = requireString(url, 'repository URL')
      if (typeof recurse !== 'boolean') throw new Error('Invalid submodule flag')
      const id = profileId === null ? null : await requireProfile(profileId)
      const picked = await dialog.showOpenDialog(window, {
        title: 'Clone into folder',
        buttonLabel: 'Clone here',
        properties: ['openDirectory', 'createDirectory']
      })
      const parent = picked.filePaths[0]
      if (picked.canceled || parent === undefined) return null
      const env = await credentials.gitEnv(id)
      const folder = await cloneRepository(address, parent, env, id !== null, recurse)
      const repo = await openRepo(folder)
      if (id !== null) await profiles.setRepoProfile(repo.path, id)
      return repo
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
  const handlers = createHandlers(profiles, terminals, credentials, new AvatarService({ dir: join(app.getPath('userData'), 'avatars') }))
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
