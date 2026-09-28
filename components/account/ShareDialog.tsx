'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type ShareSummary } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { createShareLink } from '@/features/shares/share'
import { shareMessages } from '@/lib/i18n/messages/share'
import { formatBytes, type SecretEntry, type VaultEntry } from '@/lib/vault'
import { Icon } from '@/components/site/Icons'

type ExpiryId = 'h1' | 'd1' | 'd7' | 'd30' | 'custom' | 'never'
type DlId = 'one' | 'three' | 'ten' | 'custom' | 'unlimited'
const EXPIRY: Array<{ id: ExpiryId; hours: number | null }> = [
  { id: 'h1', hours: 1 },
  { id: 'd1', hours: 24 },
  { id: 'd7', hours: 24 * 7 },
  { id: 'd30', hours: 24 * 30 },
  { id: 'custom', hours: null },
  { id: 'never', hours: null }
]
const DOWNLOADS: Array<{ id: DlId; max: number | null }> = [
  { id: 'one', max: 1 },
  { id: 'three', max: 3 },
  { id: 'ten', max: 10 },
  { id: 'custom', max: null },
  { id: 'unlimited', max: null }
]
const MAX_HOURS = 24 * 365

/** Lokales Datum/Uhrzeit für <input type="datetime-local"> */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function randomPassword(): string {
  const a = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const b = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(b, x => a[x % a.length]).join('').replace(/(.{4})(?=.)/g, '$1-')
}

/** Secure Send: Link mit Ablauf, Download-Limit (serverseitig) und optionalem Passwort. */
export default function ShareDialog({
  entry,
  entries,
  note,
  masterKey,
  onClose,
  onCreated,
  onLink
}: {
  /** Notiz teilen (Anhänge werden mitgesendet) */
  note?: SecretEntry
  onCreated?: (shareId: string) => void
  /** fertiger Link (inkl. Schlüssel) – wird verschlüsselt im Tresor gemerkt, damit er später kopiert werden kann */
  onLink?: (link: { id: string; url: string; label: string; createdAt: number }) => void
  entry?: VaultEntry
  /** mehrere Dateien → ein gemeinsamer Link */
  entries?: VaultEntry[]
  masterKey: CryptoKey
  onClose: () => void
}) {
  const list = note ? (note.attachments ?? []) : (entries ?? (entry ? [entry] : []))
  const single = !note && list.length === 1 ? list[0] : null
  const m = useMessages(shareMessages).dialog
  const { fmtDate, locale } = useI18n()
  const errText = useErrorText()
  const [expiry, setExpiry] = useState<ExpiryId>('d7')
  const [customDate, setCustomDate] = useState(() => localInput(new Date(Date.now() + 3 * 86_400_000)))
  const [downloads, setDownloads] = useState<DlId>('ten')
  const [customDl, setCustomDl] = useState(25)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shares, setShares] = useState<ShareSummary[]>([])

  const load = useCallback(async () => {
    if (!single?.objectId) return
    try {
      setShares((await api.listShares(single.objectId)).shares)
    } catch {
      /* Liste ist optional */
    }
  }, [single?.objectId])

  useEffect(() => {
    void load()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [load, onClose])

  const hours = (() => {
    if (expiry === 'custom') {
      const t = new Date(customDate).getTime()
      if (!Number.isFinite(t)) return NaN
      return Math.ceil((t - Date.now()) / 3_600_000)
    }
    return EXPIRY.find(e => e.id === expiry)!.hours
  })()
  const customInvalid = expiry === 'custom' && (!Number.isFinite(hours as number) || (hours as number) < 1 || (hours as number) > MAX_HOURS)
  const maxDl = downloads === 'custom' ? Math.max(1, Math.min(1000, Math.round(customDl) || 1)) : DOWNLOADS.find(d => d.id === downloads)!.max
  const until = hours && Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null
  const name = note ? note.title : single ? single.name : fmt(m.nFiles, { n: list.length })

  const create = async () => {
    if (customInvalid) return
    setBusy(true)
    setError(null)
    try {
      const r = await createShareLink(list, masterKey, {
        expiresInHours: hours as number | null,
        maxDownloads: maxDl,
        password: password.trim() || undefined,
        note: note ? { title: note.title, body: note.body, template: note.template, fields: note.fields, tags: note.tags } : undefined
      })
      onCreated?.(r.id)
      onLink?.({ id: r.id, url: r.url, label: name, createdAt: Date.now() })
      setUrl(r.url)
      setCopied(false)
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (!url) return
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal sm2">
        <div className="sm2-head">
          <span className="sm2-badge">
            <Icon name="send" size={20} />
          </span>
          <div>
            <h3 id="share-title">{m.title}</h3>
            <span className="dim">{m.subtitle}</span>
          </div>
          <button className="linkish sm2-close" onClick={onClose} aria-label={m.close}>
            {m.close}
          </button>
        </div>

        <div className="sm2-file">
          <span className="pwavatar">
            <Icon name={note ? 'note' : 'file'} size={18} />
          </span>
          <div className="invmain">
            <b>{name}</b>
            <span className="dim">
              {note
                ? list.length
                  ? fmt(m.withAttachmentsShort, { n: list.length })
                  : m.noteOnly
                : single
                  ? formatBytes(single.size)
                  : `${list.map(e => e.name).slice(0, 3).join(', ')}${list.length > 3 ? ' …' : ''} · ${formatBytes(list.reduce((n, e) => n + e.size, 0))}`}
            </span>
          </div>
          <span className="sm2-e2e">
            <Icon name="lock" size={13} /> {m.e2e}
          </span>
        </div>

        {error && <div className="errorbox">{error}</div>}

        {url ? (
          <div className="sm2-ready">
            <div className="sm2-done">
              <span>
                <Icon name="check" size={20} />
              </span>
              <div>
                <b>{m.ready}</b>
                <span className="dim">
                  {[until ? fmt(m.sumUntil, { date: until.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }) : m.sumForever, maxDl ? (maxDl === 1 ? m.sumOnce : fmt(m.sumMax, { n: maxDl })) : m.sumUnlimited, password.trim() ? m.sumPassword : null].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
            <div className="sharelink">
              <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label={m.ready} />
              <button className="primary" onClick={copy}>
                {copied ? m.copied : m.copy}
              </button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <a className="button small" href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(url)}`}>
                <Icon name="mail" size={14} /> {m.viaMail}
              </a>
              {password.trim() && <span className="hint">{m.passwordHint}</span>}
            </div>
          </div>
        ) : (
          <>
            <div className="sm2-section">
              <span className="sm2-label">{m.expiry}</span>
              <div className="sm2-seg" role="group" aria-label={m.expiry}>
                {EXPIRY.map(o => (
                  <button key={o.id} type="button" className={expiry === o.id ? 'active' : ''} aria-pressed={expiry === o.id} onClick={() => setExpiry(o.id)}>
                    {m.expiryOptions[o.id]}
                  </button>
                ))}
              </div>
              {expiry === 'custom' && (
                <label className="sm2-custom">
                  <span className="dim">{m.customUntil}</span>
                  <input type="datetime-local" value={customDate} min={localInput(new Date(Date.now() + 3_600_000))} max={localInput(new Date(Date.now() + MAX_HOURS * 3_600_000))} onChange={e => setCustomDate(e.target.value)} aria-label={m.customUntil} />
                  {customInvalid && <span className="errortext">{m.customInvalid}</span>}
                </label>
              )}
            </div>

            <div className="sm2-section">
              <span className="sm2-label">{m.downloads}</span>
              <div className="sm2-seg" role="group" aria-label={m.downloads}>
                {DOWNLOADS.map(o => (
                  <button key={o.id} type="button" className={downloads === o.id ? 'active' : ''} aria-pressed={downloads === o.id} onClick={() => setDownloads(o.id)}>
                    {m.downloadOptions[o.id]}
                  </button>
                ))}
              </div>
              {downloads === 'custom' && (
                <label className="sm2-custom">
                  <span className="dim">{m.customDownloads}</span>
                  <input className="capinput" type="number" min={1} max={1000} value={customDl} onChange={e => setCustomDl(Number(e.target.value))} aria-label={m.customDownloads} />
                </label>
              )}
            </div>

            <div className="sm2-section">
              <label className="sm2-label" htmlFor="share-pass">
                {m.password}
              </label>
              <div className="pwrow">
                <input id="share-pass" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={m.passwordPlaceholder} />
                <button type="button" className="iconbtn" aria-label={showPw ? m.hidePw : m.showPw} title={showPw ? m.hidePw : m.showPw} onClick={() => setShowPw(v => !v)}>
                  <Icon name="eye" size={15} />
                </button>
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    setPassword(randomPassword())
                    setShowPw(true)
                  }}
                >
                  {m.generate}
                </button>
              </div>
              <span className="hint">{m.passwordHint}</span>
            </div>

            <div className="sm2-summary">
              <Icon name="shield" size={15} />
              <span>
                {[until ? fmt(m.sumUntil, { date: until.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }) : expiry === 'never' ? m.sumForever : '—', maxDl ? (maxDl === 1 ? m.sumOnce : fmt(m.sumMax, { n: maxDl })) : m.sumUnlimited, password.trim() ? m.sumPassword : m.sumNoPassword].join(' · ')}
              </span>
            </div>

            <button className="primary full" disabled={busy || customInvalid} onClick={() => void create()}>
              {busy ? m.creating : m.create}
            </button>
          </>
        )}
        <p className="hint sm2-note">{note ? m.noteNoSize : m.noSize}</p>

        {single && shares.length > 0 && (
          <details className="sm2-existing">
            <summary>{fmt(m.existingN, { n: shares.length })}</summary>
            {shares.map(s => (
              <div className="sharerow" key={s.id}>
                <span className={`badge${s.active ? ' ok' : ''}`}>{s.active ? m.active : m.inactive}</span>
                <span className="hint">
                  {s.expiresAt ? fmt(m.until, { date: fmtDate(s.expiresAt) }) : m.forever} ·{' '}
                  {s.maxDownloads ? fmt(m.used, { n: s.downloads, max: s.maxDownloads }) : fmt(m.usedUnlimited, { n: s.downloads })}
                </span>
                {s.active && (
                  <button className="small" onClick={() => void api.revokeShare(s.id).then(load)}>
                    {m.revoke}
                  </button>
                )}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  )
}
