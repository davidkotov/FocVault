'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import AuthShell, { BrandMark, Working } from '@/components/account/AuthShell'
import { useAccount } from '@/features/account/AccountProvider'
import { api, errorMessage } from '@/features/api/client'
import type { AdminStats, Plan } from '@/lib/api-types'
import { formatBytes } from '@/lib/vault'

const PLANS: Plan[] = ['free', 'pro', 'family', 'business']
const EVENT_LABEL: Record<string, string> = {
  'account.registered': 'Konto erstellt',
  'auth.login': 'Anmeldung',
  'auth.passphrase_failed': 'Anmeldung fehlgeschlagen',
  'auth.recovery_login': 'Recovery-Anmeldung',
  'auth.recovery_failed': 'Recovery fehlgeschlagen',
  'account.passphrase_changed': 'Passphrase geändert',
  'account.plan_changed': 'Plan geändert',
  'object.upload_started': 'Upload gestartet',
  'object.stored': 'Datei gespeichert',
  'object.deleted': 'Datei gelöscht'
}

/** Admin-Übersicht: nur Aggregate und Metadaten – keine Inhalte, keine Dateinamen. */
export default function AdminPage() {
  const router = useRouter()
  const { status, account } = useAccount()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStats(await api.adminStats())
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Admin-Daten konnten nicht geladen werden.'))
    }
  }, [])

  useEffect(() => {
    if (status === 'signedOut') router.replace('/anmelden')
    if (status === 'locked' || status === 'ready') void load()
  }, [status, router, load])

  useEffect(() => {
    if (status !== 'locked' && status !== 'ready') return
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [status, load])

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
        <p className="lead">Dieses Konto ist nicht als Admin eingetragen (ADMIN_EMAILS).</p>
        <Link href="/app">Zurück zur App</Link>
      </AuthShell>
    )
  }

  const setPlan = async (id: string, plan: Plan) => {
    try {
      await api.adminSetPlan(id, plan)
      await load()
    } catch (e) {
      setError(errorMessage(e, 'Plan konnte nicht gesetzt werden.'))
    }
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
                  {stats.environment.storage === 'filone' ? (stats.environment.storageDirect ? ' · direkt' : ' · Proxy') : ''}
                </span>
                {!stats.environment.production && <span className="badge err">Entwicklung</span>}
              </span>
            )}
            <Link href="/app">
              <button className="small">Zur App</button>
            </Link>
          </div>
        </div>
        <div className="content">
          {error && <div className="errorbox">{error}</div>}
          {!stats ? (
            <Working label="Lade Kennzahlen …" />
          ) : (
            <>
              <div className="admintiles">
                <div className="admintile">
                  <div className="k">Konten</div>
                  <div className="v">{stats.totals.accounts}</div>
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
                  <div className="k">Storage-Kosten</div>
                  <div className="v">${stats.economics.storageCostUsdPerMonth.toFixed(2)}</div>
                  <div className="s">pro Monat · Fil One $4.99/TB (Min. $4.99)</div>
                </div>
                <div className="admintile">
                  <div className="k">MRR (Schätzung)</div>
                  <div className="v">{stats.economics.mrrChf.toFixed(2)} CHF</div>
                  <div className="s">Pro 13.90 · Family 19.90 · ohne Stripe-Abgleich</div>
                </div>
              </div>

              <div className="card">
                <h3>
                  Konten <span>{stats.accounts.length}</span>
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="admintable">
                    <thead>
                      <tr>
                        <th>E-Mail</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Gespeichert</th>
                        <th>Dateien</th>
                        <th>Erstellt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.accounts.map(a => (
                        <tr key={a.id}>
                          <td>{a.email}</td>
                          <td>
                            <select value={a.plan} onChange={e => void setPlan(a.id, e.target.value as Plan)} aria-label={`Plan für ${a.email}`}>
                              {PLANS.map(p => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{a.status}</td>
                          <td>{formatBytes(a.storedBytes)}</td>
                          <td>{a.objects}</td>
                          <td>{new Date(a.createdAt).toLocaleString('de-CH')}</td>
                        </tr>
                      ))}
                      {stats.accounts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="dim">
                            Noch keine Konten.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
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
        </div>
      </div>
    </div>
  )
}
