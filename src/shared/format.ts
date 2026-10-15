import type { ChangeKind } from './model'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** "5 minutes ago", "3 ngày trước"… for the graph's date markers, in the given locale. */
export function relativeAge(time: number, now: number, locale = 'en-US'): string {
  const elapsed = now - time
  if (elapsed < MINUTE) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < MONTH) return format.format(-Math.floor(elapsed / DAY), 'day')
  if (elapsed < YEAR) return format.format(-Math.floor(elapsed / MONTH), 'month')
  return format.format(-Math.floor(elapsed / YEAR), 'year')
}

/** Stable colour hue per author (by email), for local avatars. */
export function authorHue(email: string): number {
  let hash = 0
  for (const char of email.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

export type ChangeSummary = Partial<Record<'added' | 'modified' | 'deleted' | 'renamed', number>>

/** "5 modified, 9 added" style counts; untracked files count as added. */
export function changeSummary(files: ReadonlyArray<{ kind: ChangeKind }>): ChangeSummary {
  const summary: ChangeSummary = {}
  for (const { kind } of files) {
    const key = kind === 'untracked' || kind === 'copied' ? 'added' : kind === 'typechange' ? 'modified' : kind
    summary[key] = (summary[key] ?? 0) + 1
  }
  return summary
}

/** Show "3 days ago" on the last row of each run of rows with the same age (null = no time). */
export function ageMarkers(times: ReadonlyArray<number | null>, now: number, locale = 'en-US'): Array<string | null> {
  const labels = times.map((time) => (time === null ? null : relativeAge(time, now, locale)))
  return labels.map((label, index) => {
    if (label === null) return null
    const next = labels.slice(index + 1).find((value) => value !== null)
    return next === label ? null : label
  })
}
