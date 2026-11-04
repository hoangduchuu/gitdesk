import type { GitProvider, PublishInput, PublishResult } from '../shared/model'
import { addRemote, pushTo, readRemotes } from './git/remote'
import { runGit } from './git/exec'
import { readStatus } from './git/status'

/** What the main process may use to call a provider on behalf of a profile. Never sent to the renderer. */
export interface ProviderAccess {
  host: string
  username: string
  token: string
}

const REQUEST_TIMEOUT_MS = 30_000
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const MAX_DESCRIPTION = 350

interface Created {
  cloneUrl: string
  webUrl: string
}

const asText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** The provider's own explanation, flattened to one line. */
const explain = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const parts: string[] = []
  const add = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) add(item)
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (typeof inner === 'string' || Array.isArray(inner)) parts.push(`${key}:`)
        add(inner)
      }
    }
  }
  add(body?.['message'])
  add(body?.['errors'])
  add(body?.['error'])
  return parts.length > 0 ? parts.join(' ') : `HTTP ${response.status}`
}

async function send(
  request: typeof globalThis.fetch,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  method: 'POST' | 'GET' | 'PUT' = 'POST'
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await request(url, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'GitDesk', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      redirect: 'error', // never forward the token to another address
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`${label} refused to create the repository (${response.status}): ${await explain(response)}`)
  return (await response.json()) as Record<string, unknown>
}

/** Ask the provider to create an empty repository for the signed-in user. */
export async function createProviderRepo(
  access: ProviderAccess,
  input: Pick<PublishInput, 'provider' | 'name' | 'description' | 'private'>,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<Created> {
  const { name, description } = input
  if (!REPO_NAME.test(name)) throw new Error('Invalid repository name: use letters, digits, dot, dash and underscore')
  if (description.length > MAX_DESCRIPTION || CONTROL_CHARS.test(description)) throw new Error('Invalid description')

  const made = (body: Record<string, unknown>, clone: string, web: string): Created => {
    const cloneUrl = asText(body[clone])
    const webUrl = asText(body[web])
    if (cloneUrl === null || webUrl === null) throw new Error('The provider did not return the new repository address')
    return { cloneUrl, webUrl }
  }

  switch (input.provider) {
    case 'github': {
      if (access.host !== 'github.com') throw new Error('This profile is not connected to github.com')
      const body = await send(
        request,
        'GitHub',
        'https://api.github.com/user/repos',
        {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${access.token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        },
        { name, description, private: input.private }
      )
      return made(body, 'clone_url', 'html_url')
    }
    case 'gitlab': {
      const body = await send(
        request,
        access.host,
        `https://${access.host}/api/v4/projects`,
        { 'PRIVATE-TOKEN': access.token },
        { name, path: name, description, visibility: input.private ? 'private' : 'public' }
      )
      return made(body, 'http_url_to_repo', 'web_url')
    }
    case 'bitbucket': {
      if (access.host !== 'bitbucket.org') throw new Error('This profile is not connected to bitbucket.org')
      const headers = { Authorization: `Basic ${Buffer.from(`${access.username}:${access.token}`).toString('base64')}` }
      // Bitbucket repositories live in a workspace; use the first one this account administers, else the first.
      const workspaces = await send(request, 'Bitbucket', 'https://api.bitbucket.org/2.0/user/workspaces?pagelen=50', headers, undefined, 'GET')
      const entries = (Array.isArray(workspaces['values']) ? workspaces['values'] : []) as Array<Record<string, unknown>>
      const pick = entries.find((entry) => entry['administrator'] === true) ?? entries[0]
      const workspace = asText((pick?.['workspace'] as Record<string, unknown> | undefined)?.['slug'])
      if (workspace === null) throw new Error('Bitbucket: no workspace found for this account (the API token needs the read:workspace:bitbucket scope)')
      const body = await send(
        request,
        'Bitbucket',
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${name.toLowerCase()}`,
        headers,
        { scm: 'git', is_private: input.private, description }
      )
      // The reply's clone link embeds the username; build the plain address instead.
      const fullName = asText(body['full_name'])
      if (fullName === null) throw new Error('The provider did not return the new repository address')
      return { cloneUrl: `https://bitbucket.org/${fullName}.git`, webUrl: `https://bitbucket.org/${fullName}` }
    }
    case 'gitea': {
      const body = await send(
        request,
        access.host,
        `https://${access.host}/api/v1/user/repos`,
        { Authorization: `token ${access.token}` },
        { name, description, private: input.private }
      )
      return made(body, 'clone_url', 'html_url')
    }
  }
}

const hostOf = (provider: GitProvider, access: ProviderAccess): string => (provider === 'github' ? 'github.com' : access.host)

/**
 * Create the repository on the provider, add it as a remote and push the current branch.
 * Everything that can be checked first is, so a failure does not leave an empty repository
 * behind; if only the push fails, the message says what was already created.
 */
export async function publishRepository(
  repo: string,
  input: PublishInput,
  access: ProviderAccess,
  env: Record<string, string>,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<PublishResult> {
  if ((await readStatus(repo)).branch === null) throw new Error('Cannot publish a detached HEAD; create a branch first')
  if ((await runGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'], { okExitCodes: [1] })).trim() === '') {
    throw new Error('Make a first commit before publishing')
  }
  if ((await readRemotes(repo)).some((remote) => remote.name === input.remote)) {
    throw new Error(`A remote named ${input.remote} already exists`)
  }

  const created = await createProviderRepo(access, input, request)
  // The address comes from the provider's reply: accept only https on the host we talked to.
  let url: URL
  try {
    url = new URL(created.cloneUrl)
  } catch {
    throw new Error('The provider returned an invalid repository address')
  }
  if (url.protocol !== 'https:' || url.host !== hostOf(input.provider, access)) {
    throw new Error(`The provider returned an unexpected repository address: ${created.cloneUrl}`)
  }

  await addRemote(repo, input.remote, created.cloneUrl)
  try {
    await pushTo(repo, input.remote, { env })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Created ${created.webUrl} and added it as ${input.remote}, but pushing failed: ${reason}`)
  }
  return { remote: input.remote, webUrl: created.webUrl }
}
