import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GithubDeviceLogin, ProfileAuth, ProfileAuthState } from '../shared/model'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
/** Fixed rather than taken from the response, so a reply can never choose what the browser opens. */
export const VERIFICATION_URL = 'https://github.com/login/device'
const SCOPES = 'repo read:user user:email'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const SLOW_DOWN_SECONDS = 5

/** The part of Electron's `safeStorage` this module needs. */
export interface SecretBox {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface CredentialsOptions {
  /** JSON file in the app's data folder holding each profile's connection and encrypted token. */
  file: string
  /** Client ID of a GitHub OAuth App with device flow enabled; empty disables GitHub sign-in. */
  clientId: string
  secrets: SecretBox
  openExternal: (url: string) => Promise<void>
  fetch?: typeof globalThis.fetch
  sleep?: (ms: number) => Promise<void>
}

type Entry =
  | { kind: 'github'; login: string; token: string }
  | { kind: 'token'; host: string; username: string; token: string }

/** Profile id -> its connection to a git provider. Tokens are base64 of keychain-encrypted text. */
type Stored = Record<string, Entry>

interface Attempt {
  deviceCode: string
  interval: number
  cancel: () => void
  cancelled: Promise<never>
}

const GITHUB_HOST = 'github.com'
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const publicView = (entry: Entry): ProfileAuth =>
  entry.kind === 'github'
    ? { kind: 'github', login: entry.login }
    : { kind: 'token', host: entry.host, username: entry.username }

/**
 * Each commit profile can be connected to one git provider: GitHub (browser sign-in through
 * the OAuth device flow) or any HTTPS git server with a username and access token. Git
 * commands for a repository use the connection of the profile that repository commits as.
 */
export class Credentials {
  private pending: Attempt | null = null
  private readonly request: typeof globalThis.fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: CredentialsOptions) {
    this.request = options.fetch ?? globalThis.fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async status(): Promise<ProfileAuthState> {
    const stored = await this.read()
    return {
      githubConfigured: this.options.clientId !== '',
      byProfile: Object.fromEntries(Object.entries(stored).map(([id, entry]) => [id, publicView(entry)]))
    }
  }

  /** Ask GitHub for a device code and open the browser on the page where it is entered. */
  async startGithubLogin(): Promise<GithubDeviceLogin> {
    if (this.options.clientId === '') {
      throw new Error('GitHub sign-in is not configured: set GITDESK_GITHUB_CLIENT_ID to the client ID of a GitHub OAuth App with device flow enabled')
    }
    if (!this.options.secrets.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system, so the token cannot be saved safely')
    }
    this.cancelGithubLogin()
    const body = await this.post(DEVICE_CODE_URL, { client_id: this.options.clientId, scope: SCOPES })
    const deviceCode = text(body['device_code'])
    const userCode = text(body['user_code'])
    const interval = Number(body['interval'])
    const expiresIn = Number(body['expires_in'])
    if (deviceCode === null || userCode === null || !Number.isFinite(interval) || !Number.isFinite(expiresIn)) {
      throw new Error(text(body['error_description']) ?? 'GitHub sent an unexpected sign-in response')
    }
    let cancel = (): void => undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error('Sign-in cancelled'))
    })
    cancelled.catch(() => undefined) // Rejected only by cancel(); completeGithubLogin() observes it.
    this.pending = { deviceCode, interval: Math.max(interval, 1), cancel, cancelled }
    await this.options.openExternal(VERIFICATION_URL)
    return { userCode, verificationUri: VERIFICATION_URL, expiresIn }
  }

  /** Wait until the code is approved in the browser, then connect the profile to that account. */
  async completeGithubLogin(profileId: string): Promise<ProfileAuth> {
    const attempt = this.pending
    if (attempt === null) throw new Error('No GitHub sign-in is in progress')
    try {
      const token = await this.pollForToken(attempt)
      const login = await this.fetchLogin(token)
      return await this.save(profileId, {
        kind: 'github',
        login,
        token: this.options.secrets.encryptString(token).toString('base64')
      })
    } finally {
      if (this.pending === attempt) this.pending = null
    }
  }

  cancelGithubLogin(): void {
    this.pending?.cancel()
    this.pending = null
  }

  /** Connect a profile to any HTTPS git server with a username and access token. */
  async setToken(profileId: string, host: string, username: string, token: string): Promise<ProfileAuth> {
    const cleanHost = host.trim().toLowerCase()
    const cleanUser = username.trim()
    if (!HOST.test(cleanHost)) throw new Error('Invalid host: use a name like gitlab.com or git.example.com:8443')
    if (cleanUser === '' || CONTROL_CHARS.test(cleanUser) || cleanUser.includes(':')) throw new Error('Invalid username')
    if (token === '' || CONTROL_CHARS.test(token)) throw new Error('Invalid access token')
    if (!this.options.secrets.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system, so the token cannot be saved safely')
    }
    return this.save(profileId, {
      kind: 'token',
      host: cleanHost,
      username: cleanUser,
      token: this.options.secrets.encryptString(token).toString('base64')
    })
  }

  /** Disconnect a profile. A GitHub token is not revoked on github.com. */
  async remove(profileId: string): Promise<void> {
    this.cancelGithubLogin()
    const { [profileId]: _removed, ...others } = await this.read()
    await this.write(others)
  }

  /**
   * Environment for git commands that talk to a remote, via config variables so the token
   * never appears in a command line. Requests to the profile's host carry its credentials, and
   * that host's SSH addresses are read as HTTPS (the repository's own remote is not changed).
   * Empty when the repository has no profile or the profile is not connected.
   */
  async gitEnv(profileId: string | null): Promise<Record<string, string>> {
    if (profileId === null) return {}
    const entry = (await this.read())[profileId]
    if (!entry) return {}
    let secret: string
    try {
      secret = this.options.secrets.decryptString(Buffer.from(entry.token, 'base64'))
    } catch {
      return {} // Keychain changed or entry unreadable: behave as not connected.
    }
    const host = entry.kind === 'github' ? GITHUB_HOST : entry.host
    const user = entry.kind === 'github' ? 'x-access-token' : entry.username
    const sshName = host.replace(/:\d+$/, '')
    const basic = Buffer.from(`${user}:${secret}`).toString('base64')
    return {
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      GIT_CONFIG_KEY_1: `url.https://${host}/.insteadOf`,
      GIT_CONFIG_VALUE_1: `git@${sshName}:`,
      GIT_CONFIG_KEY_2: `url.https://${host}/.insteadOf`,
      GIT_CONFIG_VALUE_2: `ssh://git@${sshName}/`
    }
  }

  private async save(profileId: string, entry: Entry): Promise<ProfileAuth> {
    await this.write({ ...(await this.read()), [profileId]: entry })
    return publicView(entry)
  }

  private async pollForToken(attempt: Attempt): Promise<string> {
    let interval = attempt.interval
    for (;;) {
      await Promise.race([this.sleep(interval * 1000), attempt.cancelled])
      const body = await this.post(TOKEN_URL, {
        client_id: this.options.clientId,
        device_code: attempt.deviceCode,
        grant_type: DEVICE_GRANT
      })
      const token = text(body['access_token'])
      if (token !== null) return token
      switch (body['error']) {
        case 'authorization_pending':
          break
        case 'slow_down':
          interval += SLOW_DOWN_SECONDS
          break
        case 'expired_token':
          throw new Error('The sign-in code expired. Start again.')
        case 'access_denied':
          throw new Error('Sign-in was denied on GitHub')
        default:
          throw new Error(text(body['error_description']) ?? 'GitHub sign-in failed')
      }
    }
  }

  private async fetchLogin(token: string): Promise<string> {
    const response = await this.request(USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'GitDesk',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!response.ok) throw new Error(`GitHub rejected the new token (${response.status})`)
    const login = text(((await response.json()) as Record<string, unknown>)['login'])
    if (login === null) throw new Error('GitHub did not return an account')
    return login
  }

  private async post(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GitDesk'
      },
      body: new URLSearchParams(form).toString()
    })
    if (!response.ok) throw new Error(`GitHub responded with ${response.status}`)
    return (await response.json()) as Record<string, unknown>
  }

  private async read(): Promise<Stored> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.options.file, 'utf8'))
    } catch {
      return {}
    }
    const stored: Stored = {}
    for (const [id, value] of Object.entries((parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>)) {
      const e = value as Record<string, unknown> | null
      const token = text(e?.['token'])
      if (token === null) continue
      if (e?.['kind'] === 'github' && text(e['login']) !== null) stored[id] = { kind: 'github', login: e['login'] as string, token }
      else if (e?.['kind'] === 'token' && text(e['host']) !== null && text(e['username']) !== null) {
        stored[id] = { kind: 'token', host: e['host'] as string, username: e['username'] as string, token }
      }
    }
    return stored
  }

  private async write(stored: Stored): Promise<void> {
    await mkdir(dirname(this.options.file), { recursive: true })
    const temp = `${this.options.file}.tmp`
    await writeFile(temp, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.options.file)
  }
}
