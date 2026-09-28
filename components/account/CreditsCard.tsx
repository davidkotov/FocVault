'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/site/Icons'
import { api, isRedirect, type CreditsView } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'

const AMOUNTS = [10, 25, 50, 100]

/** Guthaben: aufladen per Karte (Stripe) oder Krypto (bald), Zahlungsmethode, Buchungen. */
export default function CreditsCard({ onChanged }: { onChanged?: () => void }) {
  const m = useMessages(appMessages).credits
  const { fmtMoney, fmtDate } = useI18n()
  const errText = useErrorText()
  const [v, setV] = useState<CreditsView | null>(null)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(25)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => api.credits().then(setV).catch(e => setMsg({ ok: false, text: errText(e) })), [errText])
  useEffect(() => {
    void load()
    const q = new URLSearchParams(window.location.search)
    if (q.get('credit') === 'ok') setMsg({ ok: true, text: m.paid })
    if (q.get('card') === 'ok') setMsg({ ok: true, text: m.cardAdded })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (fn: () => Promise<{ redirectUrl?: string } | unknown>, ok?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = (await fn()) as { redirectUrl?: string }
      if (r && isRedirect(r)) return void (window.location.href = r.redirectUrl!)
      if (ok) setMsg({ ok: true, text: ok })
      setOpen(false)
      await load()
      onChanged?.()
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!v) return null
  return (
    <div className="card credits" id="credits-card">
      <h3>
        {m.title}
        <span>{m.sub}</span>
      </h3>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="creditstop">
        <div>
          <div className="k">{m.balance}</div>
          <div className="creditbal">{fmtMoney(v.balance, v.currency)}</div>
          <div className="hint">{m.usage}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" disabled={busy} onClick={() => setOpen(o => !o)}>
            <Icon name="card" size={16} className="inlineicon" /> {m.depositCard}
          </button>
          <button disabled title={m.soon}>
            <Icon name="chain" size={16} className="inlineicon" /> {m.depositCrypto} <span className="badge">{m.soon}</span>
          </button>
        </div>
      </div>
      {open && (
        <div className="creditpick">
          <div className="chips">
            {AMOUNTS.map(a => (
              <button key={a} type="button" className={`chip${amount === a ? ' active' : ''}`} onClick={() => setAmount(a)}>
                {fmtMoney(a, v.currency, 0)}
              </button>
            ))}
            <input type="number" min={5} max={5000} step={1} value={amount} onChange={e => setAmount(Number(e.target.value))} aria-label={m.custom} className="creditcustom" />
          </div>
          <button className="primary" disabled={busy || amount < 5 || amount > 5000} onClick={() => void go(() => api.deposit(amount), fmt(m.added, { amount: fmtMoney(amount, v.currency) }))}>
            {v.stripe ? fmt(m.payNow, { amount: fmtMoney(amount, v.currency) }) : fmt(m.addDev, { amount: fmtMoney(amount, v.currency) })}
          </button>
        </div>
      )}
      <div className="creditrow">
        <Icon name="card" size={18} />
        <div style={{ flex: 1 }}>
          <b>{m.method}</b>
          <div className="hint">{v.hasPaymentMethod ? m.methodOk : v.stripe ? m.methodNone : m.methodNoStripe}</div>
        </div>
        {v.stripe && (
          <button className="small" disabled={busy} onClick={() => void go(() => api.addPaymentMethod())}>
            {v.hasPaymentMethod ? m.methodChange : m.methodAdd}
          </button>
        )}
      </div>
      {v.history.length > 0 && (
        <div className="credithist">
          {v.history.slice(0, 8).map(h => (
            <div className="credititem" key={h.id}>
              <span className="dim">{fmtDate(h.createdAt)}</span>
              <span>{h.note ?? m.kinds[h.kind]}</span>
              <b className={h.amount < 0 ? 'neg' : 'pos'}>
                {h.amount > 0 ? '+' : ''}
                {fmtMoney(h.amount, h.currency)}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
