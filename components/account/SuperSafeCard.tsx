'use client'

import { useEffect, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Icon } from '@/components/site/Icons'
import { useAccount } from '@/features/account/AccountProvider'
import { api, type PublicOffer } from '@/features/api/client'
import { useErrorText } from '@/features/i18n/errors'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { billingMessages } from '@/lib/i18n/messages/billing'
import type { Currency, Interval } from '@/lib/pricing'

/**
 * Super Safe: mehr Filecoin-Kopien (z. B. 5 statt 2) gegen Aufpreis je TB Speicher.
 * Abo-Inhaber buchen und kündigen hier; Free sieht den Preis je TB mit Upgrade-Hinweis,
 * Family-/Team-Mitglieder sehen, ob der Inhaber gebucht hat.
 * interval/currency gelten nur für die Anzeige ohne eigenes Abo – Abos zahlen im Abo-Rhythmus.
 */
export default function SuperSafeCard({
  interval,
  currency,
  offer,
  onUpgrade
}: {
  interval: Interval
  currency: Currency
  /** Angebot, falls schon geladen (sonst lädt die Karte es selbst) */
  offer?: PublicOffer | null
  /** Free: zum Paketvergleich springen */
  onUpgrade?: () => void
}) {
  const { account, refreshAccount } = useAccount()
  const { fmtMoney, fmtDate } = useI18n()
  const m = useMessages(billingMessages).superSafe
  const errText = useErrorText()
  const [loaded, setLoaded] = useState<PublicOffer | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!offer) api.offer().then(setLoaded).catch(() => undefined)
  }, [offer])

  const o = offer ?? loaded
  if (!account || !o) return null
  const s = account.billing.superSafe
  const isFree = account.plan === 'free'
  const own = s.active && !s.inherited
  // Abo-Inhaber zahlen in Währung und Rhythmus ihres Abos; sonst die gewählte Anzeige
  const showOwn = own || (!isFree && !s.member)
  const cur: Currency = showOwn ? s.currency : currency
  const per: Interval = showOwn ? s.interval : interval
  const unit = showOwn ? s.unitPrice : o.superSafe.perTb[per === 'year' ? 'yearly' : 'monthly'][cur]
  const money = (v: number) => fmtMoney(v, cur, Number.isInteger(v) ? 0 : 2)
  const perLabel = per === 'year' ? m.perYear : m.perMonth

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      await refreshAccount()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <div className="card plansection supersafe">
      <div className="plansection-head">
        <h3>
          <Icon name="shield" size={16} /> {m.title}
        </h3>
        {s.active ? (
          <span className="badge ok">
            {m.active}
            {own && s.since ? ` · ${fmt(m.since, { date: fmtDate(s.since) })}` : ''}
          </span>
        ) : (
          <span className="dim">{fmt(m.benefit, { copies: s.copies, base: s.baseCopies })}</span>
        )}
      </div>
      <div className="supersafe-body">
        <div>
          <p className="supersafe-benefit">{fmt(m.benefit, { copies: s.copies, base: s.baseCopies })}</p>
          <p className="hint">{fmt(m.lead, { rest: Math.max(1, s.copies - 1) })}</p>
          {showOwn && <p className="hint">{m.quotaNote}</p>}
        </div>
        <div className="supersafe-price">
          {showOwn ? (
            <>
              <b className="addon-price">{money(s.price)}</b>
              <span className="dim">{perLabel}</span>
              <span className="dim">{fmt(m.forQuota, { tb: s.tb, perTb: fmt(m.perTb, { price: money(unit) }) })}</span>
            </>
          ) : (
            <>
              <b className="addon-price">{fmt(m.perTb, { price: money(unit) })}</b>
              <span className="dim">{perLabel}</span>
            </>
          )}
          <div className="addon-act">
            {own ? (
              <>
                {s.source === 'admin' && <span className="dim">{m.grant}</span>}
                <button className="linkish" disabled={busy} onClick={() => setConfirm(true)}>
                  {m.cancel}
                </button>
              </>
            ) : s.inherited ? (
              <span className="dim">{m.inherited}</span>
            ) : s.member ? (
              <span className="dim">{m.memberLocked}</span>
            ) : isFree ? (
              <button className="small locked" data-tip={m.locked} aria-label={`${m.book} – ${m.locked}`} onClick={onUpgrade} disabled={!onUpgrade}>
                <Icon name="lock" size={13} /> {m.upgrade}
              </button>
            ) : s.available ? (
              <button className="small primary" disabled={busy || !o.purchasesEnabled} onClick={() => void run(() => api.buySuperSafe(), m.booked)}>
                {busy ? '…' : m.book}
              </button>
            ) : (
              <span className="dim">{m.unavailable}</span>
            )}
          </div>
        </div>
      </div>
      {isFree && <p className="hint supersafe-note">{m.locked}</p>}
      {msg && <div className={`${msg.ok ? 'notice' : 'errorbox'} supersafe-note`}>{msg.text}</div>}
      {confirm && (
        <ConfirmDialog
          title={m.confirmTitle}
          body={fmt(m.confirmBody, { base: s.baseCopies })}
          confirmLabel={m.confirm}
          cancelLabel={m.keep}
          busy={busy}
          onConfirm={() => void run(() => api.cancelSuperSafe(), fmt(m.cancelled, { base: s.baseCopies }))}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
