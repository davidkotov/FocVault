'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, type TreasuryStatus } from '@/features/api/client'
import { chf } from '@/lib/pricing'

/**
 * Finanzierung des Free-Speichers. Fil One rechnet per Kreditkarte (Stripe) ab – dafür ist keine
 * Wallet nötig. Die USDFC-Reserve ist optional: öffentliche Adresse hinterlegen, Saldo wird live
 * gelesen und in Monate Laufzeit umgerechnet. Nie private Schlüssel eingeben.
 */
export default function TreasuryPanel() {
  const [t, setT] = useState<TreasuryStatus | null>(null)
  const [address, setAddress] = useState('')
  const [chainId, setChainId] = useState<314 | 314159>(314)
  const [label, setLabel] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await api.adminTreasury()
      setT(s)
      setAddress(s.address)
      setChainId(s.chainId)
      setLabel(s.label)
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      setT(await api.adminSaveTreasury({ address: address.trim(), chainId, label }))
      setMsg({ ok: true, text: 'Reserve gespeichert.' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Speichern fehlgeschlagen.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="grid2">
        <div className="card">
          <h3>
            Fil One – laufende Rechnung <span>Stripe, Kreditkarte</span>
          </h3>
          <div className="stat">
            <span className="k">Voraussichtliche Rechnung diesen Monat</span>
            <span className="v">${(t?.monthlyCostUsd ?? 0).toFixed(2)}</span>
          </div>
          <div className="stat">
            <span className="k">Abrechnung</span>
            <span className="v">Tagesdurchschnitt · $4.99/TB · Minimum $4.99</span>
          </div>
          <div className="stat">
            <span className="k">Zahlungsweg</span>
            <span className="v">Firmenkreditkarte im Fil-One-Dashboard</span>
          </div>
          <div className="notice" style={{ marginTop: 12 }}>
            <strong>Kritisch:</strong> Schlägt eine Fil-One-Zahlung fehl, sperrt Fil One <em>sofort alle Uploads</em> – für alle
            Nutzer. Hinterlegt eine Ersatzkarte und aktiviert Zahlungs-E-Mails im Fil-One-Dashboard.
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Für die Free-Nutzer braucht es keine Einzahlung pro Konto: Es gibt eine einzige Monatsrechnung für den gesamten
            belegten Speicher – bei 100 000 Nutzern genauso wie bei 10.
          </p>
        </div>

        <div className="card">
          <h3>
            Krypto-Reserve (optional) <span>USDFC · nur lesen</span>
          </h3>
          <div className="field">
            <label htmlFor="tr-label">Bezeichnung</label>
            <input id="tr-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Reserve Free-Tier" />
          </div>
          <div className="field">
            <label htmlFor="tr-addr">Öffentliche Wallet-Adresse</label>
            <input
              id="tr-addr"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x…"
              style={{ fontFamily: 'var(--mono)' }}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="hint">Nur die Adresse – niemals einen privaten Schlüssel oder eine Seed-Phrase eingeben.</span>
          </div>
          <div className="field">
            <label htmlFor="tr-chain">Netzwerk</label>
            <select id="tr-chain" value={chainId} onChange={e => setChainId(Number(e.target.value) as 314 | 314159)}>
              <option value={314}>Filecoin Mainnet</option>
              <option value={314159}>Filecoin Calibration (Test)</option>
            </select>
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void save()}>
              Speichern
            </button>
            <button onClick={() => void load()}>Saldo aktualisieren</button>
          </div>
          {t?.address && (
            <div style={{ marginTop: 14 }}>
              {t.error ? (
                <div className="errorbox">{t.error}</div>
              ) : t.balances ? (
                <>
                  <div className="stat">
                    <span className="k">USDFC</span>
                    <span className="v">{t.balances.usdfc.toLocaleString('de-CH', { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="stat">
                    <span className="k">FIL (Gas)</span>
                    <span className="v">{t.balances.fil.toLocaleString('de-CH', { maximumFractionDigits: 4 })}</span>
                  </div>
                  <div className="stat">
                    <span className="k">Deckt Fil-One-Kosten für</span>
                    <span className="v">
                      <strong>{t.runwayMonths !== null ? `${t.runwayMonths.toLocaleString('de-CH')} Monate` : '—'}</strong>
                    </span>
                  </div>
                </>
              ) : null}
              <p className="hint" style={{ marginTop: 8 }}>
                Fil One nimmt heute kein USDFC. Die Reserve ist eine Rücklage (Umtausch nach Bedarf) – oder Zahlungsquelle, falls
                ihr zusätzlich direkt über Filecoin Onchain Cloud speichert. {t.monthlyCostUsd > 0 && `Monatskosten aktuell ≈ ${chf(t.monthlyCostUsd, 2).replace(' CHF', ' USD')}.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
