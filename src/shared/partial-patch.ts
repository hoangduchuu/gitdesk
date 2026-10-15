export interface HunkSelection {
  /** Index of the hunk in the diff. */
  hunk: number
  /** Indexes of selected lines inside the hunk body, or null for the whole hunk. */
  lines: readonly number[] | null
}

interface RawHunk {
  oldStart: number
  newStart: number
  heading: string
  body: string[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

const splitDiff = (diff: string): { header: string[]; hunks: RawHunk[] } => {
  const header: string[] = []
  const hunks: RawHunk[] = []
  for (const line of diff.split('\n')) {
    const match = HUNK_HEADER.exec(line)
    if (match) {
      hunks.push({ oldStart: Number(match[1]), newStart: Number(match[2]), heading: match[3] ?? '', body: [] })
    } else if (hunks.length === 0) {
      if (line !== '') header.push(line)
    } else if (line !== '' && ' -+\\'.includes(line[0]!)) {
      hunks[hunks.length - 1]!.body.push(line)
    }
  }
  return { header, hunks }
}

/**
 * Keep only the selected changes of a hunk. Applied forward (stage), an unselected removal
 * stays as context and an unselected addition is dropped; applied in reverse (unstage,
 * discard) the roles swap, because the patch must match the side that has the additions.
 */
const filterBody = (body: readonly string[], selected: ReadonlySet<number> | null, reverse: boolean): string[] => {
  const kept: string[] = []
  let previousKept = false
  body.forEach((line, index) => {
    const marker = line[0]
    if (marker === '\\') {
      if (previousKept) kept.push(line)
      return
    }
    const isSelected = selected === null || selected.has(index)
    if (marker === ' ' || isSelected) {
      kept.push(line)
      previousKept = true
      return
    }
    const becomesContext = reverse ? marker === '+' : marker === '-'
    if (becomesContext) kept.push(` ${line.slice(1)}`)
    previousKept = becomesContext
  })
  return kept
}

const count = (body: readonly string[], markers: string): number =>
  body.filter((line) => markers.includes(line[0]!)).length

/** Build a patch with only the selected hunks/lines of a single-file diff, or null if nothing changes. */
export function buildPartialPatch(diff: string, selections: readonly HunkSelection[], reverse: boolean): string | null {
  const { header, hunks } = splitDiff(diff)
  const byHunk = new Map(selections.map((selection) => [selection.hunk, selection.lines]))
  const out: string[] = []
  let delta = 0

  hunks.forEach((hunk, index) => {
    if (!byHunk.has(index)) return
    const lines = byHunk.get(index)
    const body = filterBody(hunk.body, lines === null || lines === undefined ? null : new Set(lines), reverse)
    if (!body.some((line) => line[0] === '+' || line[0] === '-')) return
    const oldCount = count(body, ' -')
    const newCount = count(body, ' +')
    // Forward patches apply to the old side, reverse ones to the new side; keep that side's start.
    const oldStart = reverse ? hunk.newStart - delta : hunk.oldStart
    const newStart = reverse ? hunk.newStart : hunk.oldStart + delta
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunk.heading}`, ...body)
    delta += newCount - oldCount
  })

  return out.length === 0 ? null : [...header, ...out].join('\n') + '\n'
}
