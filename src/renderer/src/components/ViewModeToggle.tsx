import { setFileViewMode, useFileViewMode, type FileViewMode } from '../hooks/useFileViewMode'
import { useT, type MessageKey } from '../i18n'
import { Icon, type IconName } from '../icons'

const MODES: ReadonlyArray<[FileViewMode, IconName, MessageKey]> = [
  ['path', 'pathView', 'viewMode.path'],
  ['tree', 'treeView', 'viewMode.tree']
]

/** "Path | Tree" switch, as in GitKraken's file panels. */
export function ViewModeToggle() {
  const t = useT()
  const mode = useFileViewMode()
  return (
    <span className="view-toggle" role="group" aria-label={t('viewMode.label')}>
      {MODES.map(([value, icon, label]) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : 'ghost'}
          aria-pressed={mode === value}
          onClick={() => setFileViewMode(value)}
        >
          <Icon name={icon} size={13} />
          {t(label)}
        </button>
      ))}
    </span>
  )
}
