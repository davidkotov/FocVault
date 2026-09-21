'use client'

import { useRef } from 'react'

interface Props {
  unlocked: boolean
  busy: boolean
  syncing: string | null
  syncEnabled: boolean
  onUnlock: () => void
  onLock: () => void
  onExport: () => void
  onImport: (file: File) => void
  onPushSync: () => void
  onPullSync: () => void
  fileCount: number
}

export default function VaultUnlock({
  unlocked,
  busy,
  syncing,
  syncEnabled,
  onUnlock,
  onLock,
  onExport,
  onImport,
  onPushSync,
  onPullSync,
  fileCount
}: Props) {
  const importRef = useRef<HTMLInputElement>(null)

  return (
    <div className="card">
      <h3>
        Vault-Schlüssel
        <span className={`badge ${unlocked ? 'ok' : ''}`}>{unlocked ? 'entsperrt' : 'gesperrt'}</span>
      </h3>
      <p className="dim">
        {unlocked
          ? 'Master-Schlüssel im RAM dieser Session – sperrt automatisch nach 30 Min Inaktivität. Files werden vor dem Upload AES-256-GCM-verschlüsselt, der Schlüssel verlässt dein Gerät nie.'
          : 'Signiere einmalig mit deiner Wallet, um deinen lokalen Verschlüsselungsschluessel abzuleiten (HKDF aus der Signatur). Keine Transaktion, keine Kosten.'}
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        {!unlocked && (
          <button className="primary" disabled={busy} onClick={onUnlock}>
            {busy ? 'Warte auf Signatur…' : 'Vault entschlüsseln'}
          </button>
        )}
        {unlocked && (
          <>
            <button className="danger" onClick={onLock}>Sofort sperren</button>
            <button disabled={fileCount === 0} onClick={onExport}>Export ({fileCount})</button>
            <button onClick={() => importRef.current?.click()}>Import (.vault)</button>
            {syncEnabled && (
              <>
                <button className="primary" disabled={syncing !== null} onClick={onPushSync}>
                  {syncing === 'push' ? 'Sync läuft…' : 'Auf Chain syncen'}
                </button>
                <button disabled={syncing !== null} onClick={onPullSync}>
                  {syncing === 'pull' ? 'Lädt…' : 'Von Chain laden'}
                </button>
              </>
            )}
            <input
              ref={importRef}
              type="file"
              accept=".vault,application/octet-stream"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) onImport(f)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      {unlocked && syncEnabled && (
        <p className="dim" style={{ marginTop: 10 }}>
          Chain-Sync: verschlüsselter Vault-Index als Piece on-chain + pieceCid im
          SubscriptionGate registriert – so findest du deinen Vault auf jedem Gerät wieder.
        </p>
      )}
    </div>
  )
}
