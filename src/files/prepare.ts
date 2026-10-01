/**
 * A file the person attached, ready to send: its SHA-256 (what names it among
 * the members' devices), a clean name, and for an image a small WebP preview
 * that travels inside the message, so members see it before the file comes.
 */
import { fileHash } from '@codefusion-cc/realtime/browser'
import { LIMITS } from '../../shared/app.ts'
import type { FileRef } from '../content/ops.ts'

/** Why a file cannot be attached. */
export class AttachError extends Error {
  readonly reason: 'too-large' | 'unreadable'
  constructor(reason: AttachError['reason']) {
    super(`attach ${reason}`)
    this.reason = reason
  }
}

export type PreparedFile = { ref: FileRef; blob: Blob }

const PREVIEW_MAX_BYTES = 24 * 1024
/** Preview sizes tried in turn until one fits the message (24 KiB as a data URL). */
const PREVIEW_STEPS = [{ side: 480, quality: 0.72 }, { side: 360, quality: 0.6 }, { side: 240, quality: 0.5 }, { side: 160, quality: 0.45 }]
/** Image types a browser decodes for a preview (an SVG is shown as an image too, but not drawn here). */
const PREVIEWABLE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/

/** A name that fits: at most 255 characters, the extension kept, no path. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim().replace(/\p{Cc}/gu, '') || 'file'
  if (base.length <= 255) return base
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : ''
  return `${base.slice(0, 255 - extension.length - 1)}…${extension}`
}

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

/** A WebP preview that fits a message, with the image's size; null when the browser cannot draw it. */
export async function imagePreview(file: Blob): Promise<{ preview: string; width: number; height: number } | null> {
  if (!PREVIEWABLE.test(file.type) || typeof createImageBitmap !== 'function') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const { width, height } = bitmap
    for (const step of PREVIEW_STEPS) {
      const scale = Math.min(1, step.side / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', step.quality))
      if (!blob || blob.type !== 'image/webp') return null
      const preview = await dataUrl(blob)
      if (preview.length <= PREVIEW_MAX_BYTES) return { preview, width, height }
    }
    return null
  } finally {
    bitmap.close()
  }
}

/** Reads, names and hashes a file the person attached; rejects with an `AttachError`. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.size > LIMITS.fileBytes) throw new AttachError('too-large')
  let hash: string
  try {
    hash = await fileHash(file)
  } catch {
    throw new AttachError('unreadable')
  }
  const type = file.type.slice(0, 128) || 'application/octet-stream'
  const image = await imagePreview(file)
  return {
    blob: file,
    ref: {
      hash, name: cleanName(file.name), size: file.size, type,
      ...(image ? { preview: image.preview, width: Math.min(image.width, 20_000), height: Math.min(image.height, 20_000) } : {}),
    },
  }
}
