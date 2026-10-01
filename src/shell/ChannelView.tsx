import { groupConsecutiveMessages } from '@codefusion-cc/realtime/browser'
import { ArrowDown, ArrowLeft, Hash, Info, Loader2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import type { Account } from '../auth/session.ts'
import type { Channel, Message } from '../content/derive.ts'
import { useI18n } from '../i18nContext.ts'
import { navigate } from '../router.ts'
import type { SessionView, WorkspaceSession } from '../workspaces/session.ts'
import { useChannel } from '../workspaces/useWorkspace.ts'
import type { Workspace } from '../workspaces/workspaces.ts'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { MessageItem } from './MessageItem.tsx'

/** A channel: its messages, newest at the bottom, and the composer. */
export function ChannelView({ account, workspace, session, view, channel }: {
  account: Account; workspace: Workspace; session: WorkspaceSession; view: SessionView; channel: Channel
}) {
  const { t, locale } = useI18n()
  const state = useChannel(session, channel.id)
  const scroller = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [unseen, setUnseen] = useState(0)
  const composer = useRef<ComposerHandle>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  const lastCount = useRef(0)
  const restore = useRef<number | null>(null)
  const profiles = view.profiles
  const names = useCallback((userId: string) => profiles[userId]?.name ?? t.someone, [profiles, t.someone])
  const onReply = useCallback((message: Message) => composer.current?.reply(message), [])
  const onEdit = useCallback((message: Message) => composer.current?.edit(message), [])
  const onReact = useCallback((message: Message, emoji: string, on: boolean) => { void session.react(message.id, emoji, on) }, [session])

  const groups = useMemo(() => groupConsecutiveMessages(state.messages, { authorId: message => message.by, timestamp: message => message.at }), [state.messages])
  const byId = useMemo(() => new Map(state.messages.map(message => [message.id, message])), [state.messages])
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale])
  const typing = (view.typing[channel.id] ?? []).map(names)
  const alone = view.status === 'online' && !view.history && !view.peers.some(peer => peer.state === 'open')

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scroller.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' })
    setUnseen(0)
  }, [])

  // New messages: follow them when already at the bottom (or when they are one's own), else count them.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    if (restore.current !== null) {
      // Older messages were added above: keep the reader where they were.
      element.scrollTop = element.scrollHeight - restore.current
      restore.current = null
      lastCount.current = state.messages.length
      return
    }
    const added = state.messages.slice(lastCount.current)
    lastCount.current = state.messages.length
    if (!added.length) return
    if (atBottom.current || added.some(message => message.by === account.userId)) scrollToBottom()
    else setUnseen(count => count + added.length)
  }, [state.messages, account.userId, scrollToBottom])

  // Reaching the top reads older messages.
  useEffect(() => {
    const sentinel = top.current
    if (!sentinel || !state.more) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || state.loading) return
      restore.current = (scroller.current?.scrollHeight ?? 0) - (scroller.current?.scrollTop ?? 0)
      void session.open(channel.id, true)
    }, { root: scroller.current, rootMargin: '200px 0px 0px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [state.more, state.loading, session, channel.id])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    if (atBottom.current && unseen) setUnseen(0)
  }

  const lastOwn = () => [...state.messages].reverse().find(message => message.by === account.userId && !message.deleted) ?? null

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base-100" aria-labelledby="channel-title">
      <header className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
        <button type="button" className="btn btn-ghost btn-sm btn-square md:hidden" aria-label={t.back}
          onClick={() => navigate({ name: 'workspace', workspaceId: workspace.id })}>
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 id="channel-title" className="flex min-w-0 items-center gap-1 text-base font-semibold">
          <Hash className="size-4 shrink-0 opacity-60" aria-hidden="true" /><span className="truncate">{channel.name}</span>
        </h1>
      </header>

      <div ref={scroller} onScroll={onScroll} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto" id="content" tabIndex={-1}>
        <div className="mx-auto flex min-h-full max-w-(--container-thread) flex-col justify-end px-2 pb-2 pt-6 sm:px-4">
          <div ref={top} aria-hidden="true" />
          {state.loading && <p className="flex justify-center py-3" role="status"><Loader2 className="size-5 animate-spin" aria-label={t.loading} /></p>}
          {!state.more && !state.loading && (
            <div className="mb-6 px-2">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Hash className="size-6" aria-hidden="true" /></span>
              <h2 className="mt-3 text-xl font-bold">{t.channelStartTitle(channel.name)}</h2>
              <p className="text-base-content/70">{view.history ? t.channelStartHistory : t.channelStartP2p}</p>
            </div>
          )}
          <ol role="log" aria-label={t.messagesIn(channel.name)} aria-live="polite" aria-relevant="additions" className="space-y-0.5">
            {groups.map(group => (
              <Fragment key={group.messages[0].id}>
                {group.startsDay && (
                  <li className="divider my-4 text-xs font-medium text-base-content/60" role="separator">{day.format(group.messages[0].at)}</li>
                )}
                {group.messages.map((message, index) => (
                  <MessageItem key={message.id} message={message} first={index === 0} account={account}
                    author={names(message.by)} names={names}
                    replyTo={message.reply ? byId.get(message.reply) ?? null : null}
                    replyAuthor={message.reply ? names(byId.get(message.reply)?.by ?? '') : ''}
                    onReply={onReply} onEdit={onEdit} onDelete={setDeleting} onReact={onReact} />
                ))}
              </Fragment>
            ))}
          </ol>
        </div>
        {unseen > 0 && (
          <button type="button" onClick={() => scrollToBottom(true)}
            className="btn btn-primary btn-sm sticky bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-lg">
            <ArrowDown className="size-4" aria-hidden="true" />{t.newMessages(unseen)}
          </button>
        )}
      </div>

      {alone && (
        <p className="mx-auto flex w-full max-w-(--container-thread) items-start gap-2 px-4 pb-1 text-xs text-base-content/60">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{t.aloneHint}
        </p>
      )}
      <p className="mx-auto h-5 w-full max-w-(--container-thread) truncate px-4 text-xs text-base-content/60" aria-live="polite">
        {typing.length ? t.typing(typing) : ''}
      </p>
      <Composer ref={composer} key={channel.id} channel={channel} lastOwn={lastOwn}
        onSend={(text, replyTo) => session.send(channel.id, text, [], replyTo)}
        onEdit={(message, text) => session.edit(message.id, text)}
        onTyping={() => session.typing(channel.id)} />
      <ConfirmDialog open={deleting !== null} onClose={() => setDeleting(null)} title={t.deleteMessage}
        body={t.deleteMessageConfirm} action={t.deleteMessage}
        onConfirm={async () => { if (deleting) await session.remove(deleting.id) }} />
    </section>
  )
}
