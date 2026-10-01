import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@codefusion-cc/theme/react'
import { useI18n } from '../i18nContext.tsx'
import { theme } from '../theme.ts'

/** Light, dark or the system's, as one segmented control. */
export function ThemePicker() {
  const { t } = useI18n()
  const { mode } = useTheme(theme)
  const options = [
    { value: 'light', label: t.themeLight, Icon: Sun },
    { value: 'dark', label: t.themeDark, Icon: Moon },
    { value: 'system', label: t.themeSystem, Icon: Monitor },
  ] as const
  return (
    <div role="radiogroup" aria-label={t.theme} className="join">
      {options.map(({ value, label, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value}
          className={`btn join-item btn-sm gap-1.5 ${mode === value ? 'btn-primary' : 'btn-ghost border-base-300'}`}
          onClick={() => theme.setMode(value)}>
          <Icon className="size-4" aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  )
}
