export interface DiffLine {
  kind: 'context' | 'added' | 'removed' | 'note'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface ParsedDiff {
  binary: boolean
  hunks: DiffHunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Parse the unified diff of a single file. */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const hunks: DiffHunk[] = []
  let binary = false
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of text.split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header) {
      current = { header: line, lines: [] }
      hunks.push(current)
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (current === null) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true
      continue
    }
    const marker = line[0]
    const body = line.slice(1)
    if (marker === ' ') current.lines.push({ kind: 'context', text: body, oldLine: oldLine++, newLine: newLine++ })
    else if (marker === '-') current.lines.push({ kind: 'removed', text: body, oldLine: oldLine++, newLine: null })
    else if (marker === '+') current.lines.push({ kind: 'added', text: body, oldLine: null, newLine: newLine++ })
    else if (marker === '\\') current.lines.push({ kind: 'note', text: body.trim(), oldLine: null, newLine: null })
  }
  return { binary, hunks }
}

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * Lay a hunk out for side-by-side display: context lines on both sides, and each run of removed
 * lines next to the run of added lines that follows it.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.kind === 'context' || line.kind === 'note') {
      rows.push({ left: line, right: line })
      i++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (lines[i]?.kind === 'removed') removed.push(lines[i++]!)
    while (lines[i]?.kind === 'added') added.push(lines[i++]!)
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null })
    }
  }
  return rows
}
