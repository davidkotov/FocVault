'use client'

import { useState } from 'react'
import { FOLDERS, formatBytes, type VaultEntry } from '@/lib/vault'

interface Props {
  entries: VaultEntry[]
  busyId: string | null
  canDecrypt: boolean
  searchQuery?: string
  onDownload: (entry: VaultEntry) => void
  onDelete: (id: string) => void
  onShare: (entry: VaultEntry) => void
}

function iconFor(folder: string): string {
  const f = FOLDERS.find(x => x.id === folder)
  return f && f.id !== 'all' ? f.icon : '🗄️'
}

function tileColor(folder: string): string {
  switch (folder) {
    case 'photos':
      return 'var(--red-soft)'
    case 'videos':
      return 'var(--purple-soft)'
    case 'documents':
      return 'var(--accent-soft)'
    default:
      return 'var(--green-soft)'
  }
}

export default function FileList({ entries, busyId, canDecrypt, searchQuery, onDownload, onDelete, onShare }: Props) {
  const [active, setActive] = useState<string>('all')

  const bySearch = searchQuery
    ? entries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries

  const counts = new Map<string, number>()
  for (const e of bySearch) counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1)
  const filtered = active === 'all' ? bySearch : bySearch.filter(e => e.folder === active)

  return (
    <div className="card">
      <h3>
        Meine Dateien
        <span>
          {entries.length} Dateien · {formatBytes(entries.reduce((s, e) => s + e.size, 0))}
        </span>
      </h3>

      {entries.length > 0 && (
        <div className="chipsrow">
          {FOLDERS.map(f => {
            const n = f.id === 'all' ? bySearch.length : counts.get(f.id) ?? 0
            if (f.id !== 'all' && n === 0) return null
            return (
              <button key={f.id} className={active === f.id ? 'chip active' : 'chip'} onClick={() => setActive(f.id)}>
                {f.icon} {f.label} {n > 0 ? `(${n})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {entries.length === 0 && (
        <p className="dim">
          Noch keine Dateien in deiner Cloud. Oben hochladen – Dateien landen automatisch im
          passenden Ordner.
        </p>
      )}

      {entries.length > 0 && filtered.length === 0 && <p className="dim">Keine Treffer.</p>}

      {filtered.length > 0 && (
        <div className="filegrid">
          {filtered.map(e => (
            <div className="filecard" key={e.id}>
              <div className="filetile" style={{ background: tileColor(e.folder) }}>
                {iconFor(e.folder)}
              </div>
              <div className="filename" title={e.name}>
                {e.name}
              </div>
              <div className="filemeta">
                {formatBytes(e.size)} · {new Date(e.storedAt).toLocaleDateString('de-DE')}
              </div>
              <div className="fileactions">
                <button
                  className="iconbtn"
                  title="Teilen"
                  disabled={!canDecrypt || busyId === e.id}
                  onClick={() => onShare(e)}
                >
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <circle cx="18" cy="5" r="2.5" />
                    <circle cx="6" cy="12" r="2.5" />
                    <circle cx="18" cy="19" r="2.5" />
                    <path d="M8.4 10.6l6.5-3M8.4 13.4l6.5 3" />
                  </svg>
                </button>
                <button
                  className="iconbtn"
                  title="Herunterladen"
                  disabled={!canDecrypt || busyId === e.id}
                  onClick={() => onDownload(e)}
                >
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M12 15V3M8 7l4-4 4 4" />
                    <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
                  </svg>
                </button>
                <button
                  className="iconbtn danger"
                  title="Entfernen"
                  disabled={busyId === e.id}
                  onClick={() => onDelete(e.id)}
                >
                  <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="dim" style={{ marginTop: 14 }}>
        „Entfernen" löscht nur den Vault-Eintrag – die verschlüsselten Pieces bleiben bis zum
        Rail-Ablauf on-chain.
      </p>
    </div>
  )
}
