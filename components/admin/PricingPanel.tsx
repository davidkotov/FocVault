'use client'

import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/features/api/client'
import { chf, costChfPerGb, stripeFee, type PricingConfig } from '@/lib/pricing'

function Num({ label, value, onChange, step = 0.01, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string }) {
  return (
    <label className="field">
      <span>
        {label} {unit && <span className="dim">({unit})</span>}
      </span>
      <input type="number" step={step} min={0} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  )
}

/** Worst-Case-Marge (Quota voll ausgenutzt) – zeigt sofort, ob ein Preis unter die Kosten rutscht. */
function margin(p: PricingConfig, price: number, gb: number): { pct: number; chf: number } {
  const cost = gb * costChfPerGb(p) + stripeFee(p, price)
  return { chf: price - cost, pct: price > 0 ? ((price - cost) / price) * 100 : 0 }
}

export default function PricingPanel({ onSaved }: { onSaved: () => void }) {
  const [p, setP] = useState<PricingConfig | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.adminPricing().then(setP).catch(e => setMsg({ ok: false, text: errorMessage(e) }))
  }, [])

  if (!p) return <div className="card">{msg ? <div className="errorbox">{msg.text}</div> : 'Lade Preisbuch …'}</div>

  const set = (fn: (d: PricingConfig) => void) =>
    setP(prev => {
      const next = structuredClone(prev!)
      fn(next)
      return next
    })

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      setP(await api.adminSavePricing(p))
      setMsg({ ok: true, text: 'Preisbuch gespeichert – wirkt sofort auf Quoten und Auswertungen.' })
      onSaved()
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Speichern fehlgeschlagen.') })
    } finally {
      setBusy(false)
    }
  }

  const Margin = ({ price, gb }: { price: number; gb: number }) => {
    const m = margin(p, price, gb)
    return (
      <span className="hint" style={{ color: m.chf < 0 ? 'var(--red)' : undefined }}>
        Worst-Case-Marge (voll ausgenutzt): {chf(m.chf)} · {m.pct.toFixed(0)} %
      </span>
    )
  }

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="grid2">
        <div className="card">
          <h3>Pakete</h3>
          <div className="formgrid">
            <Num label="Free-Speicher" unit="GB" step={1} value={p.free.quotaGb} onChange={v => set(d => void (d.free.quotaGb = v))} />
            <Num label="PAYG-Preis" unit="CHF/GB/Monat" step={0.001} value={p.payg.chfPerGbMonth} onChange={v => set(d => void (d.payg.chfPerGbMonth = v))} />
            <Num label="PAYG-Mindestrechnung" unit="CHF" value={p.payg.minInvoiceChf} onChange={v => set(d => void (d.payg.minInvoiceChf = v))} />
            <Num label="PAYG-Standardgrenze" unit="GB" step={10} value={p.payg.defaultCapGb} onChange={v => set(d => void (d.payg.defaultCapGb = v))} />
          </div>
          <span className="hint">
            PAYG-Aufschlag auf Fil One: {(p.payg.chfPerGbMonth / costChfPerGb(p)).toFixed(1)}× · 1 TB PAYG ={' '}
            {chf(p.payg.chfPerGbMonth * 1000)} (Pro mit 1 TB: {chf(p.plans.pro.chfPerMonth)}) → macht das Abo attraktiv.
          </span>
          <div className="formgrid" style={{ marginTop: 14 }}>
            <Num label="Pro Speicher" unit="GB" step={100} value={p.plans.pro.quotaGb} onChange={v => set(d => void (d.plans.pro.quotaGb = v))} />
            <Num label="Pro Preis" unit="CHF/Monat" step={0.1} value={p.plans.pro.chfPerMonth} onChange={v => set(d => void (d.plans.pro.chfPerMonth = v))} />
          </div>
          <Margin price={p.plans.pro.chfPerMonth} gb={p.plans.pro.quotaGb} />
          <div className="formgrid" style={{ marginTop: 14 }}>
            <Num label="Family Speicher" unit="GB" step={100} value={p.plans.family.quotaGb} onChange={v => set(d => void (d.plans.family.quotaGb = v))} />
            <Num label="Family Preis" unit="CHF/Monat" step={0.1} value={p.plans.family.chfPerMonth} onChange={v => set(d => void (d.plans.family.chfPerMonth = v))} />
          </div>
          <Margin price={p.plans.family.chfPerMonth} gb={p.plans.family.quotaGb} />
        </div>

        <div className="card">
          <h3>Zusatzspeicher (für Abos)</h3>
          {p.addons.map((a, i) => (
            <div key={a.id} style={{ marginBottom: 10 }}>
              <div className="formgrid">
                <Num label={`Paket ${i + 1}`} unit="GB" step={100} value={a.gb} onChange={v => set(d => void (d.addons[i].gb = v))} />
                <Num label="Preis" unit="CHF/Monat" step={0.1} value={a.chfPerMonth} onChange={v => set(d => void (d.addons[i].chfPerMonth = v))} />
              </div>
              <Margin price={a.chfPerMonth} gb={a.gb} />
            </div>
          ))}
          <div className="row">
            <button
              className="small"
              disabled={p.addons.length >= 12}
              onClick={() => set(d => void d.addons.push({ id: `plus-${Date.now().toString(36)}`, gb: 5000, chfPerMonth: 39.9 }))}
            >
              + Paket
            </button>
            {p.addons.length > 1 && (
              <button className="small" onClick={() => set(d => void d.addons.pop())}>
                Letztes entfernen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Kosten &amp; Gebühren</h3>
          <div className="formgrid">
            <Num label="Fil One" unit="USD/TB/Monat" value={p.filOneUsdPerTbMonth} onChange={v => set(d => void (d.filOneUsdPerTbMonth = v))} />
            <Num label="Fil One Minimum" unit="USD/Monat" value={p.filOneMinUsd} onChange={v => set(d => void (d.filOneMinUsd = v))} />
            <Num label="Kurs" unit="CHF je USD" step={0.001} value={p.usdToChf} onChange={v => set(d => void (d.usdToChf = v))} />
            <Num label="Stripe" unit="%" step={0.1} value={p.stripePercent} onChange={v => set(d => void (d.stripePercent = v))} />
            <Num label="Stripe fix" unit="CHF/Rechnung" value={p.stripeFixedChf} onChange={v => set(d => void (d.stripeFixedChf = v))} />
          </div>
          <span className="hint">Speicher kostet uns {(costChfPerGb(p) * 100).toFixed(3)} Rappen pro GB und Monat.</span>
        </div>
        <div className="card">
          <h3>Free-Tier-Regeln</h3>
          <div className="formgrid">
            <Num label="Monatsbudget Free" unit="CHF" step={50} value={p.freeTier.monthlyBudgetChf} onChange={v => set(d => void (d.freeTier.monthlyBudgetChf = v))} />
            <Num label="Warnung nach" unit="Tagen inaktiv" step={30} value={p.freeTier.inactiveWarnDays} onChange={v => set(d => void (d.freeTier.inactiveWarnDays = v))} />
            <Num label="Löschung nach" unit="Tagen inaktiv" step={30} value={p.freeTier.inactiveDeleteDays} onChange={v => set(d => void (d.freeTier.inactiveDeleteDays = v))} />
          </div>
          <span className="hint">
            Branchenüblich (Dropbox, MEGA): inaktive Gratis-Konten nach 12–18 Monaten mit Vorankündigung löschen.
          </span>
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Speichere …' : 'Preisbuch speichern'}
        </button>
      </div>
    </>
  )
}
