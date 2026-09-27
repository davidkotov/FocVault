'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { api, errorMessage, type PublicOffer } from '@/features/api/client'
import { chf } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

/** Speicher erweitern: Free → Pay-as-you-go oder Abo; Abos → Zusatzspeicher. */
export default function StorageOptions() {
  const { account, refreshAccount } = useAccount()
  const [offer, setOffer] = useState<PublicOffer | null>(null)
  const [capGb, setCapGb] = useState(100)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.offer().then(o => {
      setOffer(o)
      setCapGb(o.payg.defaultCapGb)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (account?.billing.payg.enabled) setCapGb(account.billing.payg.capGb)
  }, [account?.billing.payg.enabled, account?.billing.payg.capGb])

  if (!account || !offer) return null
  const b = account.billing
  const isFree = account.plan === 'free'
  const isSub = account.plan === 'pro' || account.plan === 'family'

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    setMsg(null)
    try {
      await fn()
      await refreshAccount()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <h3>
        Speicher &amp; Abrechnung <span>{chf(b.monthlyChf)} / Monat</span>
      </h3>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <div className="stat">
        <span className="k">Belegt</span>
        <span className="v">
          {formatBytes(account.usedBytes)} von {formatBytes(account.quotaBytes)}
        </span>
      </div>
      <div className="stat">
        <span className="k">{isFree ? 'Free' : account.plan === 'pro' ? offer.plans.pro.label : offer.plans.family.label}</span>
        <span className="v">
          {formatBytes(b.baseBytes)} · {chf(b.planChf)}
        </span>
      </div>

      {isFree && (
        <>
          <div className="stat">
            <span className="k">Pay-as-you-go</span>
            <span className="v">
              {b.payg.enabled ? `aktiv bis ${b.payg.capGb} GB · Schätzung ${chf(b.payg.estimateChf)}` : 'aus'}
            </span>
          </div>
          <p className="hint" style={{ margin: '8px 0' }}>
            Über {offer.free.quotaGb} GB zahlst du {(offer.payg.chfPerGbMonth * 100).toFixed(0)} Rappen pro GB und Monat –
            abgerechnet ab {chf(offer.payg.minInvoiceChf)}. Die Obergrenze schützt vor Überraschungen.
          </p>
          <div className="row">
            <label className="field" style={{ maxWidth: 180, marginBottom: 0 }}>
              <span className="hint">Obergrenze (GB)</span>
              <input
                type="number"
                min={1}
                max={offer.payg.maxCapGb}
                value={capGb}
                onChange={e => setCapGb(Math.max(1, Math.min(offer.payg.maxCapGb, Number(e.target.value) || 1)))}
              />
            </label>
            {b.payg.enabled ? (
              <>
                <button
                  className="small"
                  disabled={!!busy}
                  onClick={() => void run('payg', () => api.setPayg(true, capGb), 'Obergrenze gespeichert.')}
                >
                  Grenze speichern
                </button>
                <button
                  className="small"
                  disabled={!!busy}
                  onClick={() => void run('payg', () => api.setPayg(false), 'Pay-as-you-go deaktiviert.')}
                >
                  Deaktivieren
                </button>
              </>
            ) : (
              <button
                className="primary small"
                disabled={!!busy || !offer.purchasesEnabled}
                onClick={() => void run('payg', () => api.setPayg(true, capGb), 'Pay-as-you-go aktiviert.')}
              >
                Pay-as-you-go aktivieren
              </button>
            )}
          </div>
          <div className="storeoptions">
            {[offer.plans.pro, offer.plans.family].map(p => (
              <div className="storeoption" key={p.label}>
                <span className="gb">
                  {p.label} · {p.quotaGb >= 1000 ? `${p.quotaGb / 1000} TB` : `${p.quotaGb} GB`}
                </span>
                <span className="price">{chf(p.chfPerMonth)} / Monat · alle Module</span>
                <span className="hint">Online-Abschluss via Stripe folgt.</span>
              </div>
            ))}
          </div>
        </>
      )}

      {isSub && (
        <>
          {b.addons.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {b.addons.map(a => (
                <div className="stat" key={a.id}>
                  <span className="k">
                    Zusatz {a.gb.toLocaleString('de-CH')} GB {a.source === 'admin' ? '(Gutschrift)' : ''}
                  </span>
                  <span className="v">
                    {chf(a.chfPerMonth)}{' '}
                    <button
                      className="small"
                      disabled={!!busy}
                      onClick={() => void run(a.id, () => api.cancelAddon(a.id), 'Zusatzspeicher gekündigt.')}
                    >
                      Kündigen
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 12 }}>
            Zusatzspeicher dazubuchen – monatlich kündbar:
          </div>
          <div className="storeoptions">
            {offer.addons.map(a => (
              <div className="storeoption" key={a.id}>
                <span className="gb">+{a.gb >= 1000 ? `${a.gb / 1000} TB` : `${a.gb} GB`}</span>
                <span className="price">{chf(a.chfPerMonth)} / Monat</span>
                <button
                  className="small primary"
                  disabled={!!busy || !offer.purchasesEnabled}
                  onClick={() => void run(a.id, () => api.buyAddon(a.id), `+${a.gb} GB gebucht.`)}
                >
                  {busy === a.id ? '…' : 'Buchen'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {!offer.purchasesEnabled && (
        <p className="hint" style={{ marginTop: 10 }}>
          Online-Zahlung (Stripe) folgt in Kürze – bis dahin schaltet der Support frei.
        </p>
      )}
      {offer.purchasesEnabled && (
        <p className="hint" style={{ marginTop: 10 }}>
          Entwicklungsmodus: Buchungen werden ohne Zahlung aktiviert.
          {account.isAdmin && (
            <>
              {' '}
              Pakete wechseln im <Link href="/admin">Admin-Bereich</Link>.
            </>
          )}
        </p>
      )}
    </div>
  )
}
