import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRemoteUrl, type RemoteAddress } from '../shared/remote-url'
import type { ProviderAccess } from './publish'

const DAY = 86_400_000
/** How long an answer is trusted: a picture, "this person has none", or "the lookup failed" (retried soon). */
const TTL = { found: 7 * DAY, none: DAY, failed: 10 * 60_000 }
const MAX_BYTES = 512 * 1024
/** Never SVG: it can carry scripts and links. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TIMEOUT_MS = 10_000
const SIZE = 96
/** How many people are looked up at once. */
const CONCURRENCY = 3
/** After GitHub refuses for rate limiting, leave it alone for this long (at most an hour). */
const RATE_LIMIT_PAUSE = 10 * 60_000
const MAX_PAUSE = 60 * 60_000
const NOREPLY = /^(?:(\d+)\+)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)@users\.noreply\.github\.com$/i

interface Entry {
  at: number
  ttl: number
  /** A `data:` URI, or null when this source has no picture for the person. */
  uri: string | null
}

export interface AvatarLookup {
  /** The repository's remote, to find which provider's accounts to ask. */
  remoteUrl: string | null
  /** The commit the people belong to (GitHub links its accounts to commits). */
  hash: string
  emails: string[]
  /** Also ask Gravatar, a third party that learns a hash of each email. */
  gravatar: boolean
  /** The signed-in connection of the repository's profile, used for private repositories. */
  access: ProviderAccess | null
}

/** A person to find a picture for, with one of their commits (GitHub links its accounts to commits). */
export interface AvatarPerson {
  email: string
  hash: string
}

export interface AvatarOptions {
  /** Folder for the cache; keys are hashed, so no email is written to disk. */
  dir: string
  fetch?: typeof globalThis.fetch
  now?: () => number
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Pictures for commit authors, fetched here in the main process and handed to the page as
 * `data:` URIs so the page itself never touches the network. Sources, in order: GitHub's
 * no-reply addresses, the account GitHub links to the commit, a GitLab server's avatar API,
 * and (only when allowed) Gravatar. Answers are cached on disk.
 */
export class AvatarService {
  private readonly memory = new Map<string, Entry>()
  private readonly request: typeof globalThis.fetch
  private readonly now: () => number
  /** No GitHub API calls before this time: it said we asked too much. */
  private githubPausedUntil = 0

  constructor(private readonly options: AvatarOptions) {
    this.request = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  /** Picture (or null) for each email asked about, keyed as given. Never throws: a failure just means no picture. */
  async lookup(input: AvatarLookup): Promise<Record<string, string | null>> {
    const wanted = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter((email) => email !== ''))]
    const found = new Map<string, string>()
    const remaining = (): string[] => wanted.filter((email) => !found.has(email))
    const remote = input.remoteUrl ? parseRemoteUrl(input.remoteUrl) : null

    try {
      for (const email of remaining()) {
        const url = noreplyUrl(email)
        const uri = url ? await this.remember(`noreply:${email}`, () => this.image(url)) : null
        if (uri) found.set(email, uri)
      }
      if (remote?.host === 'github.com') await this.githubAccounts(remote, input, remaining(), found)
      if (remote && remote.host !== 'github.com' && remote.host.includes('gitlab')) {
        for (const email of remaining()) {
          const uri = await this.remember(`gitlab:${remote.host}:${email}`, () => this.gitlabAvatar(remote.host, email, input))
          if (uri) found.set(email, uri)
        }
      }
      if (input.gravatar) {
        for (const email of remaining()) {
          const uri = await this.remember(`gravatar:${email}`, () => this.image(`https://www.gravatar.com/avatar/${sha256(email)}?s=${SIZE}&d=404`))
          if (uri) found.set(email, uri)
        }
      }
    } catch (error) {
      console.error('[gitdesk] avatar lookup failed', error)
    }
    return Object.fromEntries(input.emails.map((email) => [email, found.get(email.trim().toLowerCase()) ?? null]))
  }

  /**
   * Pictures for many people, each found through their own commit, a few at a time. People are
   * deduplicated by email, so someone with a hundred commits costs one lookup, and later ones are cached.
   */
  async lookupPeople(input: Omit<AvatarLookup, 'hash' | 'emails'> & { people: AvatarPerson[] }): Promise<Record<string, string | null>> {
    const queue = new Map<string, AvatarPerson>()
    for (const person of input.people) {
      const key = person.email.trim().toLowerCase()
      if (key !== '' && !queue.has(key)) queue.set(key, person)
    }
    const found = new Map<string, string | null>()
    const waiting = [...queue.entries()]
    const worker = async (): Promise<void> => {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const [key, person] = next
        const result = await this.lookup({ ...input, hash: person.hash, emails: [person.email] })
        found.set(key, result[person.email] ?? null)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, waiting.length) }, worker))
    return Object.fromEntries(input.people.map((person) => [person.email, found.get(person.email.trim().toLowerCase()) ?? null]))
  }

  /** One call to GitHub tells who the author and the committer of this commit are, if they have accounts. */
  private async githubAccounts(remote: RemoteAddress, input: AvatarLookup, emails: string[], found: Map<string, string>): Promise<void> {
    const todo: string[] = []
    for (const email of emails) if ((await this.peek(`github:${email}`)) === null) todo.push(email)

    if (todo.length > 0) {
      const urls = await this.githubCommitAvatars(remote, input).catch(() => null)
      for (const email of todo) {
        if (urls === null) {
          await this.store(`github:${email}`, null, TTL.failed)
          continue
        }
        const url = urls.get(email)
        if (url === undefined) {
          await this.store(`github:${email}`, null, TTL.none) // GitHub knows no account for this email
          continue
        }
        await this.remember(`github:${email}`, () => this.image(url))
      }
    }
    for (const email of emails) {
      const entry = await this.peek(`github:${email}`)
      if (entry?.uri) found.set(email, entry.uri)
    }
  }

  /** Lowercased email -> avatar URL for the people GitHub links to the commit. Null when the lookup itself failed. */
  private async githubCommitAvatars(remote: RemoteAddress, input: AvatarLookup): Promise<Map<string, string> | null> {
    if (this.now() < this.githubPausedUntil) return null
    const token = input.access?.host === 'github.com' ? input.access.token : null
    const response = await this.request(`https://api.github.com/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/commits/${encodeURIComponent(input.hash)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GitDesk',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.status === 403 || response.status === 429) {
      // Rate limited (or no access): stop asking until the limit resets, however many people are waiting.
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
      const wait = Number.isFinite(reset) && reset > this.now() ? reset - this.now() : RATE_LIMIT_PAUSE
      this.githubPausedUntil = this.now() + Math.min(wait, MAX_PAUSE)
      return null
    }
    if (!response.ok) return null // private repository without access, not pushed yet...
    const body = (await response.json()) as {
      author?: { avatar_url?: unknown } | null
      committer?: { avatar_url?: unknown } | null
      commit?: { author?: { email?: unknown }; committer?: { email?: unknown } }
    }
    const urls = new Map<string, string>()
    const add = (email: unknown, user: { avatar_url?: unknown } | null | undefined): void => {
      const avatar = user?.avatar_url
      if (typeof email !== 'string' || typeof avatar !== 'string') return
      try {
        const url = new URL(avatar)
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com')) return
        url.searchParams.set('s', String(SIZE))
        urls.set(email.toLowerCase(), url.toString())
      } catch {
        // not a URL: ignore
      }
    }
    add(body.commit?.author?.email, body.author)
    add(body.commit?.committer?.email, body.committer)
    return urls
  }

  private async gitlabAvatar(host: string, email: string, input: AvatarLookup): Promise<string | null> {
    const response = await this.request(`https://${host}/api/v4/avatar?email=${encodeURIComponent(email)}&size=${SIZE}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GitDesk',
        ...(input.access?.host === host ? { 'PRIVATE-TOKEN': input.access.token } : {})
      },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const url = ((await response.json()) as { avatar_url?: unknown }).avatar_url
    if (typeof url !== 'string') return null
    // For people without an account GitLab answers with a Gravatar address: only follow it when allowed.
    if (!input.gravatar && /(^|\.)gravatar\.com$/i.test(safeHost(url))) return null
    return this.image(url)
  }

  /** The picture at `url` as a data URI; null when there is none (404, not a safe image type, too big). */
  private async image(url: string): Promise<string | null> {
    if (!url.startsWith('https://')) return null
    const response = await this.request(url, {
      headers: { 'User-Agent': 'GitDesk', Accept: 'image/png,image/jpeg,image/gif,image/webp' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (response.url !== '' && !response.url.startsWith('https://')) return null // redirected to plain http
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!IMAGE_TYPES.has(type)) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
    return `data:${type};base64,${bytes.toString('base64')}`
  }

  /** A fresh cached answer (even "none"), else run `load` and keep what it says; a failure is remembered briefly. */
  private async remember(key: string, load: () => Promise<string | null>): Promise<string | null> {
    const cached = await this.peek(key)
    if (cached) return cached.uri
    try {
      const uri = await load()
      await this.store(key, uri, uri ? TTL.found : TTL.none)
      return uri
    } catch {
      await this.store(key, null, TTL.failed)
      return null
    }
  }

  private async peek(key: string): Promise<Entry | null> {
    const entry = this.memory.get(key) ?? (await this.readDisk(key))
    if (!entry || entry.at + entry.ttl <= this.now()) return null
    this.memory.set(key, entry)
    return entry
  }

  private file(key: string): string {
    return join(this.options.dir, `${sha256(key)}.json`)
  }

  private async readDisk(key: string): Promise<Entry | null> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as Partial<Entry>
      if (typeof entry.at !== 'number' || typeof entry.ttl !== 'number') return null
      if (entry.uri !== null && typeof entry.uri !== 'string') return null
      return { at: entry.at, ttl: entry.ttl, uri: entry.uri ?? null }
    } catch {
      return null
    }
  }

  private async store(key: string, uri: string | null, ttl: number): Promise<void> {
    const entry: Entry = { at: this.now(), ttl, uri }
    this.memory.set(key, entry)
    try {
      await mkdir(this.options.dir, { recursive: true })
      const temp = `${this.file(key)}.tmp`
      await writeFile(temp, JSON.stringify(entry), 'utf8')
      await rename(temp, this.file(key))
    } catch {
      // The cache is an optimisation; the picture is still returned.
    }
  }
}

const noreplyUrl = (email: string): string | null => {
  const match = NOREPLY.exec(email)
  if (!match) return null
  return match[1] ? `https://avatars.githubusercontent.com/u/${match[1]}?s=${SIZE}` : `https://github.com/${match[2]}.png?size=${SIZE}`
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
