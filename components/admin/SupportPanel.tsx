'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, type SupportTicket } from '@/features/api/client'

const STATUS: Record<SupportTicket['status'], string> = { open: 'Offen', answered: 'Beantwortet', closed: 'Erledigt' }
const CAT: Record<string, string> = { product: 'Produkt', billing: 'Abrechnung', general: 'Allgemein', feature: 'Wunsch', storage: 'Speicher-Anfrage', business: 'Business' }

/** Admin: Anfragen aus dem Support-Formular. */
export default function SupportPanel() {
  const [filter, setFilter] = useState<string>('open')
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      setTickets((await api.adminTickets(filter || undefined)).tickets)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const set = async (t: SupportTicket, status: SupportTicket['status']) => {
    try {
      await api.adminUpdateTicket(t.id, status, notes[t.id])
      await load()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="card">
      <h3>
        Support-Anfragen <span>aus dem Formular auf /support</span>
      </h3>
      {error && <div className="errorbox">{error}</div>}
      <div className="chips" style={{ marginBottom: 12 }}>
        {[['open', 'Offen'], ['answered', 'Beantwortet'], ['closed', 'Erledigt'], ['', 'Alle']].map(([k, l]) => (
          <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {tickets?.length === 0 && <p className="dim">Keine Anfragen.</p>}
      {tickets?.map(t => (
        <div className="ticket" key={t.id}>
          <div className="tickethead">
            <strong>{t.name}</strong>
            <a href={`mailto:${t.email}?subject=${encodeURIComponent('Ihre Anfrage an FocVault')}`}>{t.email}</a>
            {t.company && <span className="dim">{t.company}</span>}
            <span className="dim">{new Date(t.createdAt).toLocaleString('de-CH')}</span>
            {t.categories.map(c => (
              <span key={c} className={`badge${c === 'storage' || c === 'business' ? ' role-manage' : ''}`}>
                {CAT[c] ?? c}
              </span>
            ))}
            <span className={`badge${t.status === 'open' ? ' warn' : ' ok'}`}>{STATUS[t.status]}</span>
            {t.accountId && <span className="dim">Konto verknüpft</span>}
          </div>
          <p className="ticketmsg">{t.message}</p>
          <div className="row" style={{ gap: 8 }}>
            <input placeholder="Interne Notiz" value={notes[t.id] ?? t.note ?? ''} onChange={e => setNotes(n => ({ ...n, [t.id]: e.target.value }))} style={{ flex: 1 }} />
            {t.status !== 'answered' && (
              <button className="small" onClick={() => void set(t, 'answered')}>
                Beantwortet
              </button>
            )}
            {t.status !== 'closed' && (
              <button className="small" onClick={() => void set(t, 'closed')}>
                Erledigt
              </button>
            )}
            {t.status !== 'open' && (
              <button className="small" onClick={() => void set(t, 'open')}>
                Wieder öffnen
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
