'use client'

import { useEffect, useRef } from 'react'

/** Bestätigungsdialog (statt window.confirm): Fokus auf „Abbrechen“, Escape schließt. */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmmodal">
        <h3 id="confirm-title">{title}</h3>
        <p>{body}</p>
        <div className="row confirmactions">
          <button ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
