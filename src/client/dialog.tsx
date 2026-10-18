import React, { useLayoutEffect, useRef, useId } from 'react'

/** Plugin-owned native top layer. Never reaches into the DSH shell DOM. */
export function Dialog({
  title,
  closeLabel,
  onClose,
  children,
  footer,
  className = '',
  description,
  alert = false,
}: {
  title: string
  description?: string
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  alert?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    descId = useId()
  const close = useRef(onClose),
    composing = useRef(false)
  close.current = onClose
  useLayoutEffect(() => {
    const dialog = ref.current!
    const previous = dialog.ownerDocument.activeElement
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus()
    return () => {
      dialog.close()
      // Nested dialogs may unmount together. Restore after the full commit,
      // when the invoking control is no longer inert beneath the top layer.
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous.isConnected)
          previous.focus({ preventScroll: true })
      })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`pd-dialog ${className}`}
      role={alert ? 'alertdialog' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCompositionStartCapture={() => {
        composing.current = true
      }}
      onCompositionEndCapture={() => {
        composing.current = false
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!composing.current) close.current()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const box = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          close.current()
      }}
    >
      <header className="pd-dialog-header">
        <div>
          <span className="pd-eyebrow">PERSE / DSH</span>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descId} className="pd-muted">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="pd-icon-button"
          aria-label={closeLabel}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="pd-dialog-body">{children}</div>
      {footer && <footer className="pd-dialog-footer">{footer}</footer>}
    </dialog>
  )
}

export function DetailTabs({
  value,
  change,
  labels,
}: {
  value: string
  change: (id: string) => void
  labels: [string, string][]
}) {
  return (
    <div className="pd-detail-tabs" role="tablist" aria-label={labels[0]?.[1]}>
      {labels.map(([id, label], index) => (
        <button
          type="button"
          key={id}
          role="tab"
          id={`pd-tab-${id}`}
          aria-controls={`pd-panel-${id}`}
          tabIndex={id === value ? 0 : -1}
          aria-selected={id === value}
          onClick={() => change(id)}
          onKeyDown={(e) => {
            const step =
              e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
            if (!step) return
            e.preventDefault()
            const next = (index + step + labels.length) % labels.length
            change(labels[next]![0])
            // Only sibling controls owned by this component are accessed.
            e.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role=tab]')
              [next]?.focus()
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
