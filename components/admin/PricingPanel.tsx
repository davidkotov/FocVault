'use client'

import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/features/api/client'
import {
  CURRENCIES,
  chf,
  costChfPerGb,
  stripeFee,
  toChf,
  yearlySavingsPct,
  type Currency,
  type Money,
  type PricingConfig
} from '@/lib/pricing'

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

/** Drei Währungen nebeneinander. */
function MoneyRow({ label, value, onChange, step = 0.1 }: { label: string; value: Money; onChange: (c: Currency, v: number) => void; step?: number }) {
  return (
    <div className="moneyrow">
      <span className="moneylabel">{label}</span>
      {CURRENCIES.map(c => (
        <label key={c} className="field">
          <span className="dim">{c}</span>
          <input type="number" step={step} min={0} value={value[c]} onChange={e => onChange(c, Number(e.target.value))} />
        </label>
      ))}
    </div>
  )
}

/** Worst-Case-Marge (Quota voll ausgenutzt), gerechnet in CHF über alle Währungen – schlechteste zählt. */
function worstMargin(p: PricingConfig, price: Money, gb: number, months = 1): { pct: number; chf: number } {
  let worst = { pct: 100, chf: Infinity }
  for (const c of CURRENCIES) {
    const revenue = toChf(p, price[c], c) / months
    const cost = gb * costChfPerGb(p) + stripeFee(p, toChf(p, price[c], c)) / months
    const m = { chf: revenue - cost, pct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0 }
    if (m.pct < worst.pct) worst = m
  }
  return worst
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

  const Margin = ({ monthly, yearly, gb }: { monthly: Money; yearly: Money; gb: number }) => {
    const mm = worstMargin(p, monthly, gb)
    const my = worstMargin(p, yearly, gb, 12)
    return (
      <span className="hint" style={{ color: mm.chf < 0 || my.chf < 0 ? 'var(--red)' : undefined }}>
        Worst-Case-Marge (voll ausgenutzt, schlechteste Währung): Monat {mm.pct.toFixed(0)} % · Jahr {my.pct.toFixed(0)} % · Jahresrabatt{' '}
        {yearlySavingsPct({ monthly, yearly }, 'CHF')} %
      </span>
    )
  }

  const paygMarkup = toChf(p, p.payg.perGbMonth.CHF, 'CHF') / costChfPerGb(p)

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="card">
        <h3>
          Pakete <span>Preise je Währung – feste Preispunkte, nicht umgerechnet</span>
        </h3>
        <div className="formgrid">
          <Num label="Free-Speicher" unit="GB" step={1} value={p.free.quotaGb} onChange={v => set(d => void (d.free.quotaGb = v))} />
          <Num label="Pro Speicher" unit="GB" step={100} value={p.plans.pro.quotaGb} onChange={v => set(d => void (d.plans.pro.quotaGb = v))} />
          <Num label="Family Speicher" unit="GB" step={100} value={p.plans.family.quotaGb} onChange={v => set(d => void (d.plans.family.quotaGb = v))} />
          <Num label="Family Mitglieder" step={1} value={p.plans.family.seats} onChange={v => set(d => void (d.plans.family.seats = v))} />
        </div>
        <MoneyRow label="Pro monatlich" value={p.plans.pro.monthly} onChange={(c, v) => set(d => void (d.plans.pro.monthly[c] = v))} />
        <MoneyRow label="Pro jährlich" value={p.plans.pro.yearly} step={1} onChange={(c, v) => set(d => void (d.plans.pro.yearly[c] = v))} />
        <Margin monthly={p.plans.pro.monthly} yearly={p.plans.pro.yearly} gb={p.plans.pro.quotaGb} />
        <MoneyRow label="Family monatlich" value={p.plans.family.monthly} onChange={(c, v) => set(d => void (d.plans.family.monthly[c] = v))} />
        <MoneyRow label="Family jährlich" value={p.plans.family.yearly} step={1} onChange={(c, v) => set(d => void (d.plans.family.yearly[c] = v))} />
        <Margin monthly={p.plans.family.monthly} yearly={p.plans.family.yearly} gb={p.plans.family.quotaGb} />
      </div>

      <div className="card">
        <h3>
          Pay-as-you-go <span>{paygMarkup.toFixed(1)}× Aufschlag auf Fil One</span>
        </h3>
        <MoneyRow label="Preis pro GB/Monat" value={p.payg.perGbMonth} step={0.001} onChange={(c, v) => set(d => void (d.payg.perGbMonth[c] = v))} />
        <MoneyRow label="Mindestrechnung" value={p.payg.minInvoice} onChange={(c, v) => set(d => void (d.payg.minInvoice[c] = v))} />
        <div className="formgrid">
          <Num label="Standard-Obergrenze" unit="GB" step={10} value={p.payg.defaultCapGb} onChange={v => set(d => void (d.payg.defaultCapGb = v))} />
          <Num label="Maximale Obergrenze" unit="GB" step={100} value={p.payg.maxCapGb} onChange={v => set(d => void (d.payg.maxCapGb = v))} />
        </div>
        <span className="hint">
          Marge {((1 - 1 / paygMarkup) * 100).toFixed(0)} % · 1 TB PAYG = {chf(p.payg.perGbMonth.CHF * 1000)} (Pro 1 TB {chf(p.plans.pro.monthly.CHF)}) →
          Pro lohnt sich ab {Math.ceil(p.plans.pro.monthly.CHF / p.payg.perGbMonth.CHF)} GB extra. Beträge unter der Mindestrechnung werden übertragen.
        </span>
      </div>

      <div className="card">
        <h3>Zusatzspeicher (für Abos)</h3>
        {p.addons.map((a, i) => (
          <div key={a.id} style={{ marginBottom: 14 }}>
            <div className="formgrid">
              <Num label={`Paket ${i + 1}`} unit="GB" step={100} value={a.gb} onChange={v => set(d => void (d.addons[i].gb = v))} />
            </div>
            <MoneyRow label="monatlich" value={a.monthly} onChange={(c, v) => set(d => void (d.addons[i].monthly[c] = v))} />
            <MoneyRow label="jährlich" value={a.yearly} step={1} onChange={(c, v) => set(d => void (d.addons[i].yearly[c] = v))} />
            <Margin monthly={a.monthly} yearly={a.yearly} gb={a.gb} />
          </div>
        ))}
        <div className="row">
          <button
            className="small"
            disabled={p.addons.length >= 12}
            onClick={() =>
              set(d =>
                void d.addons.push({
                  id: `plus-${Date.now().toString(36)}`,
                  gb: 5000,
                  monthly: { CHF: 39.9, EUR: 39.9, USD: 44.9 },
                  yearly: { CHF: 399, EUR: 399, USD: 449 }
                })
              )
            }
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

      <div className="grid2">
        <div className="card">
          <h3>Kosten, Kurse &amp; Gebühren</h3>
          <div className="formgrid">
            <Num label="Fil One" unit="USD/TB/Monat" value={p.filOneUsdPerTbMonth} onChange={v => set(d => void (d.filOneUsdPerTbMonth = v))} />
            <Num label="Fil One Minimum" unit="USD/Monat" value={p.filOneMinUsd} onChange={v => set(d => void (d.filOneMinUsd = v))} />
            <Num label="Kurs USD" unit="CHF je USD" step={0.001} value={p.fx.usdToChf} onChange={v => set(d => void (d.fx.usdToChf = v))} />
            <Num label="Kurs EUR" unit="CHF je EUR" step={0.001} value={p.fx.eurToChf} onChange={v => set(d => void (d.fx.eurToChf = v))} />
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
          <span className="hint">Branchenüblich (Dropbox, MEGA): inaktive Gratis-Konten nach 12–18 Monaten mit Vorankündigung löschen.</span>
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
