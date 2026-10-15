import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_METHODS,
  channelFor,
  MENU_COMMAND_CHANNEL,
  REPO_METHODS,
  REPO_OPENED_CHANNEL,
  TERMINAL_EVENT_CHANNEL,
  type GitDeskApi,
  type GitDeskEvents
} from '../shared/api'

const invoke =
  (method: keyof GitDeskApi) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channelFor(method), ...args)

const api = Object.fromEntries(
  ([...APP_METHODS, ...REPO_METHODS] as const).map((method) => [method, invoke(method)])
) as unknown as GitDeskApi

/** Subscribe to a main -> renderer channel; returns the unsubscribe function. */
const subscribe = <T,>(channel: string, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const events: GitDeskEvents = {
  onRepoOpened: (listener) => subscribe(REPO_OPENED_CHANNEL, listener),
  onTerminalEvent: (listener) => subscribe(TERMINAL_EVENT_CHANNEL, listener),
  onMenuCommand: (listener) => subscribe(MENU_COMMAND_CHANNEL, listener)
}

contextBridge.exposeInMainWorld('gitdesk', { ...api, ...events })
