import { formatByteSize } from '@codefusion-cc/realtime/browser'
import { AlertCircle, Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, Loader2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { FileRef } from '../content/ops.ts'
import { useFile } from '../files/useFile.ts'
import type { WorkspaceFiles } from '../files/workspaceFiles.ts'
import { useI18n } from '../i18nContext.ts'
import { Dialog } from '../ui/Dialog.tsx'

const isImage = (ref: FileRef) => /^image\//.test(ref.type) && (Boolean(ref.preview) || /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(ref.type))

function iconOf(type: string) {
  if (type.startsWith('image/')) return FileImage
  if (type.startsWith('video/')) return FileVideo
  if (type.startsWith('audio/')) return FileAudio
  if (/zip|rar|7z|tar|gzip|compressed/.test(type)) return FileArchive
  if (type.startsWith('text/') || /pdf|document|sheet|presentation|json|xml/.test(type)) return FileText
  return File
}

/** A message's files: images as pictures (their preview first), anything else as a card to save. */
export function MessageFiles({ files, refs }: { files: WorkspaceFiles; refs: FileRef[] }) {
  const images = refs.filter(isImage)
  const others = refs.filter(ref => !isImage(ref))
  const [viewing, setViewing] = useState<FileRef | null>(null)
  return (
    <div className="mt-1 space-y-1.5">
      {images.length > 0 && (
        <ul className={`grid max-w-md gap-1 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {images.map(ref => <li key={ref.hash}><ImageTile files={files} file={ref} onOpen={() => setViewing(ref)} /></li>)}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="max-w-md space-y-1">
          {others.map(ref => <li key={ref.hash}><FileCard files={files} file={ref} /></li>)}
        </ul>
      )}
      {viewing && <ImageViewer files={files} file={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function Progress({ value, label }: { value: number; label: string }) {
  return <progress className="progress progress-primary h-1 w-full" value={Math.round(value * 100)} max={100} aria-label={label} />
}

function ImageTile({ files, file, onOpen }: { files: WorkspaceFiles; file: FileRef; onOpen(): void }) {
  const { t } = useI18n()
  const state = useFile(files, file, true)
  const source = state.status === 'local' && state.url ? state.url : file.preview
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : undefined
  return (
    <button type="button" onClick={onOpen} aria-label={t.openImage(file.name)}
      className="relative block w-full overflow-hidden rounded-box border border-base-300 bg-base-200" style={{ aspectRatio: ratio }}>
      {source
        ? <img src={source} alt="" className={`size-full object-cover ${state.status === 'local' ? '' : 'blur-xs'}`} decoding="async" loading="lazy" />
        : <span className="grid size-full min-h-24 place-items-center"><FileImage className="size-8 text-base-content/40" aria-hidden="true" /></span>}
      {state.status === 'fetching' && (
        <span className="absolute inset-x-2 bottom-2"><Progress value={state.progress} label={t.fileFetching(Math.round(state.progress * 100))} /></span>
      )}
      {(state.status === 'unavailable' || state.status === 'failed') && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-base-100/90 px-2 py-1 text-xs text-base-content/80">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />{state.status === 'unavailable' ? t.fileUnavailableShort : t.fileFailed}
        </span>
      )}
    </button>
  )
}

function FileCard({ files, file }: { files: WorkspaceFiles; file: FileRef }) {
  const { t, locale } = useI18n()
  const state = useFile(files, file, false)
  const Icon = iconOf(file.type)
  const [saveFailed, setSaveFailed] = useState(false)
  const get = async () => {
    setSaveFailed(false)
    await files.load(file)
    if (files.state(file.hash).status === 'local' && !await files.save(file)) setSaveFailed(true)
  }
  const busy = state.status === 'fetching'
  return (
    <div className="flex items-center gap-3 rounded-box border border-base-300 bg-base-100 p-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-field bg-base-200"><Icon className="size-5 text-base-content/70" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
        {busy ? (
          <Progress value={state.progress} label={t.fileFetching(Math.round(state.progress * 100))} />
        ) : (
          <p className="text-xs text-base-content/60" role={state.status === 'unavailable' || state.status === 'failed' || saveFailed ? 'status' : undefined}>
            {formatByteSize(file.size, locale)}
            {state.status === 'unavailable' && <> · {t.fileUnavailable}</>}
            {(state.status === 'failed' || saveFailed) && <> · {t.fileFailed}</>}
          </p>
        )}
      </div>
      <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={() => void get()} disabled={busy}
        aria-label={state.status === 'unavailable' || state.status === 'failed' ? t.retryFile(file.name) : t.saveFile(file.name)}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          : state.status === 'unavailable' || state.status === 'failed' ? <RotateCcw className="size-4" aria-hidden="true" />
            : <Download className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

function ImageViewer({ files, file, onClose }: { files: WorkspaceFiles; file: FileRef; onClose(): void }) {
  const { t, locale } = useI18n()
  const state = useFile(files, file, true)
  const source = state.status === 'local' && state.url ? state.url : file.preview
  return (
    <Dialog open onClose={onClose} title={file.name} wide
      actions={<>
        <span className="mr-auto text-sm text-base-content/60">{formatByteSize(file.size, locale)}</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t.close}</button>
        <button type="button" className="btn btn-primary" disabled={state.status !== 'local'} onClick={() => void files.save(file)}>
          <Download className="size-4" aria-hidden="true" />{t.save}
        </button>
      </>}>
      <div className="grid place-items-center">
        {source ? <img src={source} alt={file.name} className="max-h-viewer max-w-full rounded-box object-contain" /> : <FileImage className="size-12 text-base-content/40" aria-hidden="true" />}
        {state.status === 'fetching' && <div className="mt-3 w-full"><Progress value={state.progress} label={t.fileFetching(Math.round(state.progress * 100))} /></div>}
        {(state.status === 'unavailable' || state.status === 'failed') && (
          <p role="status" className="mt-3 text-sm text-base-content/70">{state.status === 'unavailable' ? t.fileUnavailable : t.fileFailed}</p>
        )}
      </div>
    </Dialog>
  )
}
