import { formatClockTime, splitSafeLinks } from '@codefusion-cc/realtime/browser'
import { useClockFormat, useMessageActionMenu } from '@codefusion-cc/realtime/react'
import { Copy, CornerUpLeft, Link2, MoreHorizontal, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Account } from '../auth/session.ts'
import type { Message } from '../content/derive.ts'
import { useI18n } from '../i18nContext.ts'
import type { WorkspaceFiles } from '../files/workspaceFiles.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { MessageFiles } from './MessageFiles.tsx'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🙏'] as const

/** Copies text, quietly: the clipboard can be refused, and nothing on screen depends on it. */
const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => {}) }

/** One message: who and when on the first of a group, the text, reactions, and its actions on hover, focus or tap. */
export const MessageItem = memo(function MessageItem({ message, first, account, author, names, replyTo, replyAuthor, onReply, onEdit, onDelete, onReact, files }: {
  message: Message
  first: boolean
  account: Account
  /** The author's name as this device knows it. */
  author: string
  /** Who reacted, by user id, as this device knows them. */
  names: (userId: string) => string
  /** The message replied to: null when this device does not have it. */
  replyTo: Message | null
  replyAuthor: string
  onReply(message: Message): void
  onEdit(message: Message): void
  onDelete(message: Message): void
  onReact(message: Message, emoji: string, on: boolean): void
  /** The workspace's files, which the message's own are shown and saved from. */
  files: WorkspaceFiles
}) {
  const { t, locale } = useI18n()
  const { clockFormat } = useClockFormat()
  const mine = message.by === account.userId
  const reacted = (emoji: string) => message.reactions.some(reaction => reaction.emoji === emoji && reaction.by.includes(account.userId))
  const menu = useMessageActionMenu({ text: message.text, onReact: emoji => onReact(message, emoji, !reacted(emoji)) })
  const time = formatClockTime(message.at, { clockFormat, locale })
  const full = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(message.at), [locale, message.at])
  const parts = useMemo(() => splitSafeLinks(message.text), [message.text])
  const stamp = new Date(message.at).toISOString()
  const open = menu.panel !== null
  // Focus on the message (a tab, a tap) shows its actions and lets Tab reach them; otherwise Tab skips them.
  const [focused, setFocused] = useState(false)
  const actionsShown = open || focused
  const tab = actionsShown ? 0 : -1
  // An opened menu takes focus at its first item, and gives it back to the button that opened it.
  const opener = useRef<HTMLButtonElement | null>(null)
  const { panelRef, position: { visible } } = menu
  useEffect(() => {
    if (!open || !visible) return
    const panel = panelRef.current
    panel?.querySelector<HTMLButtonElement>('button')?.focus()
    const back = opener.current
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || panel?.contains(active)) back?.focus()
    }
  }, [open, visible, panelRef])

  return (
    <li tabIndex={0} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
      className={`group relative flex gap-3 rounded-box px-2 py-0.5 hover:bg-base-200/60 focus-within:bg-base-200/60 ${open ? 'bg-base-200/60' : ''} ${first ? 'mt-3' : ''}`}>
      <div className="w-9 shrink-0 pt-0.5">
        {first ? <Avatar name={author} seed={message.by} size="sm" /> : (
          <time dateTime={stamp} title={full} className="invisible block pt-1 text-right text-2xs text-base-content/50 group-hover:visible group-focus-within:visible">{time}</time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {first && (
          <p className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{author}</span>
            <time dateTime={stamp} title={full} className="shrink-0 text-xs text-base-content/50">{time}</time>
          </p>
        )}
        {message.reply && (
          <p className="mb-0.5 flex min-w-0 items-center gap-1 border-l-2 border-base-300 pl-2 text-xs text-base-content/60">
            <CornerUpLeft className="size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t.inReplyTo}</span>
            {replyTo ? <>
              <span className="shrink-0 font-medium">{replyAuthor}</span>
              <span className="truncate">{replyTo.deleted ? t.messageDeleted : replyTo.text || replyTo.files[0]?.name}</span>
            </> : <span className="italic">{t.originalMessage}</span>}
          </p>
        )}
        {message.deleted ? (
          <p className="text-sm italic text-base-content/50">{t.messageDeleted}</p>
        ) : message.text && (
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {parts.map((part, index) => part.kind === 'link'
              ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="link link-primary wrap-anywhere">{part.value}</a>
              : part.value)}
            {message.editedAt !== undefined && (
              <span className="ml-1 text-xs text-base-content/50" title={new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(message.editedAt)}>({t.edited})</span>
            )}
          </p>
        )}
        {!message.deleted && message.files.length > 0 && <MessageFiles files={files} refs={message.files} />}
        {message.reactions.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1" aria-label={t.reactions}>
            {message.reactions.map(reaction => {
              const own = reaction.by.includes(account.userId)
              const who = reaction.by.map(userId => userId === account.userId ? t.you : names(userId)).join(', ')
              return (
                <li key={reaction.emoji}>
                  <button type="button" onClick={() => onReact(message, reaction.emoji, !own)} aria-pressed={own} title={who}
                    aria-label={t.reactionLabel(reaction.emoji, reaction.by.length, who)}
                    className={`badge h-6 gap-1 ${own ? 'badge-primary badge-soft border-primary/40' : 'badge-ghost'}`}>
                    <span aria-hidden="true">{reaction.emoji}</span><span className="text-xs tabular-nums">{reaction.by.length}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!message.deleted && (
        <div ref={menu.rootRef} role="toolbar" aria-label={t.messageActions}
          className={`absolute -top-3 right-2 items-center gap-0.5 rounded-field border border-base-300 bg-base-100 p-0.5 shadow-sm ${actionsShown ? 'flex' : 'hidden group-hover:flex'}`}>
          <button type="button" tabIndex={tab} className="btn btn-ghost btn-xs btn-square" aria-label={t.addReaction} aria-expanded={menu.panel === 'quick'}
            onClick={event => { opener.current = event.currentTarget; menu.togglePanel('quick') }}><SmilePlus className="size-4" aria-hidden="true" /></button>
          <button type="button" tabIndex={tab} className="btn btn-ghost btn-xs btn-square" aria-label={t.reply} onClick={() => onReply(message)}>
            <CornerUpLeft className="size-4" aria-hidden="true" />
          </button>
          {mine && (
            <button type="button" tabIndex={tab} className="btn btn-ghost btn-xs btn-square" aria-label={t.editMessage} onClick={() => onEdit(message)}>
              <Pencil className="size-4" aria-hidden="true" />
            </button>
          )}
          <button type="button" tabIndex={tab} className="btn btn-ghost btn-xs btn-square" aria-label={t.more} aria-expanded={menu.panel === 'more'} aria-haspopup="menu"
            onClick={event => { opener.current = event.currentTarget; menu.togglePanel('more') }}><MoreHorizontal className="size-4" aria-hidden="true" /></button>
        </div>
      )}

      {open && createPortal(
        <div ref={menu.panelRef} style={{ left: menu.position.left, top: menu.position.top }}
          className={`fixed z-40 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg ${menu.position.visible ? '' : 'invisible'}`}>
          {menu.panel === 'quick' ? (
            <div role="group" aria-label={t.addReaction} className="flex gap-0.5">
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} type="button" className={`btn btn-ghost btn-sm btn-square text-lg ${reacted(emoji) ? 'btn-active' : ''}`}
                  aria-label={t.reactWith(emoji)} aria-pressed={reacted(emoji)} onClick={() => menu.chooseReaction(emoji)}>
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          ) : (
            <ul role="menu" className="menu w-52 p-0">
              {message.text && <li role="none"><button type="button" role="menuitem" onClick={() => { copy(message.text); menu.closePanel() }}>
                <Copy className="size-4" aria-hidden="true" />{t.copyText}
              </button></li>}
              {menu.firstUrl && <li role="none"><button type="button" role="menuitem" onClick={() => { copy(menu.firstUrl!); menu.closePanel() }}>
                <Link2 className="size-4" aria-hidden="true" />{t.copyLink}
              </button></li>}
              {mine && <li role="none"><button type="button" role="menuitem" className="text-error" onClick={() => { menu.closePanel(); onDelete(message) }}>
                <Trash2 className="size-4" aria-hidden="true" />{t.deleteMessage}
              </button></li>}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </li>
  )
})
