import { afterEach, beforeEach, expect, test } from 'vitest'
import { readFileSides } from '../src/main/git/diff'
import { hexDump, viewerFor } from '../src/shared/viewers'
import { commitFile, initRepo, removeDir, writeFile } from './helpers/repo'

let repo: string
beforeEach(() => {
  repo = initRepo()
})
afterEach(() => removeDir(repo))

test('viewerFor picks a viewer by extension', () => {
  expect(viewerFor('a/b/Logo.PNG')).toEqual({ kind: 'image', mime: 'image/png' })
  expect(viewerFor('clip.mp4')?.kind).toBe('video')
  expect(viewerFor('README')).toBeNull()
  expect(viewerFor('dir.png/file')).toBeNull()
})

test('hexDump formats offset, hex and ascii', () => {
  expect(hexDump(new Uint8Array([0x41, 0x00, 0x7a]))[0]).toBe(`00000000  41 00 7a${' '.repeat(47 - 8)}  A.z`)
})

test('readFileSides returns old and new bytes for a working change', async () => {
  commitFile(repo, 'p.png', 'old')
  writeFile(repo, 'p.png', 'newer')
  const sides = await readFileSides(repo, { kind: 'working', path: 'p.png', staged: false, untracked: false })
  expect(Buffer.from(sides.old!.base64, 'base64').toString()).toBe('old')
  expect(Buffer.from(sides.new!.base64, 'base64').toString()).toBe('newer')
})

test('readFileSides has no old side for an untracked file', async () => {
  commitFile(repo, 'a.txt', 'a')
  writeFile(repo, 'n.png', 'x')
  const sides = await readFileSides(repo, { kind: 'working', path: 'n.png', staged: false, untracked: true })
  expect(sides.old).toBeNull()
  expect(sides.new?.size).toBe(1)
})
