'use client'

import type { EconomicsReport } from '@/features/api/client'
import { chf } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

const PLAN_LABEL = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' } as const

/** Ist-Wirtschaftlichkeit: was kostet uns wer, was bringt wer – aus Echtdaten. */
export default function EconomicsPanel({ report }: { report: EconomicsReport }) {
  const { economics: e, pricing: p, history, inactiveFree, mix } = report
  const ft = e.freeTier
  const budgetState = ft.budgetUsedPct >= 100 ? 'err' : ft.budgetUsedPct >= 80 ? 'warn' : 'ok'
  const maxHist = Math.max(1, ...history.map(h => h.storedBytes))
  return (
    <>
      <div className="admintiles">
        <div className="admintile">
          <div className="k">Umsatz / Monat</div>
          <div className="v">{chf(e.revenue.totalChf)}</div>
          <div className="s">
            Abos {chf(e.revenue.proChf + e.revenue.familyChf, 0)} · Zusatz {chf(e.revenue.addonsChf, 0)} · PAYG{' '}
            {chf(e.revenue.paygChf, 0)}
          </div>
        </div>
        <div className="admintile">
          <div className="k">Kosten / Monat</div>
          <div className="v">{chf(e.cost.totalChf)}</div>
          <div className="s">
            Fil One ${e.cost.storageUsd.toFixed(2)} · Stripe {chf(e.cost.stripeChf, 2)}
          </div>
        </div>
        <div className="admintile">
          <div className="k">Rohertrag</div>
          <div className="v" style={{ color: e.grossProfitChf >= 0 ? 'var(--green)' : 'var(--red)' }}>{chf(e.grossProfitChf)}</div>
          <div className="s">Marge {e.grossMarginPct.toFixed(1)} %</div>
        </div>
        <div className="admintile">
          <div className="k">Gespeichert</div>
          <div className="v">{formatBytes(e.storedBytes)}</div>
          <div className="s">
            Fil One ${p.filOneUsdPerTbMonth}/TB · USD {p.fx.usdToChf} · EUR {p.fx.eurToChf}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>
            Free-Tier: was uns die Gratis-Nutzer kosten <span className={`badge ${budgetState === 'ok' ? 'ok' : 'err'}`}>{ft.budgetUsedPct.toFixed(0)} % Budget</span>
          </h3>
          <div className="stat">
            <span className="k">Free-Konten</span>
            <span className="v">{ft.accounts.toLocaleString('de-CH')}</span>
          </div>
          <div className="stat">
            <span className="k">Kosten heute (tatsächlich belegt)</span>
            <span className="v">{chf(ft.subsidyChf)} / Monat</span>
          </div>
          <div className="stat">
            <span className="k">pro Free-Konto</span>
            <span className="v">{(ft.perAccountChf * 100).toFixed(3)} Rappen / Monat</span>
          </div>
          <div className="stat">
            <span className="k">Worst Case (alle {p.free.quotaGb} GB voll)</span>
            <span className="v">{chf(ft.worstCaseChf)} / Monat</span>
          </div>
          <div className="stat">
            <span className="k">Budgetgrenze (Preisbuch)</span>
            <span className="v">{chf(ft.budgetChf)} / Monat</span>
          </div>
          <div className="stat">
            <span className="k">So viele Pro-Kunden finanzieren das</span>
            <span className="v">
              <strong>{ft.proCustomersToCover.toLocaleString('de-CH')}</strong>
            </span>
          </div>
          <div className="quotabar" style={{ marginTop: 12 }}>
            <div className={budgetState === 'err' ? 'full' : ''} style={{ width: `${Math.min(100, ft.budgetUsedPct)}%` }} />
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Bezahlt wird das über eine einzige Fil-One-Monatsrechnung (Stripe) für den gesamten Speicher – nicht pro Nutzer.
            Fil One rechnet den Tagesdurchschnitt ab: Nur tatsächlich belegte Bytes kosten, die Quota selbst nicht.
          </p>
        </div>

        <div className="card">
          <h3>Kostenkontrolle</h3>
          <div className="stat">
            <span className="k">Inaktiv &gt; {p.freeTier.inactiveWarnDays} Tage (Warn-E-Mail)</span>
            <span className="v">{inactiveFree.warn.toLocaleString('de-CH')}</span>
          </div>
          <div className="stat">
            <span className="k">Inaktiv &gt; {p.freeTier.inactiveDeleteDays} Tage (Löschung nach Ankündigung)</span>
            <span className="v">{inactiveFree.delete.toLocaleString('de-CH')}</span>
          </div>
          <div className="stat">
            <span className="k">Free-Quota</span>
            <span className="v">{p.free.quotaGb} GB</span>
          </div>
          <div className="stat">
            <span className="k">Pay-as-you-go</span>
            <span className="v">
              {(p.payg.perGbMonth.CHF * 100).toFixed(1)} Rp / GB · ab {chf(p.payg.minInvoice.CHF)}
            </span>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Hebel, falls das Budget knapp wird: Free-Quota für <em>neue</em> Konten senken, Inaktivitätsregel verschärfen,
            Budgetgrenze anheben. Alles im Tab „Preisbuch“ – wirkt sofort.
          </p>
          {history.length > 0 && (
            <>
              <div className="hint" style={{ marginTop: 14, marginBottom: 6 }}>
                Gespeichert, letzte {history.length} Tage
              </div>
              <div className="histbars">
                {history.map(h => (
                  <div key={h.day} title={`${h.day}: ${formatBytes(h.storedBytes)} · ${h.accounts} Konten`}>
                    <div style={{ height: `${Math.max(4, (h.storedBytes / maxHist) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Nach Paket</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="admintable">
            <thead>
              <tr>
                <th>Paket</th>
                <th>Konten</th>
                <th>Gespeichert</th>
                <th>Ø Auslastung</th>
                <th>Speicherkosten</th>
                <th>Umsatz</th>
                <th>Deckungsbeitrag</th>
              </tr>
            </thead>
            <tbody>
              {e.perPlan.map(r => (
                <tr key={r.plan}>
                  <td>{PLAN_LABEL[r.plan]}</td>
                  <td>{r.accounts.toLocaleString('de-CH')}</td>
                  <td>{formatBytes(r.storedBytes)}</td>
                  <td>{r.avgUtilPct.toFixed(1)} %</td>
                  <td>{chf(r.costChf)}</td>
                  <td>{chf(r.revenueChf)}</td>
                  <td style={{ color: r.revenueChf - r.costChf >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {chf(r.revenueChf - r.costChf)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Zusatzspeicher</td>
                <td colSpan={4} className="dim">
                  in den Speicherkosten der Pakete enthalten
                </td>
                <td>{chf(e.revenue.addonsChf)}</td>
                <td style={{ color: 'var(--green)' }}>{chf(e.revenue.addonsChf)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {mix.length > 0 && (
          <p className="hint" style={{ marginTop: 10 }}>
            Abo-Mix:{' '}
            {mix
              .map(x => `${PLAN_LABEL[x.plan]} ${x.interval === 'year' ? 'jährlich' : 'monatlich'} ${x.currency}: ${x.accounts}`)
              .join(' · ')}
            . Umsatz je Währung mit den Kursen des Preisbuchs in CHF umgerechnet, Jahresabos auf den Monat umgelegt.
          </p>
        )}
      </div>
    </>
  )
}
