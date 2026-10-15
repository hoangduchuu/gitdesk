import type { WorkingTreeStatus } from '../../../shared/model'
import { useT, useTCount } from '../i18n'
import { Icon } from '../icons'

interface Props {
  status: WorkingTreeStatus
  onContinue: () => void
  onAbort: () => void
}

/** Shown while a merge/rebase/cherry-pick/revert is stopped, or a stash left conflicts. */
export function OperationBanner({ status, onContinue, onAbort }: Props) {
  const t = useT()
  const tCount = useTCount()
  const conflicts = status.conflicted.length
  if (status.operation === null && conflicts === 0) return null

  const operation = status.operation ? t(`operation.${status.operation === 'cherry-pick' ? 'cherryPick' : status.operation}`) : ''
  const what = status.operation ? t('operation.inProgress', { operation }) : t('operation.changesWithConflicts')
  const detail =
    conflicts > 0
      ? tCount('operation.conflictedFiles', conflicts)
      : t('operation.allResolved')

  return (
    <div className="banner banner-warning" role="status">
      <strong>{what}.</strong> {detail}
      {status.operation && (
        <span className="banner-actions">
          <button type="button" className="ghost" onClick={onAbort}>
            <Icon name="abort" size={14} />{t('operation.abort')}
          </button>
          <button type="button" disabled={conflicts > 0} onClick={onContinue}>
            <Icon name="continue" size={14} />{t('operation.continue', { operation })}
          </button>
        </span>
      )}
    </div>
  )
}
