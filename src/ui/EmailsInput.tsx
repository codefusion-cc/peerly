import { X } from 'lucide-react'
import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { normalizeEmail } from '../../shared/memberList.ts'
import { useI18n } from '../i18nContext.ts'

/**
 * Addresses as chips: typed (Enter, comma or space adds one), or pasted as a
 * list. Each is checked as it is added; a wrong one stays in the box to fix.
 */
export function EmailsInput({ emails, onChange, exclude = [], label, max }: {
  emails: string[]; onChange(emails: string[]): void; exclude?: string[]; label: string; max: number
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const add = (raw: string) => {
    const candidates = raw.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean)
    const next = [...emails]
    const rejected: string[] = []
    for (const candidate of candidates) {
      const email = normalizeEmail(candidate)
      if (!email) { rejected.push(candidate); continue }
      if (!next.includes(email) && !exclude.includes(email)) next.push(email)
    }
    if (next.length > max) { setError(t.tooManyMembers(max)); return }
    onChange(next)
    setDraft(rejected.join(' '))
    setError(rejected.length ? t.notAnEmail(rejected[0]) : null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', ';'].includes(event.key) && draft.trim()) {
      event.preventDefault()
      add(draft)
    } else if (event.key === 'Backspace' && !draft && emails.length) {
      onChange(emails.slice(0, -1))
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (/[\s,;]/.test(text)) { event.preventDefault(); add(`${draft} ${text}`) }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="input flex h-auto min-h-10 w-full flex-wrap items-center gap-1.5 py-1.5">
        {emails.map(email => (
          <span key={email} className="badge badge-soft badge-primary gap-1">
            {email}
            <button type="button" className="rounded-full hover:text-error" onClick={() => onChange(emails.filter(item => item !== email))} aria-label={t.removeEmail(email)}>
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input id={id} type="email" inputMode="email" autoComplete="off" className="min-w-40 flex-1" value={draft} placeholder={emails.length ? '' : t.emailsPlaceholder}
          onChange={event => { setDraft(event.target.value); setError(null) }} onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => draft.trim() && add(draft)}
          aria-invalid={error !== null} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-base-content/60">{t.emailsHint}</p>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-error">{error}</p>}
    </div>
  )
}
