import type { ChangeKind, ConflictKind } from '../../../shared/model'
import { useT } from '../i18n'

export type IconKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted'

/** Map a file change to the GitKraken-style icon: pencil, plus, minus, arrow, or warning. */
export const iconKindFor = (kind: ChangeKind | ConflictKind): IconKind => {
  switch (kind) {
    case 'added':
    case 'untracked':
    case 'copied':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'modified':
    case 'typechange':
      return 'modified'
    default:
      return 'conflicted'
  }
}

const PATHS: Record<IconKind, string> = {
  // pencil
  modified: 'M11.3 2.3a1.2 1.2 0 0 1 1.7 0l.7.7a1.2 1.2 0 0 1 0 1.7L6 12.4 3 13l.6-3zM10.2 3.4l2.4 2.4',
  added: 'M8 3v10M3 8h10',
  deleted: 'M3 8h10',
  renamed: 'M3 8h9M9 4.5 12.5 8 9 11.5',
  conflicted: 'M8 3v6M8 12v.5'
}

const LABEL_KEYS: Record<IconKind, 'changeIcon.modified' | 'changeIcon.added' | 'changeIcon.deleted' | 'changeIcon.renamed' | 'changeIcon.conflicted'> = {
  modified: 'changeIcon.modified', added: 'changeIcon.added', deleted: 'changeIcon.deleted', renamed: 'changeIcon.renamed', conflicted: 'changeIcon.conflicted'
}

export function ChangeIcon({ kind }: { kind: IconKind }) {
  const t = useT()
  const label = t(LABEL_KEYS[kind])
  return (
    <svg className={`change-icon icon-${kind}`} viewBox="0 0 16 16" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={PATHS[kind]} />
    </svg>
  )
}
