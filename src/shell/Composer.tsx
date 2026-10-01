import { formatByteSize } from '@codefusion-cc/realtime/browser'
import { AlertCircle, CornerUpLeft, FileText, Loader2, Paperclip, Pencil, SendHorizontal, X } from 'lucide-react'
import {
  useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type Ref,
} from 'react'
import { LIMITS } from '../../shared/app.ts'
import type { Channel, Message } from '../content/derive.ts'
import { AttachError, prepareFile, type PreparedFile } from '../files/prepare.ts'
import { useI18n } from '../i18nContext.ts'

/** What a message's actions and the channel's drop zone ask of the composer. */
export type ComposerHandle = { reply(message: Message): void; edit(message: Message): void; attach(files: File[]): void }

/** Writing a new message (perhaps as a reply), or changing one of one's own. */
type Mode = { kind: 'new'; reply?: Message } | { kind: 'edit'; message: Message; text: string }

/** A file in the tray: being read, ready to send, or refused. */
type Attachment = { key: string; name: string; size: number } & (
  | { state: 'preparing' }
  | { state: 'ready'; prepared: PreparedFile }
  | { state: 'refused'; reason: AttachError['reason'] }
)

/** What sending answers: how many files the cloud did not keep (members get them from this device). */
export type SendResult = { notKept?: number } | void

const DRAFT_KEY = (channelId: string) => `peerly-draft:${channelId}`

function readDraft(channelId: string) {
  try {
    return sessionStorage.getItem(DRAFT_KEY(channelId)) ?? ''
  } catch {
    return ''
  }
}

let attachmentKeys = 0

/**
 * Writing a message: Enter sends, Shift+Enter starts a new line, ↑ in an empty
 * box edits one's last message, Escape stops replying or editing. Files come
 * from the paperclip, a paste or a drop on the channel, up to ten a message.
 * The draft of a new message is kept per channel (switching away and back
 * loses nothing) and stays untouched while a message is edited.
 */
export function Composer({ ref, channel, lastOwn, onSend, onEdit, onTyping }: {
  ref: Ref<ComposerHandle>
  channel: Channel
  /** One's own latest message here, for ↑. */
  lastOwn(): Message | null
  onSend(text: string, replyTo: string | undefined, files: PreparedFile[], onProgress: (fraction: number) => void): Promise<SendResult>
  onEdit(message: Message, text: string): Promise<unknown>
  onTyping(): void
}) {
  const { t, locale } = useI18n()
  const [draft, setDraft] = useState(() => readDraft(channel.id))
  const [mode, setMode] = useState<Mode>({ kind: 'new' })
  const [failed, setFailed] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const text = mode.kind === 'edit' ? mode.text : draft
  const replying = mode.kind === 'new' ? mode.reply : undefined
  const setText = (value: string) => mode.kind === 'edit' ? setMode({ ...mode, text: value }) : setDraft(value)
  const ready = attachments.flatMap(item => item.state === 'ready' ? [item.prepared] : [])
  const preparing = attachments.some(item => item.state === 'preparing')
  const refused = attachments.some(item => item.state === 'refused')

  // What the tray holds now, even before React renders it: two drops in one moment still respect the limit.
  const tray = useRef(attachments)
  tray.current = attachments
  const attach = (files: File[]) => {
    if (!files.length) return
    setNotice(null)
    const room = LIMITS.filesPerMessage - tray.current.length
    if (files.length > room) setNotice(t.tooManyFiles(LIMITS.filesPerMessage))
    const added = files.slice(0, Math.max(0, room)).map(file => ({ file, item: { key: `a${++attachmentKeys}`, name: file.name, size: file.size, state: 'preparing' as const } }))
    if (!added.length) return
    tray.current = [...tray.current, ...added.map(({ item }) => item)]
    setAttachments(list => [...list, ...added.map(({ item }) => item)])
    for (const { file, item } of added) {
      void prepareFile(file).then(
        prepared => setAttachments(list => list.map(entry => entry.key === item.key ? { ...item, name: prepared.ref.name, state: 'ready', prepared } : entry)),
        error => setAttachments(list => list.map(entry => entry.key === item.key
          ? { ...item, state: 'refused', reason: error instanceof AttachError ? error.reason : 'unreadable' } : entry)),
      )
    }
    box.current?.focus()
  }

  const startEdit = (message: Message) => { setFailed(false); setMode({ kind: 'edit', message, text: message.text }) }
  useImperativeHandle(ref, () => ({
    reply: message => { setFailed(false); setMode({ kind: 'new', reply: message }) },
    edit: startEdit,
    attach,
  }))

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

  // The box grows with what is written, up to a limit, then scrolls; a change of its width (a turned phone) measures again.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const fit = () => {
      element.style.height = 'auto'
      element.style.height = `${Math.min(element.scrollHeight, 240)}px`
    }
    fit()
    let width = element.offsetWidth
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return
      width = element.offsetWidth
      fit()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const withFiles = mode.kind === 'new' && attachments.length > 0
  const canSend = sending === null && !preparing && !(withFiles && refused) && (text.trim() !== '' || (mode.kind === 'new' && ready.length > 0))

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) return
    const clean = text.trim()
    setFailed(false)
    setNotice(null)
    if (mode.kind === 'edit') {
      if (!clean) return
      const sending = mode
      setMode({ kind: 'new' })
      try {
        if (clean !== sending.message.text) await onEdit(sending.message, clean)
      } catch {
        setMode(sending)
        setFailed(true)
      }
      return
    }
    // The box is ready for the next message at once; a failure puts this one back.
    const sent = { mode, draft, attachments }
    setMode({ kind: 'new' })
    setDraft('')
    if (ready.length) setSending(0)
    try {
      const result = await onSend(clean, sent.mode.reply?.id, ready, fraction => setSending(fraction))
      setAttachments([])
      if (result && result.notKept) setNotice(t.filesNotKept(result.notKept))
    } catch {
      setDraft(sent.draft)
      setMode(sent.mode)
      setAttachments(sent.attachments)
      setFailed(true)
    } finally {
      setSending(null)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape' && (mode.kind === 'edit' || replying)) {
      event.preventDefault()
      setMode({ kind: 'new' })
    } else if (event.key === 'ArrowUp' && !text && mode.kind === 'new' && !replying && !attachments.length) {
      const message = lastOwn()
      if (!message) return
      event.preventDefault()
      startEdit(message)
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (mode.kind !== 'new') return
    const files = [...event.clipboardData.files]
    if (!files.length) return
    event.preventDefault()
    attach(files)
  }

  const refusal = (reason: AttachError['reason']) => reason === 'too-large' ? t.fileTooLarge(formatByteSize(LIMITS.fileBytes, locale)) : t.fileUnreadable

  return (
    <form onSubmit={event => void submit(event)} className="mx-auto w-full max-w-(--container-thread) px-2 pb-3 sm:px-4">
      {(mode.kind === 'edit' || replying) && (
        <div className="flex items-center gap-2 rounded-t-box border border-b-0 border-base-300 bg-base-200 px-3 py-1.5 text-xs">
          {mode.kind === 'edit' ? <Pencil className="size-3.5" aria-hidden="true" /> : <CornerUpLeft className="size-3.5" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{mode.kind === 'edit' ? t.editingMessage : t.replyingTo(replying!.text || replying!.files[0]?.name || '')}</span>
          <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => { setMode({ kind: 'new' }); box.current?.focus() }} aria-label={t.cancel}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={`border border-base-300 bg-base-100 focus-within:border-primary ${mode.kind === 'edit' || replying ? 'rounded-b-box' : 'rounded-box'}`}>
        {withFiles && (
          <ul className="scroll-quiet flex gap-2 overflow-x-auto border-b border-base-300 p-2" aria-label={t.attachmentsLabel}>
            {attachments.map(item => (
              <li key={item.key} className={`flex w-56 shrink-0 items-center gap-2 rounded-field border p-1.5 ${item.state === 'refused' ? 'border-error/50 bg-error/5' : 'border-base-300 bg-base-200'}`}>
                {item.state === 'ready' && item.prepared.ref.preview
                  ? <img src={item.prepared.ref.preview} alt="" className="size-9 shrink-0 rounded object-cover" />
                  : <span className="grid size-9 shrink-0 place-items-center rounded bg-base-100">
                      {item.state === 'preparing' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        : item.state === 'refused' ? <AlertCircle className="size-4 text-error" aria-hidden="true" />
                          : <FileText className="size-4 text-base-content/60" aria-hidden="true" />}
                    </span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium" title={item.name}>{item.name}</span>
                  <span className={`block truncate text-xs ${item.state === 'refused' ? 'text-error' : 'text-base-content/60'}`}>
                    {item.state === 'preparing' ? t.preparingFile : item.state === 'refused' ? refusal(item.reason) : formatByteSize(item.size, locale)}
                  </span>
                </span>
                <button type="button" className="btn btn-ghost btn-xs btn-square" disabled={sending !== null} aria-label={t.removeAttachment(item.name)}
                  onClick={() => setAttachments(list => list.filter(entry => entry.key !== item.key))}>
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {sending !== null && (
          <div className="border-b border-base-300 px-3 py-2" role="status">
            <p className="mb-1 text-xs text-base-content/70">{t.sendingFiles(Math.round(sending * 100))}</p>
            <progress className="progress progress-primary h-1 w-full" value={Math.round(sending * 100)} max={100} />
          </div>
        )}
        <div className="flex items-end gap-1 p-2">
          {mode.kind === 'new' && <>
            <input ref={picker} type="file" multiple hidden tabIndex={-1} aria-hidden="true"
              onChange={event => { attach([...(event.target.files ?? [])]); event.target.value = '' }} />
            <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={() => picker.current?.click()}
              disabled={sending !== null || attachments.length >= LIMITS.filesPerMessage} aria-label={t.attachFiles} title={t.attachFiles}>
              <Paperclip className="size-4" aria-hidden="true" />
            </button>
          </>}
          <label htmlFor="composer" className="sr-only">{t.messageTo(channel.name)}</label>
          <textarea id="composer" ref={box} rows={1} value={text} maxLength={LIMITS.messageText} disabled={sending !== null}
            onChange={event => { setText(event.target.value); if (event.target.value && mode.kind === 'new') onTyping() }} onKeyDown={onKeyDown} onPaste={onPaste}
            placeholder={t.messageTo(channel.name)} className="max-h-60 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 leading-relaxed outline-none"
            aria-describedby="composer-hint" enterKeyHint="send" />
          <button type="submit" className="btn btn-primary btn-sm btn-square" disabled={!canSend} aria-label={mode.kind === 'edit' ? t.saveEdit : t.send}>
            {sending !== null ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <SendHorizontal className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p id="composer-hint" className="sr-only">{t.composerHint}</p>
      {withFiles && refused && <p role="alert" className="mt-1 text-xs text-error">{t.removeRefusedFiles}</p>}
      {failed && <p role="alert" className="mt-1 text-xs text-error">{t.sendFailed}</p>}
      {notice && <p role="status" className="mt-1 text-xs text-base-content/70">{notice}</p>}
    </form>
  )
}
