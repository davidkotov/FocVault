'use client'

import { useState } from 'react'
import { EXPIRY_OPTIONS, type ShareOptions } from '@/lib/share'
import { formatBytes, type VaultEntry } from '@/lib/vault'

interface Props {
  entry: VaultEntry
  busy: boolean
  url: string | null
  onCreate: (options: ShareOptions) => void
  onClose: () => void
}

export default function ShareDialog({ entry, busy, url, onCreate, onClose }: Props) {
  const [expiryMs, setExpiryMs] = useState(7 * 24 * 60 * 60 * 1000)
  const [password, setPassword] = useState('')
  const [burnAfterUse, setBurnAfterUse] = useState(false)
  const [maxUsesText, setMaxUsesText] = useState('')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      void 0
    }
  }

  const submit = () =>
    onCreate({
      expiryMs,
      ...(password.trim() ? { password: password.trim() } : {}),
      ...(burnAfterUse ? { burnAfterUse: true } : {}),
      ...(maxUsesText ? { maxUses: Math.max(1, Math.floor(Number(maxUsesText)) || 1) } : {})
    })

  return (
    <div className="card">
      <h3>
        Secure Send – {entry.name}
        <button className="small" onClick={onClose}>Schließen</button>
      </h3>
      {!url && (
        <>
          <div className="stat">
            <span className="k">Datei</span>
            <span className="v">{entry.name} ({formatBytes(entry.size)})</span>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="dim">Gültigkeit:</span>
            {EXPIRY_OPTIONS.map(o => (
              <button
                key={o.ms}
                className={expiryMs === o.ms ? 'primary small' : 'small'}
                onClick={() => setExpiryMs(o.ms)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="dim">Passwort (optional):</span>
            <input
              type="password"
              value={password}
              placeholder="Freigabe-Passwort"
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={burnAfterUse} onChange={e => setBurnAfterUse(e.target.checked)} />
              <span>Einmal-Link (nur 1 Download, gerätebasiert)</span>
            </label>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="dim">Max. Downloads (optional):</span>
            <input
              type="number"
              min={1}
              value={maxUsesText}
              placeholder="z.B. 5"
              onChange={e => setMaxUsesText(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy} onClick={submit}>
              {busy ? 'Erstelle Link…' : 'Share-Link erstellen'}
            </button>
          </div>
          <p className="dim" style={{ marginTop: 10 }}>
            Der Link enthält den Schlüssel im URL-Fragment (#) – er geht nie an einen Server.
            Einmal-Link/Download-Limit sind aktuell gerätebasiert best-effort; die globale
            Durchsetzung folgt mit dem Backend (T7/T13).
          </p>
        </>
      )}
      {url && (
        <>
          <div className="costbox" style={{ marginTop: 4 }}>
            <div className="txline" style={{ border: 'none', padding: 0, marginBottom: 10 }}>
              {url}
            </div>
            <div className="row">
              <button className="primary" onClick={() => void copy()}>
                {copied ? '✓ Kopiert' : 'Link kopieren'}
              </button>
            </div>
          </div>
          <p className="dim" style={{ marginTop: 10 }}>
            Gültig {EXPIRY_OPTIONS.find(o => o.ms === expiryMs)?.label}. Verhindert die Seite nach
            Ablauf den Download. Hinweis: der verschlüsselte Piece bleibt bis zum Rail-Ablauf
            on-chain – ohne Link-Schlüssel ist er nutzlos.
          </p>
        </>
      )}
    </div>
  )
}
