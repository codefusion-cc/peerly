import { CornerUpLeft, Pencil, SendHorizontal, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { LIMITS } from '../../shared/app.ts'
import type { Channel, Message } from '../content/derive.ts'
import { useI18n } from '../i18nContext.ts'

/** What a message's actions ask of the composer. */
export type ComposerHandle = { reply(message: Message): void; edit(message: Message): void }

/** Writing a new message (perhaps as a reply), or changing one of one's own. */
type Mode = { kind: 'new'; reply?: Message } | { kind: 'edit'; message: Message; text: string }

const DRAFT_KEY = (channelId: string) => `peerly-draft:${channelId}`

function readDraft(channelId: string) {
  try {
    return sessionStorage.getItem(DRAFT_KEY(channelId)) ?? ''
  } catch {
    return ''
  }
}

/**
 * Writing a message: Enter sends, Shift+Enter starts a new line, ↑ in an empty
 * box edits one's last message, Escape stops replying or editing. The draft
 * of a new message is kept per channel (switching away and back loses
 * nothing) and stays untouched while a message is edited.
 */
export function Composer({ ref, channel, lastOwn, onSend, onEdit, onTyping }: {
  ref: Ref<ComposerHandle>
  channel: Channel
  /** One's own latest message here, for ↑. */
  lastOwn(): Message | null
  onSend(text: string, replyTo?: string): Promise<unknown>
  onEdit(message: Message, text: string): Promise<unknown>
  onTyping(): void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(() => readDraft(channel.id))
  const [mode, setMode] = useState<Mode>({ kind: 'new' })
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const text = mode.kind === 'edit' ? mode.text : draft
  const replying = mode.kind === 'new' ? mode.reply : undefined
  const setText = (value: string) => mode.kind === 'edit' ? setMode({ ...mode, text: value }) : setDraft(value)

  const startEdit = (message: Message) => { setFailed(false); setMode({ kind: 'edit', message, text: message.text }) }
  useImperativeHandle(ref, () => ({
    reply: message => { setFailed(false); setMode({ kind: 'new', reply: message }) },
    edit: startEdit,
  }), [])

  // Starting a reply or an edit puts the caret at the end of the box.
  const modeKey = mode.kind === 'edit' ? `edit:${mode.message.id}` : `new:${replying?.id ?? ''}`
  useLayoutEffect(() => {
    const element = box.current
    if (!element || modeKey === 'new:') return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [modeKey])

  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(DRAFT_KEY(channel.id), draft)
      else sessionStorage.removeItem(DRAFT_KEY(channel.id))
    } catch {
      // The draft lives in this box only.
    }
  }, [draft, channel.id])

  // The box grows with what is written, up to a limit, then scrolls.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`
  }, [text])

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const clean = text.trim()
    if (!clean) return
    setFailed(false)
    // The box is ready for the next message at once; a failure puts this one back.
    const sending = mode
    setMode({ kind: 'new' })
    if (sending.kind === 'new') setDraft('')
    try {
      if (sending.kind === 'edit') {
        if (clean !== sending.message.text) await onEdit(sending.message, clean)
      } else {
        await onSend(clean, sending.reply?.id)
      }
    } catch {
      if (sending.kind === 'new') setDraft(text)
      setMode(sending)
      setFailed(true)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape' && (mode.kind === 'edit' || replying)) {
      event.preventDefault()
      setMode({ kind: 'new' })
    } else if (event.key === 'ArrowUp' && !text && mode.kind === 'new' && !replying) {
      const message = lastOwn()
      if (!message) return
      event.preventDefault()
      startEdit(message)
    }
  }

  return (
    <form onSubmit={event => void submit(event)} className="mx-auto w-full max-w-(--container-thread) px-2 pb-3 sm:px-4">
      {(mode.kind === 'edit' || replying) && (
        <div className="flex items-center gap-2 rounded-t-box border border-b-0 border-base-300 bg-base-200 px-3 py-1.5 text-xs">
          {mode.kind === 'edit' ? <Pencil className="size-3.5" aria-hidden="true" /> : <CornerUpLeft className="size-3.5" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{mode.kind === 'edit' ? t.editingMessage : t.replyingTo(replying!.text)}</span>
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => { setMode({ kind: 'new' }); box.current?.focus() }} aria-label={t.cancel}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={`flex items-end gap-2 border border-base-300 bg-base-100 p-2 focus-within:border-primary ${mode.kind === 'edit' || replying ? 'rounded-b-box' : 'rounded-box'}`}>
        <label htmlFor="composer" className="sr-only">{t.messageTo(channel.name)}</label>
        <textarea id="composer" ref={box} rows={1} value={text} maxLength={LIMITS.messageText}
          onChange={event => { setText(event.target.value); if (event.target.value && mode.kind === 'new') onTyping() }} onKeyDown={onKeyDown}
          placeholder={t.messageTo(channel.name)} className="max-h-60 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 leading-relaxed outline-none"
          aria-describedby="composer-hint" enterKeyHint="send" />
        <button type="submit" className="btn btn-primary btn-sm btn-square" disabled={!text.trim()} aria-label={mode.kind === 'edit' ? t.saveEdit : t.send}>
          <SendHorizontal className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p id="composer-hint" className="sr-only">{t.composerHint}</p>
      {failed && <p role="alert" className="mt-1 text-xs text-error">{t.sendFailed}</p>}
    </form>
  )
}
