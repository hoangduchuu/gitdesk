import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGUAGES = {
  bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, makefile,
  markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml
}
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'scss',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  sql: 'sql', md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', rs: 'rust',
  rb: 'ruby', php: 'php', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  yml: 'yaml', yaml: 'yaml', ini: 'ini', toml: 'ini', env: 'ini'
}

const BY_NAME: Record<string, keyof typeof LANGUAGES> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile'
}

export type Language = keyof typeof LANGUAGES

/** Highlight language for a repository path, or null for plain text. */
export function languageFor(path: string): Language | null {
  const file = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (BY_NAME[file]) return BY_NAME[file]
  const dot = file.lastIndexOf('.')
  if (dot <= 0) return null
  return BY_EXTENSION[file.slice(dot + 1)] ?? null
}

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')

/**
 * HTML for one line of code. highlight.js escapes the source text itself; unknown
 * languages are escaped here, so the result is always safe to insert.
 * Lines are highlighted one at a time, so constructs spanning lines (block comments,
 * template strings) may be coloured as if they started on each line.
 */
export function highlightLine(text: string, language: Language | null): string {
  if (language === null) return escapeHtml(text)
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}
