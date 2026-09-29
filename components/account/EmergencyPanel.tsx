'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAccount } from '@/features/account/AccountProvider'
import { api, type EmergencyOverview } from '@/features/api/client'
import { confirmContact, ensureKeypair } from '@/features/emergency/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { emergencyMessages } from '@/lib/i18n/messages/emergency'

const WAITS = [0, 24, 48, 168, 336, 720]

/** Notfallzugang: eigene Vertrauenspersonen verwalten und als Notfallkontakt für andere handeln. */
export default function EmergencyPanel({ onOpen, onUpgrade }: { onOpen: (contactId: string, name: string) => void; onUpgrade: () => void }) {
  const m = useMessages(emergencyMessages)
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const { account, vault, mutate } = useAccount()
  const [ov, setOv] = useState<EmergencyOverview | null>(null)
  const [wait, setWait] = useState(168)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pass, setPass] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ id: string; name: string; wait: number } | null>(null)
  const [warn, setWarn] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const o = await api.emergency()
      // Als Vertrauensperson: eigenen öffentlichen Schlüssel sicherstellen
      if (o.asGrantee.length) {
        await ensureKeypair(o.myPublicKey, vault.familyKey, k => mutate(c => (c.familyKey ? c : { ...c, familyKey: k })))
      }
      setOv(o)
    } catch (e) {
      setError(errText(e))
    }
  }, [vault.familyKey, mutate, errText])

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!account) return null
  const waitLabel = (h: number) => m.waits[h] ?? `${Math.round(h / 24)} d`
  const stepOf = (c: { status: string; access: boolean }) => (c.access ? 4 : ({ invited: 0, accepted: 1, confirmed: 2, requested: 3 } as Record<string, number>)[c.status] ?? 0)
  const Steps = ({ at }: { at: number }) => (
    <ol className="emsteps" aria-label={m.progress}>
      {m.steps.map((label, i) => (
        <li key={label} className={i < at ? 'done' : i === at ? 'now' : ''}>
          <span />
          {label}
        </li>
      ))}
    </ol>
  )
  const Avatar = ({ label }: { label: string | null }) => (
    <span className="avatarbtn emavatar">{(label ?? '?').split('@')[0].replace(/[._-]+/g, ' ').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase()}</span>
  )

  return (
    <div className="card emergency" id="emergency-card">
      <h3>{m.title}</h3>
      <p className="dim">{m.lead}</p>
      {error && <div className="errorbox">{error}</div>}
      {warn && <div className="notice warn">{warn}</div>}

      {ov && !ov.canGrant && (
        <div className="notice">
          {m.locked}{' '}
          <button className="linkish" onClick={onUpgrade}>
            →
          </button>
        </div>
      )}

      {ov?.canGrant && (
        <>
          <div className="navsection" style={{ padding: '10px 0 6px' }}>
            {m.myContacts}
          </div>
          {ov.asGrantor.length === 0 && <p className="hint">{m.none}</p>}
          {ov.asGrantor.map(c => (
            <div className={`emrow${c.status === 'requested' && !c.access ? ' alert' : ''}`} key={c.id}>
              <Avatar label={c.label} />
              <div className="emmain">
                <strong>{c.label ?? '—'}</strong>
                <span className="hint">
                  {c.status === 'invited' && fmt(m.invited, { date: fmtDate(c.inviteExpiresAt!) })}
                  {c.status === 'accepted' && (c.granteePublicKey ? m.accepted : m.noKeyYet)}
                  {c.status === 'confirmed' && fmt(m.confirmed, { wait: waitLabel(c.waitHours) })}
                  {c.status === 'requested' &&
                    (c.access ? fmt(m.hasAccess, { date: fmtDate(c.availableAt!) }) : fmt(m.requested, { date: fmtDate(c.requestedAt!), at: fmtDate(c.availableAt!) }))}
                </span>
                <Steps at={stepOf(c)} />
                {c.status === 'accepted' && !!c.granteePublicKey && !!c.granteeId && (
                  <>
                  <p className="hint" style={{ color: 'var(--dk-yellow-fg, #9a5b00)' }}>{m.confirmWarn}</p>
                  <form
                    className="row emconfirm"
                    onSubmit={e => {
                      e.preventDefault()
                      const p = pass[c.id]
                      if (p)
                        void act(async () => {
                          await confirmContact(account, p, c.id, c.granteeId!, c.granteePublicKey as JsonWebKey)
                          setPass(x => ({ ...x, [c.id]: '' }))
                        })
                    }}
                  >
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder={m.passphrase}
                      aria-label={`${m.passphrase} (${c.label})`}
                      value={pass[c.id] ?? ''}
                      onChange={e => setPass(x => ({ ...x, [c.id]: e.target.value }))}
                    />
                    <button className="primary small" type="submit" disabled={busy || !pass[c.id]}>
                      {m.confirm}
                    </button>
                  </form>
                  </>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {c.status === 'requested' && !c.access && (
                  <>
                    <button className="small" disabled={busy} onClick={() => void act(() => api.emergencyAction(c.id, 'reject'))}>
                      {m.reject}
                    </button>
                    <button className="small" disabled={busy} onClick={() => void act(() => api.emergencyAction(c.id, 'approve'))}>
                      {m.approve}
                    </button>
                  </>
                )}
                <button
                  className="small danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.removeEmergency(c.id)
                      if (c.access) setWarn(m.revokedAfterAccess)
                    })
                  }
                >
                  {c.access ? m.revoke : m.remove}
                </button>
              </div>
            </div>
          ))}
          <div className="row eminvite">
            <label className="hint" htmlFor="em-wait">
              {m.wait}
            </label>
            <select id="em-wait" value={wait} onChange={e => setWait(Number(e.target.value))}>
              {WAITS.map(h => (
                <option key={h} value={h}>
                  {waitLabel(h)}
                </option>
              ))}
            </select>
            <button
              className="small"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await api.createEmergency(wait)
                  setLink(`${window.location.origin}${window.location.pathname}?emergency=${r.token}`)
                  setCopied(false)
                })
              }
            >
              + {m.invite}
            </button>
          </div>
          {link && (
            <div className="sharelink">
              <span className="hint">{m.inviteReady}</span>
              <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label={m.inviteReady} />
              <button className="primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
                {copied ? m.copied : m.copy}
              </button>
            </div>
          )}
        </>
      )}

      {ov && ov.asGrantee.length > 0 && (
        <>
          <div className="navsection" style={{ padding: '16px 0 6px' }}>
            {m.forOthers}
          </div>
          {ov.asGrantee.map(c => (
            <div className={`emrow${c.access ? ' ok' : ''}`} key={c.id}>
              <Avatar label={c.label} />
              <div className="emmain">
                <strong>{c.label ?? '—'}</strong>
                <span className="hint">
                  {c.status === 'accepted' && fmt(m.gWaiting, { name: c.label ?? '' })}
                  {c.status === 'confirmed' && fmt(m.gReady, { wait: waitLabel(c.waitHours) })}
                  {c.status === 'requested' && (c.access ? m.gAccess : fmt(m.gRequested, { at: fmtDate(c.availableAt!) }))}
                </span>
                <Steps at={stepOf(c)} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                {c.status === 'confirmed' && (
                  <button className="small" disabled={busy} onClick={() => setAsk({ id: c.id, name: c.label ?? '', wait: c.waitHours })}>
                    {m.request}
                  </button>
                )}
                {c.access && (
                  <button className="primary small" onClick={() => onOpen(c.id, c.label ?? '')}>
                    {m.open}
                  </button>
                )}
                <button className="small" disabled={busy} onClick={() => void act(() => api.removeEmergency(c.id))}>
                  {m.leave}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {ask && (
        <ConfirmDialog
          title={fmt(m.requestTitle, { name: ask.name })}
          body={fmt(m.requestBody, { name: ask.name, wait: waitLabel(ask.wait) })}
          confirmLabel={m.request}
          cancelLabel={m.cancel}
          danger={false}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            const a = ask
            setAsk(null)
            void act(() => api.emergencyAction(a.id, 'request'))
          }}
        />
      )}
    </div>
  )
}
