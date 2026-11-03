export interface CommonSegment {
  kind: 'common'
  text: string
}

export interface ConflictSegment {
  kind: 'conflict'
  index: number
  ours: string
  /** Common ancestor text, present with `merge.conflictStyle = diff3`/`zdiff3`. */
  base: string | null
  theirs: string
  oursLabel: string
  theirsLabel: string
}

export type Segment = CommonSegment | ConflictSegment

export type ConflictChoice = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first'

/** A hand-picked mix: which lines of each side to keep, and which side comes first. */
export interface LineChoice {
  kind: 'lines'
  ours: boolean[]
  theirs: boolean[]
  theirsFirst: boolean
}

export type BlockChoice = ConflictChoice | LineChoice

const MARKER_LENGTH = 7

/** True when `line` is `marker` repeated seven times, followed by a space or the end of the line. */
const isMarker = (line: string, char: string): boolean => {
  if (!line.startsWith(char.repeat(MARKER_LENGTH))) return false
  const next = line[MARKER_LENGTH]
  return next === undefined || next === ' ' || next === '\n' || next === '\r'
}

const label = (line: string): string => line.slice(MARKER_LENGTH).trim()

/** Split into lines that keep their own line endings, so reassembly is byte-exact. */
const splitLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Parse a working-tree file containing git conflict markers. */
export function parseConflictMarkers(text: string): Segment[] {
  const lines = splitLines(text)
  const segments: Segment[] = []
  let common = ''
  let conflictIndex = 0

  const flushCommon = (): void => {
    if (common !== '') segments.push({ kind: 'common', text: common })
    common = ''
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!isMarker(line, '<')) {
      common += line
      i++
      continue
    }

    let j = i + 1
    let ours = ''
    let base: string | null = null
    let theirs = ''
    let section: 'ours' | 'base' | 'theirs' = 'ours'
    let closed = false
    for (; j < lines.length; j++) {
      const inner = lines[j]!
      if (section === 'ours' && isMarker(inner, '|')) {
        section = 'base'
        base = ''
      } else if (section !== 'theirs' && isMarker(inner, '=')) {
        section = 'theirs'
      } else if (section === 'theirs' && isMarker(inner, '>')) {
        closed = true
        break
      } else if (section === 'ours') ours += inner
      else if (section === 'base') base += inner
      else theirs += inner
    }

    if (!closed) {
      // Not a real conflict block: keep the rest verbatim.
      common += lines.slice(i).join('')
      break
    }

    flushCommon()
    segments.push({
      kind: 'conflict',
      index: conflictIndex++,
      ours,
      base,
      theirs,
      oursLabel: label(line),
      theirsLabel: label(lines[j]!)
    })
    i = j + 1
  }
  flushCommon()
  return segments
}

/** The lines of one side of a conflict, each keeping its line ending. */
export const linesOf = (text: string): string[] => splitLines(text)

/** Which lines of each side a choice keeps; nothing is kept while the conflict is unresolved. */
export function selectedLines(segment: ConflictSegment, choice: BlockChoice | null): { ours: boolean[]; theirs: boolean[]; theirsFirst: boolean } {
  const ours = linesOf(segment.ours)
  const theirs = linesOf(segment.theirs)
  const fill = (lines: string[], on: boolean): boolean[] => lines.map(() => on)
  if (choice === null) return { ours: fill(ours, false), theirs: fill(theirs, false), theirsFirst: false }
  if (typeof choice === 'object') return choice
  return {
    ours: fill(ours, choice !== 'theirs'),
    theirs: fill(theirs, choice !== 'ours'),
    theirsFirst: choice === 'both-theirs-first'
  }
}

const resolveSegment = (segment: ConflictSegment, choice: BlockChoice): string => {
  if (typeof choice === 'object') {
    const keep = (text: string, flags: boolean[]): string => linesOf(text).filter((_, i) => flags[i]).join('')
    const ours = keep(segment.ours, choice.ours)
    const theirs = keep(segment.theirs, choice.theirs)
    return choice.theirsFirst ? theirs + ours : ours + theirs
  }
  switch (choice) {
    case 'ours':
      return segment.ours
    case 'theirs':
      return segment.theirs
    case 'both-ours-first':
      return segment.ours + segment.theirs
    case 'both-theirs-first':
      return segment.theirs + segment.ours
  }
}

/** Build the resolved file, or null while any conflict has no choice yet. */
export function buildResolution(
  segments: readonly Segment[],
  choices: ReadonlyArray<BlockChoice | null>
): string | null {
  let result = ''
  for (const segment of segments) {
    if (segment.kind === 'common') {
      result += segment.text
      continue
    }
    const choice = choices[segment.index]
    if (choice === null || choice === undefined) return null
    result += resolveSegment(segment, choice)
  }
  return result
}

export const hasConflictMarkers = (text: string): boolean =>
  splitLines(text).some((line) => isMarker(line, '<') || isMarker(line, '>'))
