'use client'

import { useState } from 'react'
import type { SecretEntry } from '@/lib/vault'

interface Props {
  entries: SecretEntry[]
  onSave: (s: SecretEntry) => void
  onDelete: (id: string) => void
}

export default function NotesPanel({ entries, onSave, onDelete }: Props) {
  const [form, setForm] = useState<{ id?: string; title: string; body: string } | null>(null)

  const startNew = () => setForm({ title: '', body: '' })
  const startEdit = (s: SecretEntry) => setForm({ id: s.id, title: s.title, body: s.body ?? '' })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || form.title.trim() === '') return
    const now = Date.now()
    onSave({
      id: form.id ?? crypto.randomUUID(),
      kind: 'note',
      title: form.title.trim(),
      body: form.body,
      createdAt: form.id ? entries.find(x => x.id === form.id)?.createdAt ?? now : now,
      updatedAt: now
    })
    setForm(null)
  }

  return (
    <div className="card">
      <h3>
        Notizen
        <span>{entries.length} Notizen · verschlüsselt im Vault</span>
      </h3>

      {entries.length > 0 && (
        <div className="notesgrid">
          {entries.map(s => (
            <div className="notecard" key={s.id}>
              <div className="notehead">
                <div className="sectitle">{s.title}</div>
                <button className="iconbtn danger" title="Löschen" onClick={() => onDelete(s.id)}>
                  <svg className="icon" width="14" height="14" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
              <div className="notebody">{s.body || <span className="dim">Leere Notiz</span>}</div>
              <div className="notefoot">
                <span className="dim">{new Date(s.updatedAt).toLocaleDateString('de-DE')}</span>
                <button className="small" onClick={() => startEdit(s)}>Bearbeiten</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && !form && (
        <p className="dim">Noch keine Notizen. Schreibe deine erste verschlüsselte Notiz.</p>
      )}

      {form ? (
        <form className="secform" onSubmit={submit}>
          <h4>{form.id ? 'Notiz bearbeiten' : 'Neue Notiz'}</h4>
          <div className="secfields">
            <label>
              Titel <span className="req">*</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="z. B. Ideen, PINs, Recovery-Hinweise" autoFocus />
            </label>
            <label>
              Inhalt
              <textarea rows={6} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Verschlüsselt gespeichert – niemand sonst liest mit." />
            </label>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" type="submit" disabled={form.title.trim() === ''}>
              Speichern
            </button>
            <button type="button" onClick={() => setForm(null)}>Abbrechen</button>
          </div>
        </form>
      ) : (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" onClick={startNew}>+ Neue Notiz</button>
        </div>
      )}
    </div>
  )
}