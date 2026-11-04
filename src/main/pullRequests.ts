import type { CreatePullRequestInput, PullRequest, Remote } from '../shared/model'
import { parseRemoteUrl } from '../shared/remote-url'
import { runGit, type RunOptions } from './git/exec'
import { explain, type ProviderAccess } from './publish'

const REQUEST_TIMEOUT_MS = 30_000
const PER_PAGE = 50
const GITHUB_NAME = /^[A-Za-z0-9._-]{1,100}$/

export interface GithubTarget {
  /** Name of the git remote that points at the repository. */
  remote: string
  owner: string
  repo: string
}

/** The GitHub repository a clone talks to: `origin` if it is on github.com, else the first remote that is. */
export function githubTarget(remotes: readonly Remote[]): GithubTarget | null {
  const targets = remotes.flatMap((remote): GithubTarget[] => {
    const address = parseRemoteUrl(remote.fetchUrl)
    if (!address || address.host !== 'github.com' || address.owner.includes('/')) return []
    if (!GITHUB_NAME.test(address.owner) || !GITHUB_NAME.test(address.repo)) return []
    return [{ remote: remote.name, owner: address.owner, repo: address.repo }]
  })
  return targets.find((target) => target.remote === 'origin') ?? targets[0] ?? null
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function toPullRequest(raw: unknown): PullRequest {
  const item = (raw ?? {}) as Record<string, unknown>
  const ref = (key: string): string => text(((item[key] ?? {}) as Record<string, unknown>)['ref'])
  const number = item['number']
  const url = text(item['html_url'])
  if (typeof number !== 'number' || !url.startsWith('https://github.com/')) throw new Error('GitHub sent an unexpected pull request')
  return {
    number,
    title: text(item['title']),
    author: text(((item['user'] ?? {}) as Record<string, unknown>)['login']),
    head: ref('head'),
    base: ref('base'),
    url,
    draft: item['draft'] === true
  }
}

async function call(
  access: ProviderAccess,
  request: typeof globalThis.fetch,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<unknown> {
  if (access.host !== 'github.com') throw new Error('This profile is not connected to github.com')
  let response: Response
  try {
    response = await request(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GitDesk',
        Authorization: `Bearer ${access.token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', // never forward the token to another address
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    throw new Error(`Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    // GitHub answers 404 for a private repository the token cannot see.
    throw new Error(`GitHub refused (${response.status}): ${await explain(response)}. Check that this profile's connection can use pull requests on this repository (reconnect it under Profiles).`)
  }
  if (!response.ok) throw new Error(`GitHub refused (${response.status}): ${await explain(response)}`)
  return response.json()
}

/** Open pull requests, newest first. */
export async function listPullRequests(
  access: ProviderAccess,
  target: GithubTarget,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<PullRequest[]> {
  const list = await call(access, request, 'GET', `/repos/${target.owner}/${target.repo}/pulls?state=open&sort=created&direction=desc&per_page=${PER_PAGE}`)
  if (!Array.isArray(list)) throw new Error('GitHub sent an unexpected answer')
  return list.map(toPullRequest)
}

export async function createPullRequest(
  access: ProviderAccess,
  target: GithubTarget,
  input: CreatePullRequestInput,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<PullRequest> {
  const created = await call(access, request, 'POST', `/repos/${target.owner}/${target.repo}/pulls`, {
    title: input.title,
    body: input.body,
    head: input.head,
    base: input.base,
    draft: input.draft
  })
  return toPullRequest(created)
}

/**
 * Fetch a pull request's head and switch to a local branch `pr-<number>` for it. An existing
 * `pr-<number>` is reused (and fast-forwarded when that is possible), never overwritten.
 */
export async function checkoutPullRequest(repo: string, remote: string, number: number, options: RunOptions = {}): Promise<void> {
  const branch = `pr-${number}`
  await runGit(repo, ['fetch', remote, `pull/${number}/head`], options)
  const exists = (await runGit(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { okExitCodes: [1] })).trim() !== ''
  if (!exists) {
    await runGit(repo, ['switch', '-c', branch, 'FETCH_HEAD'])
    return
  }
  await runGit(repo, ['switch', branch, '--'])
  await runGit(repo, ['merge', '--ff-only', 'FETCH_HEAD']).catch(() => undefined)
}
