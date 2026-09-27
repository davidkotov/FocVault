'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SecretEntry } from '@/lib/vault'
import { parseCsv, toCsv, downloadText } from '@/lib/csv'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { secretsMessages } from '@/lib/i18n/messages/secrets'
import { reusedPasswords, strength } from '@/lib/password-health'
import { checkBreaches } from '@/features/passwords/breach'
import { useErrorText } from '@/features/i18n/errors'

interface Props {
  entries: SecretEntry[]
  onSave: (s: SecretEntry) => void
  onSaveMany: (secrets: SecretEntry[]) => void
  onDelete: (id: string) => void
  /** nur ansehen (geteilter Tresor mit Recht „Ansehen“) */
  readOnly?: boolean
  /** eigene Überschrift (z. B. im geteilten Tresor) */
  heading?: string
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

export default function PasswordsPanel({ entries, onSave, onSaveMany, onDelete, readOnly = false, heading }: Props) {
  const { common: c, passwords: m } = useMessages(secretsMessages)
  const [form, setForm] = useState<FormState | null>(null)
  const [showPwForm, setShowPwForm] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [genOpen, setGenOpen] = useState(false)
  const [genOpts, setGenOpts] = useState<GenOptions>(DEFAULT_GEN)
  const [selId, setSelId] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.folder) set.add(e.folder)
    return [...set].sort((a, b) => a.localeCompare(b, 'de'))
  }, [entries])

  const h = useMessages(secretsMessages).health
  const errText = useErrorText()
  const [healthFilter, setHealthFilter] = useState<'weak' | 'reused' | 'leaked' | null>(null)
  const [breaches, setBreaches] = useState<Map<string, number> | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkProgress, setCheckProgress] = useState<string | null>(null)
  const weak = useMemo(() => new Set(entries.filter(e => e.password && strength(e.password) <= 1).map(e => e.id)), [entries])
  const reused = useMemo(() => reusedPasswords(entries), [entries])
  const leaked = useMemo(() => new Set([...(breaches ?? new Map<string, number>())].filter(([, n]) => n > 0).map(([id]) => id)), [breaches])
  const runBreachCheck = async () => {
    setChecking(true)
    setCheckError(null)
    try {
      const r = await checkBreaches(entries, (d, t) => setCheckProgress(t > 20 ? `${Math.round((d / t) * 100)} %` : null))
      setBreaches(r.counts)
      if (r.unchecked) setCheckError(fmt(h.unchecked, { n: r.unchecked }))
    } catch (e) {
      setCheckError(errText(e))
    } finally {
      setChecking(false)
      setCheckProgress(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (healthFilter === 'weak' && !weak.has(e.id)) return false
      if (healthFilter === 'reused' && !reused.has(e.id)) return false
      if (healthFilter === 'leaked' && !leaked.has(e.id)) return false
      if (folderFilter !== 'all' && (e.folder ?? '') !== folderFilter) return false
      if (!q) return true
      return [e.title, e.username, e.url, e.folder].filter(Boolean).some(v => (v as string).toLowerCase().includes(q))
    })
  }, [entries, search, folderFilter, healthFilter, weak, reused, leaked])

  const sel = filtered.find(e => e.id === selId) ?? filtered[0]
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
      if (rows.length < 2) throw new Error(m.errNoRows)
      const headers = rows[0].map(h => h.trim().toLowerCase())
      const idx = (keys: string[]) => headers.findIndex(h => keys.includes(h))
      const nameI = idx(['name', 'title', 'bezeichnung', 'seite', 'site'])
      const userI = idx(['username', 'user', 'benutzername', 'login'])
      const passI = idx(['password', 'passwort', 'pass', 'pwd'])
      const urlI = idx(['url', 'uri', 'webseite', 'website', 'link'])
      const folderI = idx(['folder', 'ordner', 'kategorie', 'category', 'group', 'gruppe', 'collection'])
      if (nameI === -1 && passI === -1 && userI === -1) throw new Error(m.errNoColumns)
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
      if (created.length === 0) throw new Error(m.errNoUsableRows)
      onSaveMany(created)
    } catch (err) {
      alert(fmt(m.importFailed, { reason: (err as Error).message }))
    }
  }

  return (
    <div className="card">
      <h3>
        {heading ?? m.heading}
        <span>{fmt(m.subtitle, { n: entries.length })}</span>
        {!readOnly && !form && (
          <button className="primary small" onClick={startNew}>
            {m.newButton}
          </button>
        )}
      </h3>

      {entries.length > 0 && (
        <div className="searchrow">
          <input
            className="searchinput"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={m.searchPlaceholder}
          />
          <button className="small" onClick={exportCsv}>{m.exportCsv}</button>
          {!readOnly && <button className="small" onClick={() => importRef.current?.click()}>{m.importCsv}</button>}
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

      {entries.some(e => e.password) && (
        <div className="healthbar" aria-label={h.title}>
          <strong>{h.title}</strong>
          <button type="button" className={`chip${healthFilter === 'weak' ? ' active' : ''}${weak.size ? ' warn' : ' ok'}`} onClick={() => setHealthFilter(f => (f === 'weak' ? null : 'weak'))}>
            {fmt(h.weak, { n: weak.size })}
          </button>
          <button type="button" className={`chip${healthFilter === 'reused' ? ' active' : ''}${reused.size ? ' warn' : ' ok'}`} onClick={() => setHealthFilter(f => (f === 'reused' ? null : 'reused'))}>
            {fmt(h.reused, { n: reused.size })}
          </button>
          {breaches ? (
            <button type="button" className={`chip${healthFilter === 'leaked' ? ' active' : ''}${leaked.size ? ' bad' : ' ok'}`} onClick={() => setHealthFilter(f => (f === 'leaked' ? null : 'leaked'))}>
              {fmt(h.leaked, { n: leaked.size })}
            </button>
          ) : (
            <button type="button" className="small" disabled={checking} onClick={() => void runBreachCheck()} title={h.checkHint}>
              {checking ? `${h.checking}${checkProgress ? ` ${checkProgress}` : ''}` : h.check}
            </button>
          )}
          <span className="hint">{breaches ? h.anonymousDone : h.checkHint}</span>
          {checkError && <span className="errortext">{checkError}</span>}
        </div>
      )}

      <div className={`pwlayout${folders.length ? '' : ' nofolders'}`}>
      {folders.length > 0 && (
        <div className="chipsrow pwfolders">
          <button
            className={folderFilter === 'all' ? 'chip active' : 'chip'}
            onClick={() => setFolderFilter('all')}
          >
            {fmt(m.all, { n: entries.length })}
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
            <div className={`secrow${sel?.id === s.id ? ' selected' : ''}`} key={s.id} onClick={() => setSelId(s.id)}>
              <div className="secmain">
                <div className="sectitle">
                  {s.title}
                  {leaked.has(s.id) && <span className="pwbadge bad" title={fmt(h.leakedTip, { n: (breaches?.get(s.id) ?? 0).toLocaleString() })}>{h.badgeLeaked}</span>}
                  {weak.has(s.id) && <span className="pwbadge warn">{h.badgeWeak}</span>}
                  {reused.has(s.id) && <span className="pwbadge warn" title={fmt(h.reusedTip, { n: reused.get(s.id)! })}>{h.badgeReused}</span>}
                </div>
                <div className="secmeta">
                  {[s.username, s.url, s.folder].filter(Boolean).join(' · ') || m.noExtra}
                </div>
              </div>
              <div className="secpw">
                {revealed[s.id] ? s.password || '—' : '••••••••••••'}
                <button className="iconbtn" title={c.copy} onClick={() => void copyText(s.password ?? '')}>
                  <svg className="icon" width="14" height="14" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </button>
                {s.password && (
                  <button className="iconbtn" title={revealed[s.id] ? m.hide : m.show} onClick={() => setRevealed(r => ({ ...r, [s.id]: !r[s.id] }))}>
                    <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                )}
              </div>
              {!readOnly && <div className="secactions">
                <button className="iconbtn" title={c.edit} onClick={() => startEdit(s)}>
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button className="iconbtn danger" title={c.delete} onClick={() => onDelete(s.id)}>
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>}
            </div>
          ))}
          {filtered.length === 0 && <p className="dim">{m.noMatches}</p>}
        </div>
      )}

      {entries.length === 0 && !form && <p className="dim pwempty">{m.empty}</p>}
      <div className="pwdetail" hidden={entries.length === 0 && !form}>
        {form ? (
        <form className="secform" onSubmit={submit}>
          <h4>{form.id ? m.editTitle : m.newTitle}</h4>
          <div className="secfields">
            <label>
              {c.title} <span className="req">*</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={m.titlePlaceholder} autoFocus />
            </label>
            <label>
              {m.username}
              <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="name@example.com" />
            </label>
            <label>
              {m.password}
              <div className="pwrow">
                <input
                  type={showPwForm ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
                <button type="button" className="iconbtn" title={showPwForm ? m.hide : m.reveal} onClick={() => setShowPwForm(v => !v)}>
                  <svg className="icon" width="16" height="16" viewBox="0 0 24 24">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button type="button" className="small" onClick={openGenerator}>{c.generate}</button>
              </div>
            </label>

            {genOpen && (
              <div className="genpanel">
                <div className="gensplit">
                  <label>
                    {m.length}
                    <input
                      type="number"
                      min={8}
                      max={64}
                      value={genOpts.len}
                      onChange={e => changeGen({ len: Math.max(8, Math.min(64, Number(e.target.value) || 20)) })}
                    />
                  </label>
                  <div className="genchecks">
                    <span className="gencheck-label">{m.chars}</span>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.upper} onChange={e => changeGen({ upper: e.target.checked })} /> A–Z</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.lower} onChange={e => changeGen({ lower: e.target.checked })} /> a–z</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.digits} onChange={e => changeGen({ digits: e.target.checked })} /> 0–9</label>
                    <label className="gencheck"><input type="checkbox" checked={genOpts.symbols} onChange={e => changeGen({ symbols: e.target.checked })} /> !@#$%</label>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="small" onClick={() => doGenerate()}>{m.reroll}</button>
                  <button type="button" className="small" onClick={() => void copyText(form.password ?? '')}>{c.copy}</button>
                </div>
              </div>
            )}

            <label>
              {m.website}
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            </label>
            <label>
              {m.folder}
              <input value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} placeholder={m.folderPlaceholder} list="pw-folders" />
              <datalist id="pw-folders">
                {folders.map(f => <option key={f} value={f} />)}
              </datalist>
            </label>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" type="submit" disabled={form.title.trim() === ''}>
              {c.save}
            </button>
            <button type="button" onClick={() => setForm(null)}>{c.cancel}</button>
          </div>
        </form>
        ) : sel ? (
          <>
            <div className="pwdhead">
              <span className="pwavatar">{sel.title.slice(0, 2).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{sel.title}</strong>
                <span className="hint">{[sel.folder, sel.url].filter(Boolean).join(' · ') || m.noExtra}</span>
              </div>
              {!readOnly && (
                <button className="small" onClick={() => startEdit(sel)}>
                  {c.edit}
                </button>
              )}
            </div>
            {sel.username && (
              <div className="pwfield">
                <span className="k">{m.username}</span>
                <b>{sel.username}</b>
                <button className="linkish" onClick={() => void copyText(sel.username ?? '')}>
                  {c.copy}
                </button>
              </div>
            )}
            {sel.password && (
              <div className="pwfield">
                <span className="k">{m.password}</span>
                <span className="mono">{revealed[sel.id] ? sel.password : '••••••••••••••••'}</span>
                <span className="row" style={{ gap: 10 }}>
                  <button className="linkish" onClick={() => setRevealed(r => ({ ...r, [sel.id]: !r[sel.id] }))}>
                    {revealed[sel.id] ? m.hide : m.show}
                  </button>
                  <button className="linkish" onClick={() => void copyText(sel.password ?? '')}>
                    {c.copy}
                  </button>
                </span>
              </div>
            )}
            {sel.password && (
              <div className="pwfield">
                <span className="k">{m.strength}</span>
                <div>
                  <div className="pwstrength">
                    <b style={{ width: `${((strength(sel.password) + 1) / 5) * 100}%`, background: strength(sel.password) >= 3 ? '#148a52' : strength(sel.password) >= 2 ? '#b07a00' : '#c43b3b' }} />
                  </div>
                  <span className="hint">
                    {m.strengths[strength(sel.password)]} · {fmt(m.charCount, { n: sel.password.length })}
                    {leaked.has(sel.id) ? ` · ${h.badgeLeaked}` : ''}
                    {reused.has(sel.id) ? ` · ${h.badgeReused}` : ''}
                  </span>
                </div>
                <span />
              </div>
            )}
            {sel.url && (
              <div className="pwfield">
                <span className="k">{m.website}</span>
                <a href={/^https?:\/\//.test(sel.url) ? sel.url : `https://${sel.url}`} target="_blank" rel="noreferrer noopener">
                  {sel.url}
                </a>
                <span />
              </div>
            )}
          </>
        ) : (
          entries.length > 0 && <p className="dim">{m.pick}</p>
        )}
      </div>
      </div>

    </div>
  )
}