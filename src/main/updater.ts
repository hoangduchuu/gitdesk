import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateInfo } from '../shared/model'

const REPO = 'hoangduchuu/gitdesk'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
/** Only files published on this repository's releases are ever downloaded. */
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`

const parse = (version: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** True when `latest` is a higher x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!
  return false
}

export async function checkForUpdate(current: string, request: typeof fetch = fetch): Promise<UpdateInfo> {
  const response = await request(LATEST_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitDesk' } })
  if (!response.ok) throw new Error(`Could not check for updates (GitHub answered ${response.status})`)
  const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown; assets?: unknown }
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  if (parse(tag) === null) throw new Error('Could not read the latest version from GitHub')
  const assets = Array.isArray(release.assets) ? (release.assets as Array<{ browser_download_url?: unknown }>) : []
  const dmg = assets
    .map((asset) => asset.browser_download_url)
    .find((url): url is string => typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX) && url.endsWith('arm64.dmg'))
  return {
    current,
    latest: tag.replace(/^v/, ''),
    available: isNewer(tag, current) && dmg !== undefined,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
    dmgUrl: dmg ?? null
  }
}

const sh = (script: string, ...args: string[]): void => {
  const child = spawn('/bin/sh', ['-c', script, 'sh', ...args], { detached: true, stdio: 'ignore' })
  child.unref()
}

/**
 * Download the latest dmg and replace the installed app with it, then relaunch. The swap runs
 * in a detached shell after this process exits, so the running bundle is not overwritten.
 * `bundle` is the installed GitDesk.app; `quit` ends the app once the installer script is running.
 */
export async function installUpdate(info: UpdateInfo, bundle: string, quit: () => void): Promise<void> {
  if (!info.available || info.dmgUrl === null || !info.dmgUrl.startsWith(DOWNLOAD_PREFIX)) throw new Error('No update is available')
  if (!bundle.endsWith('.app')) throw new Error('Updating works only from the installed app')
  const dir = await mkdtemp(join(tmpdir(), 'gitdesk-update-'))
  const dmg = join(dir, 'GitDesk.dmg')
  const response = await fetch(info.dmgUrl, { headers: { 'User-Agent': 'GitDesk' } })
  if (!response.ok || response.body === null) throw new Error(`Download failed (${response.status})`)
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(dmg))
  // Mount, copy next to the old app, swap, relaunch. If anything fails the old app stays.
  sh(
    `set -e
     sleep 1
     MOUNT=$(hdiutil attach "$1" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)
     NEW="$2.new"
     rm -rf "$NEW"
     cp -R "$MOUNT/GitDesk.app" "$NEW"
     hdiutil detach "$MOUNT" -quiet || true
     xattr -cr "$NEW"
     rm -rf "$2"
     mv "$NEW" "$2"
     rm -rf "$3"
     open "$2"`,
    dmg,
    bundle,
    dir
  )
  quit()
}
