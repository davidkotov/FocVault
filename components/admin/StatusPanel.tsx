'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, type StatusOverview } from '@/features/api/client'

const COMP: Record<string, string> = { app: 'Web-App & API', storage: 'Speicher (Fil One)', filecoin: 'Filecoin (PDP)', s3: 'Speicher-API (S3)' }
const STATES = { incident: ['investigating', 'identified', 'monitoring', 'resolved'], maintenance: ['scheduled', 'in_progress', 'completed'] } as const
const LABEL: Record<string, string> = {
  investigating: 'Wird untersucht',
  identified: 'Ursache gefunden',
  monitoring: 'Wird beobachtet',
  resolved: 'Behoben',
  scheduled: 'Geplant',
  in_progress: 'Läuft',
  completed: 'Abgeschlossen'
}

/** Admin: Statusseite – Messungen auslösen, Störungen und Wartungen melden und fortschreiben. */
export default function StatusPanel() {
  const [o, setO] = useState<StatusOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ title: '', kind: 'incident' as 'incident' | 'maintenance', impact: 'degraded' as 'degraded' | 'outage' | 'maintenance', components: ['storage'], status: 'investigating', message: '' })
  const [upd, setUpd] = useState<Record<string, { status: string; message: string }>>({})

  const load = useCallback(async () => {
    try {
      setO(await api.status())
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <div className="card">
        <h3>
          Statusseite <span>öffentlich unter /status</span>
        </h3>
        {error && <div className="errorbox">{error}</div>}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <button className="small" onClick={() => void run(() => api.adminStatusCheck())}>
            Jetzt messen
          </button>
          <a className="button small" href="/status" target="_blank" rel="noreferrer">
            Statusseite öffnen ↗
          </a>
        </div>
        {o?.components.map(c => (
          <div className="stat" key={c.id}>
            <span className="k">{COMP[c.id] ?? c.id}</span>
            <span className="v">
              {c.state} · {c.uptimePct ?? '–'} % · {c.latencyMs ?? '–'} ms
            </span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Neue Meldung</h3>
        <div className="ssoform">
          <label>
            Titel
            <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="z. B. Uploads verlangsamt" />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <select
              value={f.kind}
              onChange={e => {
                const kind = e.target.value as 'incident' | 'maintenance'
                setF({ ...f, kind, impact: kind === 'maintenance' ? 'maintenance' : 'degraded', status: STATES[kind][0] })
              }}
            >
              <option value="incident">Störung</option>
              <option value="maintenance">Wartung</option>
            </select>
            {f.kind === 'incident' && (
              <select value={f.impact} onChange={e => setF({ ...f, impact: e.target.value as 'degraded' | 'outage' })}>
                <option value="degraded">Eingeschränkt</option>
                <option value="outage">Ausfall</option>
              </select>
            )}
            <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              {STATES[f.kind].map(s => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="chips">
            {Object.entries(COMP).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`chip${f.components.includes(k) ? ' active' : ''}`}
                onClick={() => setF({ ...f, components: f.components.includes(k) ? f.components.filter(x => x !== k) : [...f.components, k] })}
              >
                {l}
              </button>
            ))}
          </div>
          <label>
            Text
            <textarea rows={3} value={f.message} onChange={e => setF({ ...f, message: e.target.value })} />
          </label>
          <button
            className="primary"
            disabled={f.title.length < 3 || f.message.length < 3 || !f.components.length}
            onClick={() => void run(async () => {
              await api.adminIncident(f)
              setF({ ...f, title: '', message: '' })
            })}
          >
            Veröffentlichen
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Meldungen</h3>
        {o?.incidents.length === 0 && <p className="dim">Keine Meldungen.</p>}
        {o?.incidents.map(i => (
          <div className="ticket" key={i.id}>
            <div className="tickethead">
              <strong>{i.title}</strong>
              <span className={`badge${i.resolvedAt ? ' ok' : ' warn'}`}>{i.resolvedAt ? 'abgeschlossen' : 'offen'}</span>
              <span className="dim">{i.components.map(c => COMP[c] ?? c).join(', ')}</span>
            </div>
            {i.updates.map((u, k) => (
              <div key={k} className="hint">
                {new Date(u.at).toLocaleString('de-CH')} · <strong>{LABEL[u.status]}</strong> · {u.message}
              </div>
            ))}
            {!i.resolvedAt && (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <select value={upd[i.id]?.status ?? STATES[i.kind][1]} onChange={e => setUpd(x => ({ ...x, [i.id]: { status: e.target.value, message: x[i.id]?.message ?? '' } }))}>
                  {STATES[i.kind].map(s => (
                    <option key={s} value={s}>
                      {LABEL[s]}
                    </option>
                  ))}
                </select>
                <input
                  style={{ flex: 1 }}
                  placeholder="Update-Text"
                  value={upd[i.id]?.message ?? ''}
                  onChange={e => setUpd(x => ({ ...x, [i.id]: { status: x[i.id]?.status ?? STATES[i.kind][1], message: e.target.value } }))}
                />
                <button
                  className="small"
                  disabled={(upd[i.id]?.message ?? '').length < 3}
                  onClick={() => void run(() => api.adminIncidentUpdate(i.id, upd[i.id]?.status ?? STATES[i.kind][1], upd[i.id]!.message))}
                >
                  Update
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
