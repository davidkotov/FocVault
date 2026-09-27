'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type ShareSummary } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { createShareLink } from '@/features/shares/share'
import { shareMessages } from '@/lib/i18n/messages/share'
import { formatBytes, type VaultEntry } from '@/lib/vault'

const EXPIRY: Array<{ id: keyof typeof shareMessages.de.dialog.expiryOptions; hours: number | null }> = [
  { id: 'h1', hours: 1 },
  { id: 'd1', hours: 24 },
  { id: 'd7', hours: 24 * 7 },
  { id: 'd30', hours: 24 * 30 },
  { id: 'never', hours: null }
]
const DOWNLOADS: Array<{ id: keyof typeof shareMessages.de.dialog.downloadOptions; max: number | null }> = [
  { id: 'one', max: 1 },
  { id: 'three', max: 3 },
  { id: 'ten', max: 10 },
  { id: 'unlimited', max: null }
]

/** Secure Send: Link mit Ablauf, Download-Limit (serverseitig) und optionalem Passwort. */
export default function ShareDialog({
  entry,
  entries,
  masterKey,
  onClose
}: {
  entry?: VaultEntry
  /** mehrere Dateien → ein gemeinsamer Link */
  entries?: VaultEntry[]
  masterKey: CryptoKey
  onClose: () => void
}) {
  const list = entries ?? (entry ? [entry] : [])
  const single = list.length === 1 ? list[0] : null
  const m = useMessages(shareMessages).dialog
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['id']>('d7')
  const [downloads, setDownloads] = useState<(typeof DOWNLOADS)[number]['id']>('ten')
  const [password, setPassword] = useState('')
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

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await createShareLink(list, masterKey, {
        expiresInHours: EXPIRY.find(e => e.id === expiry)!.hours,
        maxDownloads: DOWNLOADS.find(d => d.id === downloads)!.max,
        password: password.trim() || undefined
      })
      setUrl(r.url)
      setCopied(false)
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal">
        <div className="sharehead">
          <h3 id="share-title">{m.title}</h3>
          <button className="small" onClick={onClose}>
            {m.close}
          </button>
        </div>
        <p className="lead">{fmt(m.lead, { name: single ? single.name : fmt(m.nFiles, { n: list.length }) })}</p>
        <div className="hint" style={{ marginBottom: 12 }}>
          {single ? `${single.name} · ${formatBytes(single.size)}` : `${list.map(e => e.name).slice(0, 5).join(', ')}${list.length > 5 ? ' …' : ''} · ${formatBytes(list.reduce((n, e) => n + e.size, 0))}`}
        </div>
        {error && <div className="errorbox">{error}</div>}

        {url ? (
          <div className="sharelink">
            <strong>{m.ready}</strong>
            <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label={m.ready} />
            <button
              className="primary"
              onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
            >
              {copied ? m.copied : m.copy}
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label>{m.expiry}</label>
              <div className="chips">
                {EXPIRY.map(o => (
                  <button key={o.id} type="button" className={`chip${expiry === o.id ? ' active' : ''}`} aria-pressed={expiry === o.id} onClick={() => setExpiry(o.id)}>
                    {m.expiryOptions[o.id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{m.downloads}</label>
              <div className="chips">
                {DOWNLOADS.map(o => (
                  <button key={o.id} type="button" className={`chip${downloads === o.id ? ' active' : ''}`} aria-pressed={downloads === o.id} onClick={() => setDownloads(o.id)}>
                    {m.downloadOptions[o.id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="share-pass">{m.password}</label>
              <input id="share-pass" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
              <span className="hint">{m.passwordHint}</span>
            </div>
            <button className="primary full" disabled={busy} onClick={() => void create()}>
              {busy ? m.creating : m.create}
            </button>
          </>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          {m.noSize}
        </p>

{single && (
        <div className="sharelist">
          <div className="navsection" style={{ padding: '10px 0 6px' }}>
            {m.existing}
          </div>
          {shares.length === 0 && <span className="hint">{m.none}</span>}
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
        </div>
        )}
      </div>
    </div>
  )
}
