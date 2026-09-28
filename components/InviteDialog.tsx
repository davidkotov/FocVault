'use client'

import { useEffect, useRef } from 'react'
import { Icon, type IconName } from '@/components/site/Icons'

/** Einladung annehmen (Family, Team, Notfallkontakt): wer lädt ein, was bedeutet es, zwei klare Knöpfe. */
export default function InviteDialog({
  icon,
  eyebrow,
  title,
  from,
  body,
  points,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}: {
  icon: IconName
  eyebrow: string
  title: string
  from: string
  body: string
  points: string[]
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const initials = from.split('@')[0].replace(/[._-]+/g, ' ').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="invite-title">
      <div className="invitemodal">
        <div className="invitehero">
          <span className="invitebadge">
            <Icon name={icon} size={26} />
          </span>
          <span className="inviteeyebrow">{eyebrow}</span>
          <h3 id="invite-title">{title}</h3>
          <div className="invitefrom">
            <span className="avatarbtn">{initials || '?'}</span>
            <b>{from}</b>
          </div>
        </div>
        <div className="invitebody">
          <p>{body}</p>
          <ul>
            {points.map(p => (
              <li key={p}>
                <Icon name="check" size={15} /> {p}
              </li>
            ))}
          </ul>
          <div className="inviteactions">
            <button type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="primary" ref={okRef} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
