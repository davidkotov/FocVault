'use client'

import { useState } from 'react'
import { EXPIRY_OPTIONS } from '@/lib/share'
import { formatBytes, type VaultEntry } from '@/lib/vault'

interface Props {
  entry: VaultEntry
  busy: boolean
  url: string | null
  onCreate: (days: number) => void
  onClose: () => void
}

export default function ShareDialog({ entry, busy, url, onCreate, onClose }: Props) {
  const [days, setDays] = useState(7)
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
                key={o.days}
                className={days === o.days ? 'primary small' : 'small'}
                onClick={() => setDays(o.days)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy} onClick={() => onCreate(days)}>
              {busy ? 'Erstelle Link…' : 'Share-Link erstellen'}
            </button>
          </div>
          <p className="dim" style={{ marginTop: 10 }}>
            Der Link enthält den Schlüssel im URL-Fragment (#) – er geht nie an einen Server.
            Empfänger brauchen nur ein Wallet zum Abrufen, kein Konto.
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
            Gültig {EXPIRY_OPTIONS.find(o => o.days === days)?.label}. Nach Ablauf verweigert die
            Seite den Download. Hinweis: der verschlüsselte Piece bleibt bis zum Rail-Ablauf
            on-chain – ohne Link-Schlüssel ist er nutzlos.
          </p>
        </>
      )}
    </div>
  )
}
