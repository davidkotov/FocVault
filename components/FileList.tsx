'use client'

import { Icon, type IconName } from '@/components/site/Icons'
import { useState, type ReactNode } from 'react'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { FOLDERS, formatBytes, type VaultEntry } from '@/lib/vault'

interface Props {
  entries: VaultEntry[]
  busyId: string | null
  canDecrypt: boolean
  searchQuery?: string
  onDownload: (entry: VaultEntry) => void
  onDelete: (id: string) => void
  onShare: (entry: VaultEntry) => void
  /** Mehrfachauswahl (IDs) */
  selected?: Set<string>
  onToggleSelect?: (id: string) => void
  onSelectAll?: (ids: string[]) => void
  /** Drag & Drop: gezogene Dateien (bei Auswahl alle markierten) */
  dragIds?: (id: string) => string[]
  /** Rechts in der Kopfzeile, z. B. der Papierkorb-Button */
  headerAction?: ReactNode
  /** Nachweis auf Filecoin anzeigen */
  onProof?: (entry: VaultEntry) => void
  /** Versionen einer Datei anzeigen */
  onVersions?: (entry: VaultEntry) => void
  /** Klick auf Vorschaubild/Name */
  onPreview?: (entry: VaultEntry) => void
  /** objectId → bestätigte Kopien auf Filecoin */
  onFilecoin?: Record<string, { copies: number }>
  /** Hinweis unter der Liste; Standard beschreibt den Wallet-Modus (Pieces bleiben on-chain). */
  deleteNote?: string
}

/** Datentyp für gezogene Dateien (IDs als JSON) */
export const DRAG_MIME = 'application/x-focvault-files'

const FOLDER_ICON: Record<string, IconName> = { all: 'cloud', documents: 'file', photos: 'image', videos: 'video', backups: 'archive' }

function iconFor(folder: string) {
  return <Icon name={FOLDER_ICON[folder] ?? 'archive'} size={30} />
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

export default function FileList({ entries, busyId, canDecrypt, searchQuery, onDownload, onDelete, onShare, onPreview, onVersions, onProof, onFilecoin, headerAction, deleteNote, selected, onToggleSelect, onSelectAll, dragIds }: Props) {
  const [active, setActive] = useState<string>('all')
  const t = useMessages(appMessages)
  const { fmtDate } = useI18n()

  const bySearch = searchQuery
    ? entries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries

  const counts = new Map<string, number>()
  for (const e of bySearch) counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1)
  const filtered = active === 'all' ? bySearch : bySearch.filter(e => e.folder === active)

  return (
    <div className="card">
      <h3>
        {t.files.title}
        <div className="h3right">
          {onSelectAll && filtered.length > 0 && (
            <button type="button" className="linkish selectall" onClick={() => onSelectAll(filtered.map(e => e.id))}>
              {t.bulk.selectAll}
            </button>
          )}
          <span>{fmt(t.files.count, { n: entries.length, size: formatBytes(entries.reduce((s, e) => s + e.size, 0)) })}</span>
          {headerAction}
        </div>
      </h3>

      {entries.length > 0 && (
        <div className="chipsrow">
          {FOLDERS.map(f => {
            const n = f.id === 'all' ? bySearch.length : counts.get(f.id) ?? 0
            if (f.id !== 'all' && n === 0) return null
            return (
              <button key={f.id} className={active === f.id ? 'chip active' : 'chip'} onClick={() => setActive(f.id)}>
                <Icon name={FOLDER_ICON[f.id] ?? 'archive'} size={14} /> {t.folders[f.id]} {n > 0 ? `(${n})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {entries.length === 0 && (
        <p className="dim">{t.files.empty}</p>
      )}

      {entries.length > 0 && filtered.length === 0 && <p className="dim">{t.files.noMatch}</p>}

      {filtered.length > 0 && (
        <div className="filegrid">
          {filtered.map(e => (
            <div
              className={`filecard ${selected?.has(e.id) ? 'selected' : ''}`}
              key={e.id}
              draggable={!!dragIds}
              onDragStart={ev => {
                if (!dragIds) return
                const ids = dragIds(e.id)
                ev.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
                ev.dataTransfer.setData('text/plain', ids.length > 1 ? fmt(t.bulk.selected, { n: ids.length }) : e.name)
                ev.dataTransfer.effectAllowed = 'move'
                document.body.classList.add('fv-dragging')
              }}
              onDragEnd={() => document.body.classList.remove('fv-dragging')}
            >
              {onToggleSelect && (
                <label className="filecheck" title={t.bulk.select}>
                  <input type="checkbox" checked={!!selected?.has(e.id)} onChange={() => onToggleSelect(e.id)} aria-label={`${t.bulk.select}: ${e.name}`} />
                </label>
              )}
              <button
                type="button"
                className="filetile"
                style={{ background: tileColor(e.folder) }}
                aria-label={`${t.preview.open}: ${e.name}`}
                disabled={!canDecrypt || !onPreview}
                onClick={() => onPreview?.(e)}
              >
                {iconFor(e.folder)}
              </button>
              <div className="filename" title={e.name}>
                {onPreview ? (
                  <button type="button" className="linkish" onClick={() => onPreview(e)}>
                    {e.name}
                  </button>
                ) : (
                  e.name
                )}
              </div>
              <div className="filemeta">
                {formatBytes(e.size)} · {fmtDate(e.storedAt)}
                {!!e.versions?.length && onVersions && (
                  <button type="button" className="versionbadge" onClick={() => onVersions(e)}>
                    {e.versions.length === 1 ? t.versions.badgeOne : fmt(t.versions.badge, { n: e.versions.length })}
                  </button>
                )}
                {e.objectId && onFilecoin?.[e.objectId] && (
                  <button
                    type="button"
                    className="focbadge"
                    title={fmt(t.files.onFilecoinTitle, { copies: onFilecoin[e.objectId].copies })}
                    onClick={() => onProof?.(e)}
                  >
                    {t.files.onFilecoin}
                  </button>
                )}
              </div>
              <div className="fileactions">
                <button
                  className="iconbtn"
                  title={t.files.share}
                  aria-label={t.files.share}
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
                  title={t.files.download}
                  aria-label={t.files.download}
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
                  title={t.files.remove}
                  aria-label={t.files.remove}
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
        {deleteNote ??
          '„Entfernen" löscht nur den Vault-Eintrag – die verschlüsselten Pieces bleiben bis zum Rail-Ablauf on-chain.'}
      </p>
    </div>
  )
}
