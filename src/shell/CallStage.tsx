import { listMediaDevices, type CallState, type MediaDeviceLists } from '@codefusion-cc/realtime-media/browser'
import { useSpeakingStreams } from '@codefusion-cc/realtime-media/react'
import { Headphones, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Settings2, Video, VideoOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account } from '../auth/session.ts'
import { devices } from '../calls/devices.ts'
import { callMembers, joinCall, useCall } from '../calls/useCall.ts'
import type { Strings } from '../i18n.ts'
import { useI18n } from '../i18nContext.ts'
import { Avatar } from '../ui/Avatar.tsx'
import type { SessionView, WorkspaceSession } from '../workspaces/session.ts'

const hasLiveVideo = (stream: MediaStream | null | undefined) => Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled))

/** What went wrong with the call, as the person reads it. */
function callProblem(t: Strings, error: string | null): string | null {
  switch (error) {
    case null: return null
    case 'media-permission-denied': return t.callPermissionDenied
    case 'media-device-unavailable': return t.callNoDevice
    case 'media-capture-failed': return t.callCaptureFailed
    case 'media-limit': return t.callFull
    case 'media-unavailable': return t.callUnavailable
    case 'media-session-ended': return t.callEnded
    default: return t.callCannotConnect
  }
}

/**
 * The workspace's call above its channel: a bar saying who is in it (and a
 * way in) while this page is not, the people and controls while it is.
 */
export function CallStage({ account, session, view }: { account: Account; session: WorkspaceSession; view: SessionView }) {
  const { t } = useI18n()
  const state = useCall(session)
  const people = callMembers(state, account.userId)
  const [joining, setJoining] = useState(false)
  if (!state.joined && people.length === 0) return null
  const name = (userId: string) => userId === account.userId ? t.yourselfNamed(account.name) : view.profiles[userId]?.name ?? t.someone

  if (!state.joined) {
    return (
      <div className="flex items-center gap-3 border-b border-base-300 bg-success/10 px-3 py-2 text-sm" role="status">
        <Headphones className="size-4 shrink-0 text-success" aria-hidden="true" />
        <span className="flex -space-x-2" aria-hidden="true">
          {people.slice(0, 4).map(userId => <Avatar key={userId} name={name(userId)} seed={userId} size="xs" />)}
        </span>
        <span className="min-w-0 flex-1 truncate">{t.callInProgress(people.map(name))}</span>
        <button type="button" className="btn btn-success btn-sm" disabled={joining}
          onClick={async () => { setJoining(true); await joinCall(session); setJoining(false) }}>
          {joining && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{t.joinCall}
        </button>
      </div>
    )
  }
  return <JoinedCall account={account} session={session} state={state} people={people} name={name} />
}

function JoinedCall({ account, session, state, people, name }: {
  account: Account; session: WorkspaceSession; state: CallState; people: string[]; name(userId: string): string
}) {
  const { t } = useI18n()
  const streams = useMemo(() => ({ ...state.peerStreams, [account.userId]: state.localStream }), [state.peerStreams, state.localStream, account.userId])
  const speaking = useSpeakingStreams(streams)
  const problem = callProblem(t, state.mediaError)
  const [settings, setSettings] = useState(false)
  const connecting = !state.ready || (people.length > 1 && Object.keys(state.peerStreams).length === 0 && state.mediaError === null)
  return (
    <section className="border-b border-base-300 bg-base-200/60" aria-label={t.callLabel}>
      {/* Many people scroll; the list then takes focus, so a keyboard can scroll it too. */}
      <ul tabIndex={0} aria-label={t.callPeople(people.length)}
        className={`mx-auto grid max-h-viewer gap-2 overflow-y-auto p-2 ${people.length > 4 ? 'grid-cols-3 sm:grid-cols-4' : people.length > 1 ? 'max-w-3xl grid-cols-2' : 'max-w-md grid-cols-1'}`}>
        {people.map(userId => (
          <li key={userId}>
            <Tile name={name(userId)} userId={userId} stream={streams[userId] ?? null} self={userId === account.userId}
              speaking={speaking[userId] === true} muted={userId === account.userId && (!state.micOn || state.micMuted)} />
          </li>
        ))}
      </ul>
      {(problem || connecting) && (
        <p className={`flex items-center gap-2 px-3 pb-2 text-xs ${problem ? 'text-error' : 'text-base-content/60'}`} role={problem ? 'alert' : 'status'}>
          {problem ? <>{problem}<button type="button" className="btn btn-ghost btn-xs" onClick={() => session.call.retry()}><RotateCcw className="size-3.5" aria-hidden="true" />{t.retry}</button></>
            : <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{t.callConnecting}</>}
        </p>
      )}
      <div className="flex items-center justify-center gap-2 px-3 pb-3" role="toolbar" aria-label={t.callControls}>
        <button type="button" className={`btn btn-circle ${state.micOn && !state.micMuted ? '' : 'btn-error btn-soft'}`}
          aria-pressed={state.micOn && !state.micMuted} aria-label={state.micOn && !state.micMuted ? t.muteMic : t.unmuteMic}
          onClick={() => state.micOn ? session.call.setMicMuted(!state.micMuted) : void session.call.enableMic()}>
          {state.micOn && !state.micMuted ? <Mic className="size-5" aria-hidden="true" /> : <MicOff className="size-5" aria-hidden="true" />}
        </button>
        <button type="button" className={`btn btn-circle ${state.cameraOn ? 'btn-primary' : ''}`} aria-pressed={state.cameraOn}
          aria-label={state.cameraOn ? t.cameraOff : t.cameraOn}
          onClick={() => state.cameraOn ? void session.call.disableCamera() : void session.call.enableCamera()}>
          {state.cameraOn ? <Video className="size-5" aria-hidden="true" /> : <VideoOff className="size-5" aria-hidden="true" />}
        </button>
        <button type="button" className="btn btn-circle" aria-label={t.callDevices} aria-expanded={settings} onClick={() => setSettings(open => !open)}>
          <Settings2 className="size-5" aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-error" onClick={() => session.call.leave()}>
          <PhoneOff className="size-5" aria-hidden="true" />{t.leaveCall}
        </button>
      </div>
      {settings && <DeviceChoices session={session} state={state} />}
    </section>
  )
}

function Tile({ name, userId, stream, self, speaking, muted }: { name: string; userId: string; stream: MediaStream | null; self: boolean; speaking: boolean; muted: boolean }) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const showsVideo = hasLiveVideo(stream)
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (element.srcObject !== stream) element.srcObject = stream
    if (stream) void element.play().catch(() => {})
    if (self) return
    // Others' sound comes out of the speaker this device chose, now and whenever it changes; one's own never plays back.
    const route = () => void devices.applyAudioOutput(element)
    route()
    window.addEventListener(devices.outputChangedEvent, route)
    return () => window.removeEventListener(devices.outputChangedEvent, route)
  }, [stream, self])
  return (
    <figure className={`relative grid aspect-video place-items-center overflow-hidden rounded-box bg-neutral text-neutral-content ring-offset-2 ring-offset-base-200 ${speaking ? 'ring-2 ring-success' : ''}`}>
      <video ref={video} autoPlay playsInline muted={self} className={`size-full object-cover ${showsVideo ? '' : 'hidden'} ${self ? '-scale-x-100' : ''}`} />
      {!showsVideo && <Avatar name={name} seed={userId} size="lg" />}
      <figcaption className="absolute bottom-1.5 left-1.5 right-1.5 flex w-fit items-center gap-1 rounded-field bg-neutral/80 px-1.5 py-0.5 text-xs">
        {muted && <MicOff className="size-3 shrink-0" aria-label={t.micIsOff} />}
        <span className="truncate">{name}</span>
      </figcaption>
    </figure>
  )
}

function DeviceChoices({ session, state }: { session: WorkspaceSession; state: CallState }) {
  const { t } = useI18n()
  const [lists, setLists] = useState<MediaDeviceLists | null>(null)
  const [speaker, setSpeaker] = useState(devices.loadPreferredAudioOutput())
  useEffect(() => {
    let active = true
    const read = () => void listMediaDevices().then(found => { if (active) setLists(found) }, () => {})
    read()
    navigator.mediaDevices?.addEventListener?.('devicechange', read)
    return () => { active = false; navigator.mediaDevices?.removeEventListener?.('devicechange', read) }
  }, [])
  if (!lists) return <p className="px-3 pb-3 text-xs text-base-content/60" role="status">{t.loading}</p>
  const label = (device: MediaDeviceInfo, index: number) => device.label || `${t.deviceUnnamed} ${index + 1}`
  return (
    <div className="grid gap-2 px-3 pb-3 sm:grid-cols-3">
      <label className="text-xs">
        <span className="mb-1 block font-medium">{t.microphone}</span>
        <select className="select select-sm w-full" value={state.selectedAudioInput} onChange={event => { devices.savePreferredAudioInput(event.target.value); void session.call.switchAudioInput(event.target.value) }}>
          <option value="">{t.systemDefault}</option>
          {lists.audioInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{label(device, index)}</option>)}
        </select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">{t.camera}</span>
        <select className="select select-sm w-full" value={state.selectedVideoInput} onChange={event => { devices.savePreferredVideoInput(event.target.value); void session.call.switchVideoInput(event.target.value) }}>
          <option value="">{t.systemDefault}</option>
          {lists.videoInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{label(device, index)}</option>)}
        </select>
      </label>
      {lists.audioOutputs.length > 0 && (
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t.speaker}</span>
          <select className="select select-sm w-full" value={speaker} onChange={event => {
            devices.savePreferredAudioOutput(event.target.value)
            setSpeaker(event.target.value)
            window.dispatchEvent(new Event(devices.outputChangedEvent))
          }}>
            <option value="">{t.systemDefault}</option>
            {lists.audioOutputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{label(device, index)}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
