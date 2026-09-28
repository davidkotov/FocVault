'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SiteAvatar from '@/components/SiteAvatar'
import { hostFromName, loadSiteIcon } from '@/features/icons/client'
import type { SecretEntry } from '@/lib/vault'
import { generateTotp, generateBase32Secret, totpRemaining, parseOtpauth } from '@/lib/totp'
import QrScanModal from '@/components/QrScanModal'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { secretsMessages } from '@/lib/i18n/messages/secrets'

interface Props {
  entries: SecretEntry[]
  onSave: (s: SecretEntry) => void
  onDelete: (id: string) => void
  readOnly?: boolean
  heading?: string
  /** Einträge still aktualisieren (Icons nachladen) */
  onPatch?: (list: SecretEntry[]) => void
  /** Passwort-Einträge: deren Icons werden für passende 2FA-Konten übernommen */
  passwords?: SecretEntry[]
}

interface LiveState {
  codes: Record<string, string>
  remaining: Record<string, number>
}

interface FormState {
  id?: string
  title: string
  secret: string
  otpauth: string
}

export default function TotpPanel({ entries, onSave, onDelete, readOnly = false, heading, onPatch, passwords = [] }: Props) {
  const { common: c, totp: m } = useMessages(secretsMessages)
  const [live, setLive] = useState<LiveState>({ codes: {}, remaining: {} })
  const [form, setForm] = useState<FormState | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const copyCode = (id: string, code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => undefined)
    setCopied(id)
    setTimeout(() => setCopied(c => (c === id ? null : c)), 1400)
  }
  // Icons: vom passenden Passwort-Eintrag übernehmen, sonst über den Namen erkennen
  useEffect(() => {
    if (!onPatch || readOnly) return
    const keyOf = (e: SecretEntry) => hostFromName(e.issuer || e.title)
    const todo = entries.filter(e => {
      const k = keyOf(e)
      return k && e.iconHost !== k
    }).slice(0, 12)
    if (!todo.length) return
    let alive = true
    void (async () => {
      const out: SecretEntry[] = []
      for (const e of todo) {
        const host = keyOf(e)
        const name = (e.issuer || e.title).toLowerCase()
        const pw = passwords.find(p => p.icon && (p.iconHost === host || p.title.toLowerCase() === name))
        out.push({ ...e, icon: pw?.icon || (await loadSiteIcon(host)), iconHost: host })
      }
      if (alive) onPatch(out)
    })()
    return () => {
      alive = false
    }
  }, [entries, passwords, onPatch, readOnly])
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('pageactions-slot')), [])
  const lastScan = useRef('')

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const codes: Record<string, string> = {}
      const remaining: Record<string, number> = {}
      for (const e of entries) {
        const period = e.period ?? 30
        remaining[e.id] = totpRemaining(Date.now(), period)
        try {
          codes[e.id] = await generateTotp({
            secret: e.secretBase32 ?? '',
            digits: e.digits ?? 6,
            period,
            algorithm: e.algorithm ?? 'SHA1'
          })
        } catch {
          codes[e.id] = '—'
        }
      }
      if (alive) setLive({ codes, remaining })
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [entries])

  const startNew = () => setForm({ title: '', secret: '', otpauth: '' })

  const handleScanResult = (data: string) => {
    const parsed = parseOtpauth(data)
    if (parsed) {
      setForm({
        title: parsed.account || parsed.issuer || '',
        secret: parsed.secret,
        otpauth: data.trim()
      })
      setScanOpen(false)
    } else if (lastScan.current !== data) {
      lastScan.current = data
      alert(m.invalidScan)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    let secret = form.secret.trim()
    let title = form.title.trim()
    let digits = 6
    let period = 30
    let algorithm: 'SHA1' | 'SHA256' | 'SHA512' = 'SHA1'
    let issuer: string | undefined

    if (form.otpauth.trim()) {
      const parsed = parseOtpauth(form.otpauth)
      if (!parsed) {
        alert(m.invalidLink)
        return
      }
      secret = parsed.secret
      title = title || parsed.account || ''
      issuer = parsed.issuer
      digits = parsed.digits ?? digits
      period = parsed.period ?? period
      algorithm = parsed.algorithm ?? algorithm
    }
    if (!title || !secret) return
    const now = Date.now()
    onSave({
      id: form.id ?? crypto.randomUUID(),
      kind: 'totp',
      title,
      issuer: issuer || (form.id ? entries.find(x => x.id === form.id)?.issuer : undefined),
      secretBase32: secret.toUpperCase(),
      digits,
      period,
      algorithm,
      createdAt: form.id ? entries.find(x => x.id === form.id)?.createdAt ?? now : now,
      updatedAt: now
    })
    setForm(null)
  }

  const q = filter.trim().toLowerCase()
  const shown = entries.filter(e => !q || [e.title, e.issuer].some(x => x?.toLowerCase().includes(q)))
  const standalone = !heading
  const actions = !readOnly && (
    <>
      <button
        className="small"
        onClick={() => {
          if (!form) startNew()
          setScanOpen(true)
        }}
      >
        {m.scanQr}
      </button>
      <button className="primary small" onClick={startNew}>
        {m.addButton}
      </button>
    </>
  )

  return (
    <div className={standalone ? 'pwpage totppage' : 'card pwpage totppage'}>
      {standalone && slot ? (
        createPortal(actions, slot)
      ) : (
        <h3>
          {heading ?? m.heading}
          <span>{fmt(m.subtitle, { n: entries.length })}</span>
          {actions}
        </h3>
      )}

      {form && (
        <div className="card totpform">
          <form className="secform" onSubmit={submit}>
            <h4>{form.id ? m.editTitle : m.addTitle}</h4>
            <div className="secfields">
              <label>
                {m.otpauthLabel}
                <div className="pwrow">
                  <textarea rows={2} value={form.otpauth} onChange={e => setForm({ ...form, otpauth: e.target.value })} placeholder="otpauth://totp/Google:name@mail.com?secret=…" />
                  <button type="button" className="small scanbtn" onClick={() => setScanOpen(true)}>
                    <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                      <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" />
                      <rect x="7" y="7" width="10" height="10" rx="2" />
                    </svg>
                    {m.scanQr}
                  </button>
                </div>
              </label>
              <div className="orline"><span>{m.orManual}</span></div>
              <label>
                {c.title} <span className="req">*</span>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={m.titlePlaceholder} />
              </label>
              <label>
                {m.secret}
                <div className="pwrow">
                  <input
                    value={form.secret}
                    onChange={e => setForm({ ...form, secret: e.target.value.toUpperCase() })}
                    placeholder="JBSWY3DPEHPK3PXP"
                    className="mono"
                  />
                  <button type="button" className="small" onClick={() => setForm({ ...form, secret: generateBase32Secret() })}>
                    {c.generate}
                  </button>
                </div>
              </label>
              <p className="dim" style={{ fontSize: 12.5 }}>
                {m.autoHint}
              </p>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="primary" type="submit" disabled={!form.title.trim() || (!form.secret.trim() && !form.otpauth.trim())}>
                {c.save}
              </button>
              <button type="button" onClick={() => setForm(null)}>{c.cancel}</button>
            </div>
          </form>
        </div>
      )}

      {entries.length > 0 && (
        <div className="totptools">
          <input className="searchinput" value={filter} onChange={e => setFilter(e.target.value)} placeholder={m.filter} aria-label={m.filter} />
        </div>
      )}

      {shown.length > 0 && (
        <div className="seclist totpgrid">
          {shown.map(s => {
            const period = s.period ?? 30
            const rem = live.remaining[s.id] ?? period
            const pct = Math.max(0, Math.min(100, (rem / period) * 100))
            return (
              <div className={`secrow totpcard${copied === s.id ? ' copied' : ''}`} key={s.id}>
                <SiteAvatar title={s.issuer || s.title} icon={s.icon} size={40} />
                <div className="secmain">
                  <div className="sectitle">{s.issuer || s.title}</div>
                  <div className="secmeta">{s.issuer && s.issuer !== s.title ? s.title : 'TOTP'}</div>
                  <button
                    type="button"
                    className="totpcode linkish"
                    title={c.copy}
                    onClick={() => copyCode(s.id, live.codes[s.id] ?? '')}
                  >
                    {(live.codes[s.id] ?? '······').replace(/^(\d{3})(\d{3})$/, '$1 $2')}
                  </button>
                  <span className="copiedtoast" role="status" aria-live="polite">
                    {copied === s.id ? m.copied : ''}
                  </span>
                </div>
                <div className="totpcode-box">
                  <svg className="totpring" viewBox="0 0 36 36" aria-label={`${rem} s`}>
                    <circle cx="18" cy="18" r="15" fill="none" stroke="#eef0f4" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke={pct < 20 ? '#c43b3b' : '#0090ff'} strokeWidth="3.5" strokeLinecap="round" transform="rotate(-90 18 18)" strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - pct / 100)} />
                    <text x="18" y="22" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0b1220">{rem}</text>
                  </svg>
                </div>
                {!readOnly && <div className="secactions">
                  <button className="iconbtn" title={c.edit} onClick={() => setForm({ id: s.id, title: s.title, secret: s.secretBase32 ?? '', otpauth: '' })}>
                    <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button className="iconbtn danger" title={m.remove} onClick={() => onDelete(s.id)}>
                    <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>}
              </div>
            )
          })}
        </div>
      )}

      {entries.length === 0 && !form && <p className="dim card pwempty">{m.empty}</p>}
      {entries.length > 0 && <p className="hint">{m.tip}</p>}

      {scanOpen && <QrScanModal onDetected={handleScanResult} onClose={() => setScanOpen(false)} />}
    </div>
  )
}
