'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/site/Icons'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

type Target = 'passkeys' | 'emergency' | 'plans' | 'overview'

/** Auto-Sperre gilt als sicher bis zu einer Stunde Inaktivität. */
const SAFE_AUTOLOCK_MIN = 60

/**
 * Sicherheitsstatus: Ring mit erfüllten Punkten und der wichtigsten Empfehlung.
 * Jeder Punkt sagt, was erledigt ist – oder was fehlt („Passkey fehlt“ statt „Passkey eingerichtet“).
 */
export default function SecurityStatus({ onAction }: { onAction: (target: Target) => void }) {
  const m = useMessages(appMessages).secstatus
  const { account, autoLockMinutes } = useAccount()
  const [emergency, setEmergency] = useState<'none' | 'pending' | 'confirmed' | null>(null)
  useEffect(() => {
    api
      .emergency()
      .then(o =>
        setEmergency(
          o.asGrantor.some(c => c.status === 'confirmed' || c.status === 'requested') ? 'confirmed' : o.asGrantor.length ? 'pending' : 'none'
        )
      )
      .catch(() => setEmergency('none'))
  }, [])
  if (!account) return null
  const paid = account.plan !== 'free'
  const hours = autoLockMinutes % 60 === 0 && autoLockMinutes >= 60
  const autolockOk = autoLockMinutes <= SAFE_AUTOLOCK_MIN
  const checks: Array<{ ok: boolean; label: string; fix?: { t: string; go: Target } }> = [
    account.recoveryCheckedAt
      ? { ok: true, label: m.recovery }
      : { ok: false, label: m.recoveryUnchecked, fix: { t: m.checkRecovery, go: 'overview' } },
    autolockOk
      ? { ok: true, label: fmt(m.autolock, { n: autoLockMinutes }) }
      : {
          ok: false,
          label: hours ? fmt(m.autolockLateH, { n: autoLockMinutes / 60 }) : fmt(m.autolockLate, { n: autoLockMinutes }),
          fix: { t: m.shortenAutolock, go: 'overview' }
        },
    account.passkeys.length > 0
      ? { ok: true, label: m.passkey }
      : { ok: false, label: m.passkeyMissing, fix: { t: m.addPasskey, go: 'passkeys' } },
    emergency === 'confirmed'
      ? { ok: true, label: m.emergency }
      : {
          ok: false,
          label: emergency === 'pending' ? m.emergencyPending : m.emergencyMissing,
          fix: { t: paid ? m.addEmergency : m.upgradeEmergency, go: paid ? 'emergency' : 'plans' }
        }
  ]
  if (account.team?.recovery) checks.push({ ok: account.team.recovery.escrowed, label: account.team.recovery.escrowed ? m.escrow : m.escrowMissing })
  const done = checks.filter(c => c.ok).length
  const pct = done / checks.length
  const next = checks.find(c => !c.ok && c.fix)
  const color = pct >= 0.99 ? '#148a52' : pct >= 0.6 ? '#148a52' : '#9a5b00'
  return (
    <div className="card secstatus">
      <svg width="64" height="64" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" style={{ stroke: 'var(--dk-surface-3, #eef0f4)' }} strokeWidth="4" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${pct * 97.4} 100`} transform="rotate(-90 18 18)" strokeLinecap="round" />
        <text x="18" y="21" textAnchor="middle" fontSize="9" fontWeight="700" style={{ fill: 'var(--dk-fg-1, #0b1220)' }}>
          {done}/{checks.length}
        </text>
      </svg>
      <div className="secstatusmain">
        <b>{pct >= 0.99 ? m.titleAll : pct >= 0.6 ? m.titleGood : m.titleImprove}</b>
        <div className="secchecks">
          {checks.map(c => (
            <span key={c.label} className={c.ok ? 'ok' : 'todo'}>
              <Icon name={c.ok ? 'check' : 'x'} size={12} /> {c.label}
            </span>
          ))}
        </div>
      </div>
      {next?.fix && (
        <button className="primary" onClick={() => onAction(next.fix!.go)}>
          {next.fix.t}
        </button>
      )}
    </div>
  )
}
