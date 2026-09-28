'use client'

import { useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { escrowForTeam } from '@/features/team/client'
import { teamAdminMessages } from '@/lib/i18n/messages/team-admin'

/** Hinweise aus den Team-Richtlinien (Passkey, Passphrase, Hinterlegung, offene und durchgeführte Zugriffe). */
export default function TeamNotices({ onOpenAccount }: { onOpenAccount: () => void }) {
  const m = useMessages(teamAdminMessages).notices
  const { fmtDate } = useI18n()
  const { account } = useAccount()
  const t = account?.team
  if (!account || !t) return null
  const items: string[] = []
  if (t.policy.passkeyRequired && account.passkeys.length === 0) items.push(m.passkey)
  if (t.passphraseChars !== null && t.passphraseChars < t.policy.minPassphraseChars) items.push(fmt(m.passphrase, { n: t.policy.minPassphraseChars }))
  if (t.policy.recoveryRequired && t.recovery && !t.recovery.escrowed) items.push(m.escrow)
  const recent = t.accessedBy.filter(a => Date.now() - new Date(a.at).getTime() < 30 * 86_400_000)
  const pending = t.requests.filter(q => q.status === 'pending')
  if (!items.length && !recent.length && !pending.length) return null
  return (
    <>
      {pending.map(q => (
        <div className="notice warn" key={`p-${q.at}`}>
          {fmt(m.requested, { date: fmtDate(q.at), a: q.requestedBy, status: m.requestStatus[q.status], reason: q.reason })}
        </div>
      ))}
      {recent.map(a => (
        <div className="notice warn" key={a.at}>
          {fmt(m.accessed, { date: fmtDate(a.at), a: a.requestedBy, b: a.approvedBy, reason: a.reason })}
        </div>
      ))}
      {items.length > 0 && (
        <div className="notice warn row teamnotice" style={{ justifyContent: 'space-between' }}>
          <span>
            {items.map(i => (
              <span key={i} style={{ display: 'block' }}>
                {i}
              </span>
            ))}
          </span>
          <button className="small" onClick={onOpenAccount}>
            {m.go}
          </button>
        </div>
      )}
    </>
  )
}

/** Konto & Sicherheit: eigenen Schlüssel für den Firmen-Notfallzugriff hinterlegen. */
export function TeamEscrowCard() {
  const m = useMessages(teamAdminMessages).notices
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const { account, refreshAccount } = useAccount()
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const t = account?.team
  if (!account || !t?.recovery) return null
  return (
    <div className="card">
      <h3>{m.escrowTitle}</h3>
      <p className="dim">{m.escrowLead}</p>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      {t.recovery.escrowed ? (
        <p className="hint">✓ {m.escrowDone}</p>
      ) : (
        <form
          className="row emconfirm"
          onSubmit={e => {
            e.preventDefault()
            if (!pass) return
            setBusy(true)
            setMsg(null)
            escrowForTeam(account, pass)
              .then(async () => {
                setPass('')
                await refreshAccount()
                setMsg({ ok: true, text: m.escrowDone })
              })
              .catch(err => setMsg({ ok: false, text: errText(err) }))
              .finally(() => setBusy(false))
          }}
        >
          <input type="password" autoComplete="current-password" aria-label={m.escrowButton} placeholder="Passphrase" value={pass} onChange={e => setPass(e.target.value)} />
          <button className="primary small" type="submit" disabled={busy || !pass}>
            {m.escrowButton}
          </button>
        </form>
      )}
      {t.requests.map(q => (
        <p className="hint" key={`r-${q.at}`}>
          {fmt(m.requested, { date: fmtDate(q.at), a: q.requestedBy, status: m.requestStatus[q.status], reason: q.reason })}
        </p>
      ))}
      {t.accessedBy.map(a => (
        <p className="hint" key={a.at}>
          {fmt(m.accessed, { date: fmtDate(a.at), a: a.requestedBy, b: a.approvedBy, reason: a.reason })}
        </p>
      ))}
    </div>
  )
}
