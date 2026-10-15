import { describe, expect, test } from 'vitest'
import { highlightLine, languageFor } from '../src/renderer/src/highlight'

describe('languageFor', () => {
  test.each([
    ['src/App.tsx', 'typescript'],
    ['index.mjs', 'javascript'],
    ['package.json', 'json'],
    ['styles.css', 'css'],
    ['page.html', 'xml'],
    ['query.SQL', 'sql'],
    ['README.md', 'markdown'],
    ['Dockerfile', 'dockerfile'],
    ['Makefile', 'makefile'],
    ['scripts/run.sh', 'bash'],
    ['notes.txt', null],
    ['no-extension', null]
  ])('%s -> %s', (path, language) => {
    expect(languageFor(path)).toBe(language)
  })
})

describe('highlightLine', () => {
  test('wraps tokens in highlight classes', () => {
    const html = highlightLine('import { lazy } from "react";', 'typescript')
    expect(html).toContain('<span class="hljs-keyword">import</span>')
    expect(html).toContain('<span class="hljs-string">&quot;react&quot;</span>')
  })

  test('escapes HTML in code so it is never interpreted', () => {
    const html = highlightLine('const x = "<script>alert(1)</script>"', 'typescript')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('escapes plain text when the language is unknown', () => {
    expect(highlightLine('<b>&</b>', null)).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
  })
})
