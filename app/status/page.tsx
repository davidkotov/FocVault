'use client'

import Wordmark from '@/components/Wordmark'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import LocaleSwitch from '@/components/LocaleSwitch'
import { api, type StatusOverview } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { siteMessages } from '@/lib/i18n/messages/site'

/** Öffentliche Statusseite: Gesamtzustand, 90-Tage-Verlauf je Komponente, Meldungen. */
export default function StatusPage() {
  const m = useMessages(siteMessages).status
  const { path, locale } = useI18n()
  const [o, setO] = useState<StatusOverview | null>(null)
  const [error, setError] = useState(false)
  const loc = locale === 'en' ? 'en-GB' : 'de-CH'
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' })
  const time = (d: string) => new Date(d).toLocaleString(loc, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const load = useCallback(() => {
    api
      .status()
      .then(r => {
        setO(r)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const byDay = new Map<string, StatusOverview['incidents']>()
  for (const i of o?.incidents ?? []) {
    const d = (i.updates.at(-1)?.at ?? i.createdAt).slice(0, 10)
    byDay.set(d, [...(byDay.get(d) ?? []), i])
  }
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10))

  return (
    <div className="statuspage">
      <header className="statushead">
        <Link href={path('/')} className="brand">
          <svg className="mark" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="20" fill="#0090ff" />
            <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
            <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
            <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
          </svg>
          <Wordmark />
        </Link>
        <a className="button small" href="/api/v1/status/rss">
          {m.subscribe}
        </a>
      </header>

      <main className="statuscard" id="main">
        {!o ? (
          <p className="dim" style={{ textAlign: 'center' }}>
            {error ? 'Status nicht erreichbar.' : '…'}
          </p>
        ) : (
          <>
            <div className={`overall ${o.overall}`}>
              <span className={`statusdot big ${o.overall}`} />
              {m.overall[o.overall]}
            </div>
            {o.components.map(c => (
              <div className="statuscomp" key={c.id}>
                <div className="statuscomprow">
                  <span>
                    <span className={`statusdot ${c.state}`} /> <strong>{m.components[c.id]}</strong>{' '}
                    <span className="dim">· {m.state[c.state]}</span>
                  </span>
                  <span className={`uptime ${c.state}`}>{c.uptimePct === null ? m.noData : fmt(m.uptime, { pct: c.uptimePct.toLocaleString(loc) })}</span>
                </div>
                <div className="uptimebars" role="img" aria-label={`${m.components[c.id]}: ${c.uptimePct ?? '–'} %`}>
                  {c.days.map(d => (
                    <span
                      key={d.date}
                      className={`bar ${d.state}`}
                      title={
                        d.state === 'nodata'
                          ? fmt(m.tipNone, { date: day(d.date) })
                          : d.state === 'maintenance'
                            ? fmt(m.tipMaint, { date: day(d.date) })
                            : fmt(m.tipUp, { date: day(d.date), pct: (d.uptimePct ?? 0).toLocaleString(loc) })
                      }
                    />
                  ))}
                </div>
                <div className="uptimeaxis">
                  <span>‹ {m.daysAgo}</span>
                  <span>{c.latencyMs !== null ? fmt(m.measured, { ms: c.latencyMs }) : ''}</span>
                  <span>{m.today}</span>
                </div>
              </div>
            ))}

            <h2 className="statusrecent">{m.recent}</h2>
            {days.map(d => (
              <div className="statusday" key={d}>
                <div className="statusdate">{day(d)}</div>
                {(byDay.get(d) ?? []).map(i => (
                  <div className="incident" key={i.id} id={i.id}>
                    <div className="incidenttitle">
                      <span className={`statusdot ${i.resolvedAt ? 'resolved' : i.impact === 'maintenance' ? 'maintenance' : i.impact === 'outage' ? 'outage' : 'degraded'}`} />
                      {i.title}
                    </div>
                    {i.updates.map((u, k) => (
                      <div className="incidentupdate" key={k}>
                        <span className={`updatebadge${k === 0 ? ' latest' : ''}`}>{m.updates[u.status] ?? u.status}</span>
                        <div>
                          <div className="dim">{time(u.at)}</div>
                          <div>{u.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {!byDay.get(d)?.length && <div className="dim nonotice">{m.noNotices}</div>}
              </div>
            ))}
          </>
        )}
      </main>
      <footer className="statusfoot">
        <span>{o?.updatedAt ? fmt(m.updated, { time: time(o.updatedAt) }) : ''}</span>
        <LocaleSwitch />
      </footer>
    </div>
  )
}
