'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SecretEntry } from '@/lib/vault'
import { parseCsv, toCsv, downloadText } from '@/lib/csv'

interface Props {
  entries: SecretEntry[]
  onSave: (s: SecretEntry) => void
  onSaveMany: (secrets: SecretEntry[]) => void
  onDelete: (id: string) => void
}

interface FormState {
  id?: string
  title: string
  username: string
  password: string
  url: string
  folder: string
}

interface GenOptions {
  len: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
}

const EMPTY: FormState = { title: '', username: '', password: '', url: '', folder: '' }
const DEFAULT_GEN: GenOptions = { len: 20, upper: true, lower: true, digits: true, symbols: true }

function genPassword(len: number, opts: GenOptions): string {
  const sets: Array<[string, boolean]> = [
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', opts.upper],
    ['abcdefghijklmnopqrstuvwxyz', opts.lower],
    ['0123456789', opts.digits],
    ['!@#$%^&*()-_=+[]{};:,.?', opts.symbols]
  ]
  const chars = sets.filter(s => s[1]).map(s => s[0]).join('')
  if (!chars) return ''
  const rand = crypto.getRandomValues(new Uint8Array(len))
  let pw = ''
  for (let i = 0; i < len; i++) pw += chars[rand[i] % chars.length]
  return pw
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard nur in manchen Kontexten verfügbar – still ignorieren
  }
}

export default function PasswordsPanel({ entries, onSave, onSaveMany, onDelete }: Props) {
  const [form, setForm] = useState<FormState | null>(null)
  const [showPwForm, setShowPwForm] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [genOpen, setGenOpen] = useState(false)
  const [genOpts, setGenOpts] = useState<GenOptions>(DEFAULT_GEN)
  const importRef = useRef<HTMLInputElement>(null)

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.folder) set.add(e.folder)
    return [...set].sort((a, b) => a.localeCompare(b, 'de'))
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (folderFilter !== 'all' && (e.folder ?? '') !== folderFilter) return false
      if (!q) return true
      return [e.title, e.username, e.url, e.folder].filter(Boolean).some(v => (v as string).toLowerCase().includes(q))
    })
  }, [entries, search, folderFilter])

  const countFor = (folder: string) => entries.filter(e => (e.folder ?? '') === folder).length

  const startNew = () => {
    setForm({ ...EMPTY })
    setShowPwForm(false)
    setGenOpen(false)
  }
  const startEdit = (s: SecretEntry) => {
    setForm({ id: s.id, title: s.title, username: s.username ?? '', password: s.password ?? '', url: s.url ?? '', folder: s.folder ?? '' })
    setShowPwForm(false)
    setGenOpen(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || form.title.trim() === '') return
    const now = Date.now()
    onSave({
      id: form.id ?? crypto.randomUUID(),
      kind: 'password',
      title: form.title.trim(),
      folder: form.folder.trim() || undefined,
      username: form.username.trim() || undefined,
      password: form.password,
      url: form.url.trim() || undefined,
      createdAt: form.id ? entries.find(x => x.id === form.id)?.createdAt ?? now : now,
      updatedAt: now
    })
    setForm(null)
    setGenOpen(false)
  }

  const doGenerate = (opts: GenOptions = genOpts) => {
    if (!form) return
    setForm({ ...form, password: genPassword(opts.len, opts) })
    setShowPwForm(true)
  }
  const openGenerator = () => {
    setGenOpen(true)
    doGenerate()
  }
  const changeGen = (patch: Partial<GenOptions>) => {
    const next = { ...genOpts, ...patch }
    setGenOpts(next)
    doGenerate(next)
  }

  const exportCsv = () => {
    const rows = [
      ['name', 'url', 'username', 'password', 'folder', 'notes'],
      ...entries.map(e => [e.title, e.url ?? '', e.username ?? '', e.password ?? '', e.folder ?? '', ''])
    ]
    downloadText(`focvault-passwords-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))
  }

  const importCsv = async (file: File) => {
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length < 2) throw new Error('keine Datenzeilen')
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const idx = (keys: string[]) => headers.findIndex(h => keys.includes(h))
      const nameI = idx(['name', 'title', 'bezeichnung', 'seite', 'site'])
      const userI = idx(['username', 'user', 'benutzername', 'login'])
      const passI = idx(['password', 'passwort', 'pass', 'pwd'])
      const urlI = idx(['url', 'uri', 'webseite', 'website', 'link'])
      const folderI = idx(['folder', 'ordner', 'kategorie', 'category', 'group', 'gruppe', 'collection'])
      if (nameI === -1 && passI === -1 && userI === -1) throw new Error('Spalten nicht erkannt')
      const now = Date.now()
      const created: SecretEntry[] = []
      for (let r = 1; r < rows.length; r++) {
        const c = rows[r]
        const title = (nameI >= 0 ? c[nameI] : undefined) || (passI >= 0 ? c[passI] : undefined) || (userI >= 0 ? c[userI] : undefined)
        if (!title || !title.trim()) continue
        created.push({
          id: crypto.randomUUID(),
          kind: 'password',
          title: title.trim(),
          folder: folderI >= 0 ? c[folderI]?.trim() || undefined : undefined,
          username: userI >= 0 ? c[userI]?.trim() || undefined : undefined,
          password: passI >= 0 ? c[passI] : undefined,
          url: urlI >= 0 ? c[urlI]?.trim() || undefined : undefined,
          createdAt: now,
          updatedAt: now
        })
      }
      if (created.length === 0) throw new Error('keine verwertbaren Zeilen')
      onSaveMany(created)
    } catch (err) {
      alert(`CSV-Import fehlgeschlagen – ${(err as Error).message}.`)
    }
  }

  return (
    <div className="card">
      <h3>
        Passwörter
        <span>{entries.length} Einträge · AES-256 verschlüsselt im Vault</span>
      </h3>

      {entries.length > 0 && (
        <div className="searchrow">
          <input
            className="searchinput"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen: Titel, Benutzer, Webseite, Ordner…"
          />
          <button className="small" onClick={exportCsv}>CSV exportieren</button>
          <button className="small" onClick={() => importRef.current?.click()}>CSV importieren</button>
          <input
            ref={importRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void importCsv(f)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {folders.length > 0 && (
        <div className="chipsrow">
          <button
            className={folderFilter === 'all' ? 'chip active' : 'chip'}
            onClick={() => setFolderFilter('all')}
          >
            Alle ({entries.length})
          </button>
          {folders.map(f => (
            <button key={f} className={folderFilter === f ? 'chip active' : 'chip'} onClick={() => setFolderFilter(f)}>
              {f} ({countFor(f)})
            </button>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="seclist">
          {filtered.map(s => (
            <div className="secrow" key={s.id}>
              <div className="secmain">
                <div className="sectitle">{s.title}</div>
                <div className="secmeta">
                  {[s.username, s.url, s.folder].filter(Boolean).join(' · ') || 'Kein Zusatz'}
                </div>
              </div>
              <div className="secpw">
                {revealed[s.id] ? s.password || '—' : '••••••••••••'}
                <button className="iconbtn" title="Kopieren" onClick={() => void copyText(s.password ?? '')}>
                  <svg className="icon" width="14" height="14" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </button>
                {s.password && (
                  <button className="iconbtn" title={revealed[s.id] ? 'Ausblenden' : 'Anzeigen'} onClick={() => setRevealed(r => ({ ...r, [s.id]: !r[s.id] }))}>
                    <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="secactions">
                <button className="iconbtn" title="Bearbeiten" onClick={() => startEdit(s)}>
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button className="iconbtn danger" title="Löschen" onClick={() => onDelete(s.id)}>
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="dim">Keine Treffer.</p>}
        </div>
      )}

      {entries.length === 0 && !form && (
        <p className="dim">
          Noch keine Passwörter gespeichert. Lege dein erstes an – es wird ausschließlich
          verschlüsselt in deinem Vault gehalten.
        </p>
      )}

      {form ? (
        <form className="secform" onSubmit={submit}>
          <h4>{form.id ? 'Passwort bearbeiten' : 'Neues Passwort'}</h4>
          <div className="secfields">
            <label>
              Titel <span className="req">*</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="z. B. Google" autoFocus />
            </label>
            <label>
              Benutzername
              <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="name@example.com" />
            </label>
            <label>
              Passwort
              <div className="pwrow">
                <input
                  type={showPwForm ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
                <button type="button" className="iconbtn" title={showPwForm ? 'Ausblenden' : 'Einblenden'} onClick={() => setShowPwForm(v => !v)}>
                  <svg className="icon" width="16" height="16" viewBox="0 0 24 24">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button type="button" className="small" onClick={openGenerator}>Generieren</button>
              </div>
            </label>

            {genOpen && (
              <div className="genpanel">
                <div className="gensplit">
                  <label>
                    Länge
                    <input
                      type="number"
                      min={8}
                      max={64}
                      value={genOpts.len}
                      onChange={e => changeGen({ len: Math.max(8, Math.min(64, Number(e.target.value) || 20)) })}
                    />
                  </label>
                  <div className="genchecks">
                    <span className="gencheck-label">Zeichen:</span>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.upper} onChange={e => changeGen({ upper: e.target.checked })} /> A–Z</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.lower} onChange={e => changeGen({ lower: e.target.checked })} /> a–z</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.digits} onChange={e => changeGen({ digits: e.target.checked })} /> 0–9</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.symbols} onChange={e => changeGen({ symbols: e.target.checked })} /> !@#$%</label>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="small" onClick={() => doGenerate()}>🔄 Neu würfeln</button>
                  <button type="button" className="small" onClick={() => void copyText(form.password ?? '')}>Kopieren</button>
                </div>
              </div>
            )}

            <label>
              Webseite
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            </label>
            <label>
              Ordner / Kategorie
              <input value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} placeholder="z. B. Arbeit, Finanzen, Shopping" list="pw-folders" />
              <datalist id="pw-folders">
                {folders.map(f => <option key={f} value={f} />)}
              </datalist>
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
          <button className="primary" onClick={startNew}>+ Neues Passwort</button>
        </div>
      )}
    </div>
  )
}