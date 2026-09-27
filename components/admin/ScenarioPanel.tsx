'use client'

import { useMemo, useState } from 'react'
import { DEFAULT_SCENARIO, chf, scenario, type PricingConfig, type ScenarioInput } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

const FIELDS: Array<{ key: keyof ScenarioInput; label: string; unit: string; step: number }> = [
  { key: 'users', label: 'Nutzer gesamt', unit: '', step: 1000 },
  { key: 'paidPct', label: 'davon zahlend', unit: '%', step: 0.5 },
  { key: 'familyPct', label: 'Zahlende mit Family', unit: '%', step: 5 },
  { key: 'yearlyPct', label: 'Abos jährlich', unit: '%', step: 5 },
  { key: 'chfPct', label: 'Kunden in CHF', unit: '%', step: 5 },
  { key: 'eurPct', label: 'Kunden in EUR', unit: '%', step: 5 },
  { key: 'usdPct', label: 'Kunden in USD', unit: '%', step: 5 },
  { key: 'freeUtilPct', label: 'Auslastung Free', unit: '%', step: 5 },
  { key: 'paidUtilPct', label: 'Auslastung Abos', unit: '%', step: 5 },
  { key: 'addonAttachPct', label: 'Abos mit Zusatzspeicher', unit: '%', step: 1 },
  { key: 'addonAvgGb', label: 'Ø Zusatzpaket', unit: 'GB', step: 100 },
  { key: 'paygPct', label: 'Free mit Pay-as-you-go', unit: '%', step: 0.5 },
  { key: 'paygAvgGb', label: 'Ø PAYG-Zusatz', unit: 'GB', step: 10 }
]

/** Hochrechnung mit genau der Formel der Ist-Auswertung – zum Planen von 10k, 100k, 1M Nutzern. */
export default function ScenarioPanel({ pricing }: { pricing: PricingConfig }) {
  const [s, setS] = useState<ScenarioInput>(DEFAULT_SCENARIO)
  const e = useMemo(() => scenario(pricing, s), [pricing, s])
  const paid = e.perPlan.filter(r => r.plan === 'pro' || r.plan === 'family').reduce((n, r) => n + r.accounts, 0)
  return (
    <div className="grid2">
      <div className="card">
        <h3>
          Annahmen <span>Branche: 2–4 % zahlend</span>
        </h3>
        <div className="formgrid">
          {FIELDS.map(f => (
            <label key={f.key} className="field">
              <span>
                {f.label} {f.unit && <span className="dim">({f.unit})</span>}
              </span>
              <input
                type="number"
                min={0}
                step={f.step}
                value={s[f.key]}
                onChange={ev => setS(prev => ({ ...prev, [f.key]: Math.max(0, Number(ev.target.value) || 0) }))}
              />
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {[10_000, 100_000, 1_000_000].map(n => (
            <button key={n} className="small" onClick={() => setS(prev => ({ ...prev, users: n }))}>
              {n.toLocaleString('de-CH')} Nutzer
            </button>
          ))}
          <button className="small" onClick={() => setS(DEFAULT_SCENARIO)}>
            Zurücksetzen
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Ergebnis pro Monat</h3>
        <div className="stat">
          <span className="k">Zahlende Kunden</span>
          <span className="v">{paid.toLocaleString('de-CH')}</span>
        </div>
        <div className="stat">
          <span className="k">Gespeichert (Fil One)</span>
          <span className="v">{formatBytes(e.storedBytes)}</span>
        </div>
        <div className="stat">
          <span className="k">Umsatz</span>
          <span className="v">{chf(e.revenue.totalChf, 0)}</span>
        </div>
        <div className="stat">
          <span className="k">Fil One</span>
          <span className="v">{chf(e.cost.storageChf, 0)}</span>
        </div>
        <div className="stat">
          <span className="k">Stripe-Gebühren</span>
          <span className="v">{chf(e.cost.stripeChf, 0)}</span>
        </div>
        <div className="stat">
          <span className="k">
            <strong>Rohertrag</strong>
          </span>
          <span className="v" style={{ color: e.grossProfitChf >= 0 ? 'var(--green)' : 'var(--red)' }}>
            <strong>{chf(e.grossProfitChf, 0)}</strong> · {e.grossMarginPct.toFixed(1)} %
          </span>
        </div>
        <div className="stat">
          <span className="k">davon Free-Tier (geschenkt)</span>
          <span className="v">
            {chf(e.freeTier.subsidyChf, 0)} · Worst Case {chf(e.freeTier.worstCaseChf, 0)}
          </span>
        </div>
        <div className="stat">
          <span className="k">Pro-Kunden zur Deckung des Free-Tiers</span>
          <span className="v">{e.freeTier.proCustomersToCover.toLocaleString('de-CH')}</span>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Rohertrag vor Personal, Hosting, Support, Marketing und Steuern. Jahresumsatz ≈ {chf(e.revenue.totalChf * 12, 0)}.
        </p>
      </div>
    </div>
  )
}
