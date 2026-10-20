import React, { useEffect, useId, useRef, useState } from 'react'
import type {
  ImageInputLimits,
  InputImage,
  InputImageDraft,
  InputImageSource,
  InputImageUpdate,
  Task,
} from '../contract/types.ts'
import type { Injected } from './view.tsx'

export interface SavedImageEntry {
  kind: 'saved'
  image: InputImage
}
export interface DraftImageEntry {
  kind: 'draft'
  draft: InputImageDraft
  preview: string
  bytes: number
  width: number
  height: number
  name: string
}
export type ImageEntry = SavedImageEntry | DraftImageEntry
export const FALLBACK_IMAGE_LIMITS: ImageInputLimits = {
  maxImages: 4,
  maxImageBytes: 10 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 8192,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

export function savedImageEntries(task: Task): ImageEntry[] {
  return (task.inputImages ?? []).map((image) => ({ kind: 'saved', image }))
}
export function imageUpdates(entries: readonly ImageEntry[]): InputImageUpdate[] {
  return entries.map((entry) =>
    entry.kind === 'saved'
      ? { keep: true, attachmentId: entry.image.attachmentId }
      : entry.draft,
  )
}
export function imagesChanged(
  entries: readonly ImageEntry[],
  baseline: readonly ImageEntry[],
): boolean {
  return (
    JSON.stringify(imageUpdates(entries)) !==
    JSON.stringify(imageUpdates(baseline))
  )
}
export function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${bytes} B`
}
const sourceLabel = (t: Injected['t'], source: InputImageSource) =>
  t(source === 'description' ? 'imageSourceDescription' : 'imageSourceCriteria')
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? Error('read failed'))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}
/** Validate every pasted/dropped image before adding any of them. */
export async function decodeImageFiles(
  files: readonly File[],
  source: InputImageSource,
  current: number,
  limits: ImageInputLimits,
  t: Injected['t'],
): Promise<{ entries: DraftImageEntry[]; error: string }> {
  const entries: DraftImageEntry[] = []
  let error = ''
  for (const file of files) {
    if (!limits.mediaTypes.includes(file.type as never)) {
      error ||= t('imageUnsupported')
      continue
    }
    if (file.size > limits.maxImageBytes) {
      error ||= t('imageTooLarge').replace(
        '{size}',
        bytesLabel(limits.maxImageBytes),
      )
      continue
    }
    if (current + entries.length >= limits.maxImages) {
      error ||= t('imageTooMany').replace('{count}', String(limits.maxImages))
      continue
    }
    try {
      const bitmap = await createImageBitmap(file)
      const { width, height } = bitmap
      bitmap.close?.()
      if (
        width < 1 ||
        height < 1 ||
        width > limits.maxImageDimension ||
        height > limits.maxImageDimension ||
        width * height > limits.maxImagePixels
      ) {
        error ||= t('imageTooLargePixels')
        continue
      }
      const data = await fileBase64(file)
      entries.push({
        kind: 'draft',
        draft: {
          mediaType: file.type as InputImageDraft['mediaType'],
          data,
          name: file.name || 'image',
          source,
        },
        preview: `data:${file.type};base64,${data}`,
        bytes: file.size,
        width,
        height,
        name: file.name || 'image',
      })
    } catch {
      error ||= t('imageCorrupt')
    }
  }
  return { entries, error }
}
/** Shared draft-image state for the create form and task editor. */
export function useImageEntries(options: {
  initial: ImageEntry[]
  limits: ImageInputLimits
  t: Injected['t']
}) {
  const [entries, setEntries] = useState<ImageEntry[]>(options.initial),
    [error, setError] = useState<{
      source: InputImageSource
      message: string
    } | null>(null)
  const addFiles = async (
    source: InputImageSource,
    files: readonly File[],
  ) => {
    const images = [...files].filter(
      (file) => file.type.startsWith('image/') || file.type === '',
    )
    if (!images.length) return
    const result = await decodeImageFiles(
      images,
      source,
      entries.length,
      options.limits,
      options.t,
    )
    if (result.entries.length) setEntries((old) => [...old, ...result.entries])
    setError(result.error ? { source, message: result.error } : null)
  }
  const paste = (source: InputImageSource) => (event: React.ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    void addFiles(source, files)
  }
  const errorFor = (source: InputImageSource) =>
    error?.source === source ? error.message : ''
  return { entries, setEntries, errorFor, clearError: () => setError(null), addFiles, paste }
}
function SavedThumbnail({
  taskId,
  image,
  load,
}: {
  taskId: string
  image: InputImage
  load: Injected['inputImage']
}) {
  const [src, setSrc] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setSrc('')
    setError('')
    load({ id: taskId, attachmentId: image.attachmentId }).then(
      (value) => {
        if (live) setSrc(value)
      },
      () => {
        if (live) setError('failed')
      },
    )
    return () => {
      live = false
    }
  }, [taskId, image.attachmentId, load])
  if (error) return <span className="pd-image-fallback">!</span>
  if (!src) return <span className="pd-image-fallback" aria-hidden="true" />
  return <img src={src} alt={image.name} />
}
function ImageCard({
  entry,
  taskId,
  load,
  t,
  disabled,
  remove,
}: {
  entry: ImageEntry
  taskId?: string
  load: Injected['inputImage']
  t: Injected['t']
  disabled: boolean
  remove?: () => void
}) {
  const source = entry.kind === 'saved' ? entry.image.source : entry.draft.source,
    bytes = entry.kind === 'saved' ? entry.image.bytes : entry.bytes,
    width = entry.kind === 'saved' ? entry.image.width : entry.width,
    height = entry.kind === 'saved' ? entry.image.height : entry.height,
    name = entry.kind === 'saved' ? entry.image.name : entry.name
  return (
    <figure className="pd-input-image" data-source={source}>
      <div className="pd-input-image-preview">
        {entry.kind === 'saved' && taskId ? (
          <SavedThumbnail taskId={taskId} image={entry.image} load={load} />
        ) : entry.kind === 'draft' ? (
          <img src={entry.preview} alt={name} />
        ) : null}
      </div>
      <figcaption>
        <span className="pd-image-source">{sourceLabel(t, source)}</span>
        <code>{name}</code>
        <span className="pd-muted">
          {bytesLabel(bytes)} · {width}×{height}
        </span>
      </figcaption>
      {remove && (
        <button
          type="button"
          className="pd-image-remove"
          disabled={disabled}
          aria-label={`${t('imageRemove')}: ${name}`}
          onClick={remove}
        >
          ×
        </button>
      )}
    </figure>
  )
}
/** Paste target plus explicit attach fallback and removable previews. */
export function InputImageControl({
  source,
  entries,
  setEntries,
  addFiles,
  error,
  limits,
  taskId,
  load,
  t,
  disabled,
  fieldLabel,
}: {
  source: InputImageSource
  entries: ImageEntry[]
  setEntries: (next: ImageEntry[]) => void
  addFiles: (source: InputImageSource, files: readonly File[]) => Promise<void>
  error: string
  limits: ImageInputLimits
  taskId?: string
  load: Injected['inputImage']
  t: Injected['t']
  disabled: boolean
  fieldLabel: string
}) {
  const input = useRef<HTMLInputElement>(null),
    id = useId(),
    shown = entries.filter((entry) =>
      entry.kind === 'saved'
        ? entry.image.source === source
        : entry.draft.source === source,
    )
  return (
    <div className="pd-input-images" data-source={source}>
      <div className="pd-input-images-head">
        <span className="pd-muted">
          {t('imageInputHelp')
            .replace('{count}', String(limits.maxImages))
            .replace('{size}', bytesLabel(limits.maxImageBytes))}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {t('imageAttach')}
        </button>
        <input
          ref={input}
          id={id}
          className="pd-image-file"
          type="file"
          accept={limits.mediaTypes.join(',')}
          multiple
          disabled={disabled}
          aria-label={`${t('imageAttach')}: ${fieldLabel}`}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            void addFiles(source, files)
          }}
        />
      </div>
      {shown.length > 0 && (
        <div className="pd-input-image-list">
          {shown.map((entry, index) => (
            <ImageCard
              key={
                entry.kind === 'saved'
                  ? `saved:${entry.image.attachmentId}`
                  : `draft:${entry.draft.data.slice(0, 24)}:${index}`
              }
              entry={entry}
              taskId={taskId}
              load={load}
              t={t}
              disabled={disabled}
              remove={
                disabled
                  ? undefined
                  : () =>
                      setEntries(
                        entries.filter((candidate) => candidate !== entry),
                      )
              }
            />
          ))}
        </div>
      )}
      {error && (
        <p className="pd-image-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
/** Read-only input-image list used by task detail. */
export function InputImageGallery({
  task,
  load,
  t,
}: {
  task: Task
  load: Injected['inputImage']
  t: Injected['t']
}) {
  if (!task.inputImages?.length) return null
  return (
    <div className="pd-input-image-gallery">
      {task.inputImages.map((image) => (
        <ImageCard
          key={image.attachmentId}
          entry={{ kind: 'saved', image }}
          taskId={task.id}
          load={load}
          t={t}
          disabled
        />
      ))}
    </div>
  )
}
