import { useT, type MessageKey } from '../i18n'
import { LINE_WIDTH_PX, updateSettings, useSettings, type GraphLineWidth, type Language, type Theme } from '../hooks/useSettings'
import { PALETTES, type PaletteName } from '../palettes'
import { Icon } from '../icons'

const THEMES: ReadonlyArray<[Theme, MessageKey]> = [
  ['dark', 'settings.theme.dark'],
  ['light', 'settings.theme.light']
]

/** Language names are written in their own language so anyone can find theirs. */
const LANGUAGES: ReadonlyArray<[Language, string]> = [
  ['en', 'English'],
  ['vi', 'Tiếng Việt']
]

const WIDTHS: ReadonlyArray<[GraphLineWidth, MessageKey]> = [
  ['thin', 'settings.width.thin'],
  ['normal', 'settings.width.normal'],
  ['thick', 'settings.width.thick']
]

const PALETTE_LABELS: Record<PaletteName, MessageKey> = {
  vivid: 'settings.palette.vivid',
  pastel: 'settings.palette.pastel',
  ocean: 'settings.palette.ocean',
  colorblind: 'settings.palette.colorblind'
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const t = useT()

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{t('settings.title')}</h2>

        <fieldset className="settings-group">
          <legend><Icon name="themeDark" size={14} />{t('settings.theme')}</legend>
          <div className="segmented">
            {THEMES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.theme === value ? 'active' : 'ghost'}
                onClick={() => updateSettings({ theme: value })}
              >
                <Icon name={value === 'dark' ? 'themeDark' : 'themeLight'} size={14} />
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend><Icon name="language" size={14} />{t('settings.language')}</legend>
          <div className="segmented">
            {LANGUAGES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.language === value ? 'active' : 'ghost'}
                onClick={() => updateSettings({ language: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend><Icon name="palette" size={14} />{t('settings.graphColors')}</legend>
          {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
            <label key={name} className="settings-option">
              <input
                type="radio"
                name="graph-palette"
                checked={settings.graphPalette === name}
                onChange={() => updateSettings({ graphPalette: name })}
              />
              <span className="settings-label wide">{t(PALETTE_LABELS[name])}</span>
              <span className="palette-swatches" aria-hidden>
                {PALETTES[name].map((color) => (
                  <span key={color} className="swatch" style={{ background: color }} />
                ))}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-group">
          <legend><Icon name="lineWidth" size={14} />{t('settings.graphLineWidth')}</legend>
          {WIDTHS.map(([value, label]) => (
            <label key={value} className="settings-option">
              <input
                type="radio"
                name="graph-line-width"
                checked={settings.graphLineWidth === value}
                onChange={() => updateSettings({ graphLineWidth: value })}
              />
              <span className="settings-label">{t(label)}</span>
              <svg width="80" height="12" aria-hidden>
                <line
                  x1="4"
                  y1="6"
                  x2="76"
                  y2="6"
                  stroke={PALETTES[settings.graphPalette][0]}
                  strokeWidth={LINE_WIDTH_PX[value]}
                  strokeLinecap="round"
                />
              </svg>
            </label>
          ))}
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
