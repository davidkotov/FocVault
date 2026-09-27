'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAccount } from '@/features/account/AccountProvider'
import { api, type FamilyView } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes } from '@/lib/vault'

/** Family verwalten: Mitglieder, Speicher je Person, Einladungslinks, Entfernen/Austreten. */
export default function FamilyPanel({ freeGb }: { freeGb: number }) {
  const t = useMessages(appMessages)
  const m = t.family
  const { fmtDate, locale } = useI18n()
  const errText = useErrorText()
  const { account, refreshAccount } = useAccount()
  const [view, setView] = useState<FamilyView | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | { id: string; name: string; self: boolean }>(null)

  const load = useCallback(() => api.family().then(setView).catch(() => undefined), [])
  useEffect(() => {
    void load()
  }, [load, account?.plan])

  if (!view || !view.role) return null

  const invite = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.familyInvite()
      setLink(`${window.location.origin}/${locale}/app?join=${r.token}`)
      setCopied(false)
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const used = view.members.length + view.invites.length
  const team = view.kind === 'business'
  const tm = t.team
  return (
    <div className="card">
      <h3>
        {team ? tm.title : m.title} <span>{fmt(m.seatsUsed, { used: view.members.length, seats: view.seats })}</span>
      </h3>
      <p className="dim">
        {view.role === 'owner'
          ? fmt(team ? tm.ownerLead : m.ownerLead, { seats: view.seats })
          : fmt(team ? tm.memberLead : m.memberLead, { owner: view.ownerLabel ?? '' })}
      </p>
      {error && <div className="errorbox">{error}</div>}

      <div className="trashlist">
        {view.members.map(p => (
          <div className="trashrow" key={p.id}>
            <div className="trashinfo">
              <strong>
                {p.label}
                {p.you && <span className="dim"> ({m.you})</span>}
              </strong>
              <span className="hint">
                {formatBytes(p.usedBytes)}
                {p.owner ? ` · ${m.owner}` : p.joinedAt ? ` · ${fmtDate(p.joinedAt)}` : ''}
              </span>
            </div>
            {view.role === 'owner' && !p.owner && (
              <button className="small danger" onClick={() => setConfirm({ id: p.id, name: p.label, self: false })}>
                {m.remove}
              </button>
            )}
            {view.role === 'member' && p.you && (
              <button className="small" onClick={() => setConfirm({ id: p.id, name: p.label, self: true })}>
                {m.leave}
              </button>
            )}
          </div>
        ))}
      </div>

      {view.role === 'owner' && (
        <div style={{ marginTop: 16 }}>
          {link ? (
            <div className="sharelink">
              <strong>{m.invite}</strong>
              <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label={m.invite} />
              <span className="hint">{m.inviteLead}</span>
              <button className="primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
                {copied ? m.copied : m.copy}
              </button>
            </div>
          ) : (
            <button className="primary small" disabled={busy || used >= view.seats} onClick={() => void invite()}>
              + {m.invite}
            </button>
          )}
          {view.invites.length > 0 && (
            <>
              <div className="navsection" style={{ padding: '14px 0 4px' }}>
                {m.openInvites}
              </div>
              {view.invites.map(i => (
                <div className="sharerow" key={i.id}>
                  <span className="hint">{fmt(m.until, { date: fmtDate(i.expiresAt) })}</span>
                  <button className="small" onClick={() => void api.familyRevokeInvite(i.id).then(load)}>
                    {m.revoke}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.self ? m.confirmLeave : fmt(m.confirmRemove, { name: confirm.name })}
          body={fmt(confirm.self ? m.confirmLeaveBody : m.confirmRemoveBody, { gb: freeGb })}
          confirmLabel={confirm.self ? m.leave : m.remove}
          cancelLabel={t.confirm.cancel}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const c = confirm
            setConfirm(null)
            try {
              await api.familyRemove(c.id)
              await refreshAccount()
              await load()
            } catch (e) {
              setError(errText(e))
            }
          }}
        />
      )}
    </div>
  )
}
