'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, type AdminAccountListRow } from '@/features/api/client'
import type { Plan } from '@/lib/api-types'
import { money, type PricingConfig } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

const PLANS: Plan[] = ['free', 'pro', 'family', 'business']
const PAGE = 50

/** Kontenverwaltung mit Suche und Seiten (skaliert auf 100 000+), Plan, PAYG und Zusatzspeicher. */
export default function AccountsPanel({ pricing, onChanged }: { pricing: PricingConfig; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; rows: AdminAccountListRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.adminAccounts(q, offset))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [q, offset])

  useEffect(() => {
    const t = setTimeout(() => void load(), 250)
    return () => clearTimeout(t)
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="card">
      <h3>
        Konten <span>{data ? data.total.toLocaleString('de-CH') : '…'}</span>
      </h3>
      {error && <div className="errorbox">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          placeholder="Suchen: E-Mail, Name oder Wallet-Adresse"
          value={q}
          onChange={e => {
            setQ(e.target.value)
            setOffset(0)
          }}
          style={{ maxWidth: 420 }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admintable">
          <thead>
            <tr>
              <th>Konto</th>
              <th>Paket</th>
              <th>Belegt / Quota</th>
              <th>Pay-as-you-go</th>
              <th>Zusatzspeicher</th>
              <th>Letzter Login</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(r => {
              const quota = (r.quotaGb + r.addonsGb + (r.paygEnabled ? (r.paygCapGb ?? pricing.payg.defaultCapGb) : 0)) * 1e9
              return (
                <tr key={r.id}>
                  <td title={r.id}>
                    {r.display}
                    {r.status !== 'active' && <span className="badge err" style={{ marginLeft: 6 }}>{r.status}</span>}
                  </td>
                  <td>
                    <select
                      value={r.plan}
                      aria-label={`Paket für ${r.display}`}
                      onChange={e => void act(() => api.adminUpdateAccount(r.id, { plan: e.target.value as Plan }))}
                    >
                      {PLANS.map(p => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    {r.plan !== 'free' && (
                      <span className="dim" style={{ marginLeft: 6, fontSize: 12 }}>
                        {r.interval === 'year' ? 'jährlich' : 'monatlich'} · {r.currency}
                      </span>
                    )}
                  </td>
                  <td>
                    {formatBytes(r.storedBytes)} / {formatBytes(quota)}
                  </td>
                  <td>
                    {r.plan === 'free' ? (
                      <label className="checkline" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={r.paygEnabled}
                          onChange={e => void act(() => api.adminUpdateAccount(r.id, { paygEnabled: e.target.checked }))}
                        />
                        <span>{r.paygEnabled ? `bis ${r.paygCapGb ?? pricing.payg.defaultCapGb} GB` : 'aus'}</span>
                      </label>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>
                    {r.addonsGb > 0 ? `${r.addonsGb.toLocaleString('de-CH')} GB · ${money(r.addonsMonthly, r.currency)}/Mt.` : <span className="dim">—</span>}
                    {(r.plan === 'pro' || r.plan === 'family') && (
                      <button
                        className="small"
                        style={{ marginLeft: 8 }}
                        title="Kulanz: 100 GB gratis gutschreiben"
                        onClick={() => void act(() => api.adminGrantAddon(r.id, { gb: 100, price: 0, note: 'Kulanz (Admin)' }))}
                      >
                        +100 GB
                      </button>
                    )}
                    {r.plan !== 'free' && (
                      <button
                        className="small"
                        style={{ marginLeft: 8 }}
                        title={r.superSafe ? 'Super Safe beenden (zusätzliche Filecoin-Kopien werden entfernt)' : 'Kulanz: Super Safe gratis freischalten'}
                        onClick={() => void act(() => api.adminSetSuperSafe(r.id, { enabled: !r.superSafe, note: 'Kulanz (Admin)' }))}
                      >
                        {r.superSafe ? 'Super Safe aus' : 'Super Safe'}
                      </button>
                    )}
                  </td>
                  <td className="dim">{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString('de-CH') : 'nie'}</td>
                </tr>
              )
            })}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="dim">
                  Keine Konten gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > PAGE && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="small" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>
            ← Zurück
          </button>
          <span className="dim">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} von {data.total.toLocaleString('de-CH')}
          </span>
          <button className="small" disabled={offset + PAGE >= data.total} onClick={() => setOffset(o => o + PAGE)}>
            Weiter →
          </button>
        </div>
      )}
    </div>
  )
}
