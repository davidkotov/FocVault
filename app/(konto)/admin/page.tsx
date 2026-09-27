'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import AuthShell, { BrandMark, Working } from '@/components/account/AuthShell'
import EconomicsPanel from '@/components/admin/EconomicsPanel'
import ScenarioPanel from '@/components/admin/ScenarioPanel'
import PricingPanel from '@/components/admin/PricingPanel'
import TreasuryPanel from '@/components/admin/TreasuryPanel'
import FocPanel from '@/components/admin/FocPanel'
import AccountsPanel from '@/components/admin/AccountsPanel'
import { useAccount } from '@/features/account/AccountProvider'
import { useI18n } from '@/features/i18n/I18nProvider'
import { api, errorMessage, type EconomicsReport } from '@/features/api/client'
import type { AdminStats } from '@/lib/api-types'
import { chf } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

type Tab = 'overview' | 'economics' | 'scenario' | 'pricing' | 'foc' | 'treasury' | 'accounts'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'economics', label: 'Wirtschaftlichkeit' },
  { id: 'scenario', label: 'Szenario-Rechner' },
  { id: 'pricing', label: 'Preisbuch' },
  { id: 'foc', label: 'Filecoin (FOC)' },
  { id: 'treasury', label: 'Finanzierung' },
  { id: 'accounts', label: 'Konten' }
]

const EVENT_LABEL: Record<string, string> = {
  'account.registered': 'Konto erstellt',
  'auth.login': 'Anmeldung',
  'auth.wallet_login': 'Anmeldung (Reown)',
  'auth.passphrase_failed': 'Anmeldung fehlgeschlagen',
  'auth.recovery_login': 'Recovery-Anmeldung',
  'auth.recovery_failed': 'Recovery fehlgeschlagen',
  'account.passphrase_changed': 'Passphrase geändert',
  'account.plan_changed': 'Paket geändert',
  'account.updated': 'Konto geändert (Admin)',
  'object.upload_started': 'Upload gestartet',
  'object.stored': 'Datei gespeichert',
  'object.deleted': 'Datei gelöscht',
  'billing.addon_added': 'Zusatzspeicher gebucht',
  'billing.addon_granted': 'Zusatzspeicher gutgeschrieben',
  'billing.addon_cancelled': 'Zusatzspeicher gekündigt',
  'billing.payg_enabled': 'Pay-as-you-go aktiviert',
  'billing.payg_disabled': 'Pay-as-you-go deaktiviert',
  'admin.pricing_changed': 'Preisbuch geändert',
  'admin.treasury_changed': 'Reserve geändert',
  'admin.foc_changed': 'FOC-Einstellungen geändert',
  'admin.foc_session_key': 'FOC-Server-Schlüssel erzeugt',
  'foc.pack_stored': 'Paket auf Filecoin gesichert'
}

/** Admin: nur Aggregate und Metadaten – keine Inhalte, keine Dateinamen (Zero-Knowledge). */
export default function AdminPage() {
  const router = useRouter()
  const { status, account } = useAccount()
  const { path } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [report, setReport] = useState<EconomicsReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.adminStats(), api.adminEconomics()])
      setStats(s)
      setReport(r)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Admin-Daten konnten nicht geladen werden.'))
    }
  }, [])

  useEffect(() => {
    if (status === 'signedOut') router.replace(path('/anmelden'))
    if (status === 'locked' || status === 'ready') void load()
  }, [status, router, load, path])

  if (status === 'loading' || status === 'signedOut') {
    return (
      <AuthShell>
        <Working label="Lade …" />
      </AuthShell>
    )
  }
  if (account && !account.isAdmin) {
    return (
      <AuthShell>
        <h2>Kein Zugriff</h2>
        <p className="lead">Dieses Konto ist nicht als Admin eingetragen (ADMIN_EMAILS / ADMIN_ADDRESSES).</p>
        <Link href={path('/app')}>Zurück zur App</Link>
      </AuthShell>
    )
  }

  return (
    <div className="shell" style={{ gridTemplateColumns: '1fr' }}>
      <div className="main">
        <div className="topbar">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark size={26} /> Admin
          </h1>
          <div className="accountmenu">
            {stats && (
              <span className="envbadges">
                <span className="badge">DB: {stats.environment.database === 'pglite' ? 'PGlite (lokal)' : 'Postgres'}</span>
                <span className={`badge ${stats.environment.storage === 'filone' ? 'ok' : ''}`}>
                  Storage: {stats.environment.storage === 'filone' ? 'Fil One' : stats.environment.storage === 'local' ? 'lokal (Dev)' : stats.environment.storage}
                </span>
                {!stats.environment.production && <span className="badge err">Entwicklung</span>}
              </span>
            )}
            <button className="small" onClick={() => void load()}>
              Aktualisieren
            </button>
            <Link href={path('/app')}>
              <button className="small">Zur App</button>
            </Link>
          </div>
        </div>
        <div className="content">
          <nav className="admintabs" role="tablist">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          {error && <div className="errorbox">{error}</div>}
          {!stats || !report ? (
            <Working label="Lade Kennzahlen …" />
          ) : (
            <>
              {tab === 'overview' && (
                <>
                  <div className="admintiles">
                    <div className="admintile">
                      <div className="k">Konten</div>
                      <div className="v">{stats.totals.accounts.toLocaleString('de-CH')}</div>
                      <div className="s">
                        Free {stats.totals.accountsByPlan.free} · Pro {stats.totals.accountsByPlan.pro} · Family{' '}
                        {stats.totals.accountsByPlan.family}
                      </div>
                    </div>
                    <div className="admintile">
                      <div className="k">Gespeichert</div>
                      <div className="v">{formatBytes(stats.totals.storedBytes)}</div>
                      <div className="s">
                        {stats.totals.objects} Dateien · {stats.totals.uploadsInProgress} Uploads laufen
                      </div>
                    </div>
                    <div className="admintile">
                      <div className="k">Monatsumsatz (MRR)</div>
                      <div className="v">{chf(report.economics.revenue.totalChf)}</div>
                      <div className="s">Rohertrag {chf(report.economics.grossProfitChf)}</div>
                    </div>
                    <div className="admintile">
                      <div className="k">Free-Tier kostet</div>
                      <div className="v">{chf(report.economics.freeTier.subsidyChf)}</div>
                      <div className="s">
                        {report.economics.freeTier.budgetUsedPct.toFixed(0)} % vom Budget · gedeckt durch{' '}
                        {report.economics.freeTier.proCustomersToCover} Pro-Kunden
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <h3>
                      Ereignisse <span>Audit-Log, ohne Inhalte</span>
                    </h3>
                    <ul className="eventlist">
                      {stats.events.map((e, i) => (
                        <li key={i}>
                          <time>{new Date(e.at).toLocaleString('de-CH')}</time>
                          <span>{EVENT_LABEL[e.kind] ?? e.kind}</span>
                          <span className="dim">{e.email ?? '—'}</span>
                        </li>
                      ))}
                      {stats.events.length === 0 && <li className="dim">Noch keine Ereignisse.</li>}
                    </ul>
                  </div>
                </>
              )}
              {tab === 'economics' && <EconomicsPanel report={report} />}
              {tab === 'scenario' && <ScenarioPanel pricing={report.pricing} />}
              {tab === 'pricing' && <PricingPanel onSaved={() => void load()} />}
              {tab === 'foc' && <FocPanel />}
              {tab === 'treasury' && <TreasuryPanel />}
              {tab === 'accounts' && <AccountsPanel pricing={report.pricing} onChanged={() => void load()} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
