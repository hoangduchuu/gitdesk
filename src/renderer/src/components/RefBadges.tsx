import type { Ref } from '../../../shared/types'

export function RefBadges({ refs }: { refs: readonly Ref[] }) {
  return (
    <>
      {refs.map((ref) => (
        <span key={`${ref.kind}:${ref.name}`} className={`ref-badge ref-${ref.kind}`}>
          {ref.name}
        </span>
      ))}
    </>
  )
}
