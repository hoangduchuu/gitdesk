import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdateProgress } from '../src/shared/api'
import { checkForUpdate, downloadFile, isNewer } from '../src/main/updater'

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

describe('downloadFile', () => {
  const fakeFetch = (chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200): typeof fetch =>
    (async () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk)
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          controller.close()
        }
      })
      return new Response(body, { status, headers })
    }) as unknown as typeof fetch

  const withTempFile = async (run: (file: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdesk-download-'))
    try {
      await run(join(dir, 'file.bin'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('writes the file and reports growing progress up to the full size', async () => {
    const chunks = [new Uint8Array(400).fill(1), new Uint8Array(400).fill(2), new Uint8Array(200).fill(3)]
    const seen: UpdateProgress[] = []

    await withTempFile(async (file) => {
      await downloadFile('https://example.test/x', file, (progress) => seen.push(progress), fakeFetch(chunks, { 'content-length': '1000' }))

      expect(readFileSync(file)).toHaveLength(1000)
    })

    const downloads = seen.flatMap((progress) => (progress.phase === 'downloading' ? [progress] : []))
    expect(downloads[0]).toEqual({ phase: 'downloading', received: 0, total: 1000 })
    expect(downloads.at(-1)).toEqual({ phase: 'downloading', received: 1000, total: 1000 })
    expect(downloads.map((progress) => progress.received)).toEqual([...downloads.map((progress) => progress.received)].sort((a, b) => a - b))
  })

  it('reports an unknown total when the server sends no length', async () => {
    const seen: UpdateProgress[] = []

    await withTempFile((file) => downloadFile('https://example.test/x', file, (progress) => seen.push(progress), fakeFetch([new Uint8Array(10)])))

    expect(seen.at(-1)).toEqual({ phase: 'downloading', received: 10, total: null })
  })

  it('fails on an HTTP error without creating progress for a body', async () => {
    await withTempFile(async (file) => {
      await expect(downloadFile('https://example.test/x', file, () => undefined, fakeFetch([], {}, 404))).rejects.toThrow('Download failed (404)')
    })
  })
})
