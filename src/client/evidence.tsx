import React, { useEffect, useState } from 'react'
import type { Task, EvidenceImage } from '../contract/types.ts'
import type { Injected } from './view.tsx'
import { Dialog } from './dialog.tsx'
export function EvidenceText({ text }: { text: string }) {
  return (
    <div className="pd-evidence-text">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
    </div>
  )
}
function ImageEvidence({
  taskId,
  image,
  load,
  t,
}: {
  taskId: string
  image: EvidenceImage
  load: Injected['image']
  t: Injected['t']
}) {
  const [src, setSrc] = useState(''),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    setSrc('')
    setError('')
    load({ id: taskId, path: image.path }).then(
      (v) => {
        if (live) setSrc(v)
      },
      (e) => {
        if (live) setError(String(e))
      },
    )
    return () => {
      live = false
    }
  }, [taskId, image.path, load])
  return (
    <figure className="pd-image-evidence">
      {src && (
        <button
          onClick={() => setOpen(true)}
          aria-label={`${t('previewImage')}: ${image.caption || image.path}`}
        >
          <img src={src} alt={image.caption || image.path} />
        </button>
      )}
      <figcaption>
        {image.criterion !== undefined && `${image.criterion + 1}. `}
        {image.caption || image.path}
        <code>{image.path}</code>
      </figcaption>
      {error && (
        <p role="status">
          {t('imageUnavailable')}: {error}
        </p>
      )}
      {open && (
        <Dialog
          title={image.caption || image.path}
          closeLabel={t('closeImage')}
          onClose={() => setOpen(false)}
          className="pd-image-preview"
        >
          <img src={src} alt={image.caption || image.path} />
        </Dialog>
      )}
    </figure>
  )
}
export function EvidenceImages({
  task,
  load,
  t,
}: {
  task: Task
  load: Injected['image']
  t: Injected['t']
}) {
  return (
    <div className="pd-evidence-images">
      {task.images?.map((image, i) => (
        <ImageEvidence
          key={`${i}:${image.path}`}
          taskId={task.id}
          image={image}
          load={load}
          t={t}
        />
      ))}
    </div>
  )
}
