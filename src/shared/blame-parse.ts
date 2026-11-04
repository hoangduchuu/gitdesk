import type { BlameLine } from './model'

const HEADER = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/

/** Hash `git blame` reports for lines that are not committed yet. */
export const UNCOMMITTED_HASH_PATTERN = /^0+$/

interface CommitInfo {
  author: string
  time: number
  summary: string
  path: string
  boundary: boolean
}

/**
 * Parse `git blame --porcelain`. Each line of the file is a header (`<hash> <orig> <final> [<count>]`),
 * then commit details, then the line itself prefixed with a tab. The details only come the first
 * time a commit appears, so they are remembered by hash. A blank line of the file is a bare tab.
 */
export function parseBlame(text: string): BlameLine[] {
  const commits = new Map<string, CommitInfo>()
  const lines: BlameLine[] = []
  let hash = ''
  let finalLine = 0
  let info: CommitInfo = { author: '', time: 0, summary: '', path: '', boundary: false }

  for (const row of text.split('\n')) {
    if (row.startsWith('\t')) {
      lines.push({ line: finalLine, hash, text: row.slice(1), ...info })
      continue
    }
    const header = HEADER.exec(row)
    if (header) {
      hash = header[1]!
      finalLine = Number(header[2])
      const known = commits.get(hash)
      if (known) info = known
      else {
        info = { author: '', time: 0, summary: '', path: '', boundary: false }
        commits.set(hash, info)
      }
      continue
    }
    // Details are written to the object registered for this hash, so later lines of it share them.
    if (row.startsWith('author ')) info.author = row.slice('author '.length)
    else if (row.startsWith('author-time ')) info.time = Number(row.slice('author-time '.length))
    else if (row.startsWith('summary ')) info.summary = row.slice('summary '.length)
    else if (row.startsWith('filename ')) info.path = row.slice('filename '.length)
    else if (row === 'boundary') info.boundary = true
  }
  return lines
}
