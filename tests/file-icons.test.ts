import { describe, expect, test } from 'vitest'
import manifest from 'material-icon-theme/dist/material-icons.json'
import { fileIconName, folderIconName, type IconManifest } from '../src/shared/file-icons'

const icons = manifest as unknown as IconManifest

describe('fileIconName', () => {
  test.each([
    ['src/Controller.php', 'php'],
    ['lib/main.dart', 'dart'],
    ['Dockerfile', 'docker'],
    ['deploy/docker-compose.yml', 'docker'],
    ['src/App.tsx', 'react_ts'],
    ['src/utils.ts', 'typescript'],
    ['src/utils.test.ts', 'test-ts'],
    ['package.json', 'nodejs'],
    ['styles/index.module.scss', 'sass'],
    ['README.md', 'readme'],
    ['.gitignore', 'git'],
    ['notes.unknownext', 'file']
  ])('%s -> %s', (path, icon) => {
    expect(fileIconName(icons, path)).toBe(icon)
  })
})

describe('folderIconName', () => {
  test('uses named folder icons, open and closed', () => {
    expect(folderIconName(icons, 'src', false)).toBe('folder-src')
    expect(folderIconName(icons, 'src', true)).toBe('folder-src-open')
  })

  test('uses the last segment of a compacted folder and falls back to a plain folder', () => {
    expect(folderIconName(icons, 'shared/database', false)).toBe('folder-database')
    expect(folderIconName(icons, 'no-such-folder-name', false)).toBe('folder')
    expect(folderIconName(icons, 'no-such-folder-name', true)).toBe('folder-open')
  })
})
