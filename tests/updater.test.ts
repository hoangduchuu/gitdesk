import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer } from '../src/main/updater'

const release = (tag: string, url: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ tag_name: tag, assets: [{ browser_download_url: url }] }))) as unknown as typeof fetch

const DMG = 'https://github.com/hoangduchuu/gitdesk/releases/download/v0.2.0/GitDesk-0.2.0-arm64.dmg'

describe('isNewer', () => {
  it('compares numerically', () => {
    expect(isNewer('v0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.1.2', '0.1.2')).toBe(false)
    expect(isNewer('0.1.1', '0.1.2')).toBe(false)
    expect(isNewer('garbage', '0.1.2')).toBe(false)
  })
})

describe('checkForUpdate', () => {
  it('reports a newer release with its dmg', async () => {
    const info = await checkForUpdate('0.1.2', release('v0.2.0', DMG))
    expect(info).toMatchObject({ latest: '0.2.0', available: true, dmgUrl: DMG })
  })
  it('ignores downloads from other hosts', async () => {
    const info = await checkForUpdate('0.1.2', release('v0.2.0', 'https://evil.example/GitDesk-arm64.dmg'))
    expect(info.available).toBe(false)
    expect(info.dmgUrl).toBeNull()
  })
  it('is not available when current', async () => {
    expect((await checkForUpdate('0.2.0', release('v0.2.0', DMG))).available).toBe(false)
  })
})
