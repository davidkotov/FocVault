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
  /** Ordner: aktueller Pfad („“ = oberste Ebene, sonst mit „/“ am Ende) */
  cwd?: string
  onCwd?: (path: string) => void
  /** leere, selbst angelegte Ordner (vollständige Pfade ohne „/“ am Ende) */
  dirs?: string[]
  /** Dateien in einen Ordner verschieben (Ziel mit „/“ am Ende, „“ = oberste Ebene) */
  onMoveTo?: (ids: string[], dir: string) => void
  onDeleteDir?: (dir: string) => void
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

export default function FileList({ entries, busyId, canDecrypt, searchQuery, onDownload, onDelete, onShare, onPreview, onVersions, onProof, onFilecoin, headerAction, deleteNote, selected, onToggleSelect, onSelectAll, dragIds, cwd = '', onCwd, dirs = [], onMoveTo, onDeleteDir }: Props) {
  const [active, setActive] = useState<string>('all')
  const [layout, setLayout] = useState<'list' | 'grid'>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('fv_fileview') === 'grid' ? 'grid' : 'list'
  )
  const pickLayout = (l: 'list' | 'grid') => {
    setLayout(l)
    window.localStorage.setItem('fv_fileview', l)
  }
  const [sort, setSort] = useState<'recent' | 'name' | 'size'>(() => {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem('fv_filesort') : null
    return v === 'name' || v === 'size' ? v : 'recent'
  })
  const pickSort = (v: 'recent' | 'name' | 'size') => {
    setSort(v)
    window.localStorage.setItem('fv_filesort', v)
  }
  const t = useMessages(appMessages)
  const { fmtDate } = useI18n()

  const [overDir, setOverDir] = useState<string | null>(null)
  const folderMode = !!onCwd && !searchQuery
  const bySearch = searchQuery
    ? entries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : onCwd
      ? entries.filter(e => e.name.startsWith(cwd) && !e.name.slice(cwd.length).includes('/'))
      : entries
  const subdirs = (() => {
    if (!folderMode) return []
    const map = new Map<string, { n: number; size: number }>()
    for (const e of entries) {
      if (!e.name.startsWith(cwd)) continue
      const rest = e.name.slice(cwd.length)
      const i = rest.indexOf('/')
      if (i <= 0) continue
      const d = rest.slice(0, i)
      const x = map.get(d) ?? { n: 0, size: 0 }
      map.set(d, { n: x.n + 1, size: x.size + e.size })
    }
    for (const d of dirs) {
      if (!d.startsWith(cwd)) continue
      const first = d.slice(cwd.length).split('/')[0]
      if (first && !map.has(first)) map.set(first, { n: 0, size: 0 })
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })()
  const shownName = (e: VaultEntry) => (folderMode ? e.name.slice(cwd.length) : e.name)
  const crumbs = cwd ? cwd.slice(0, -1).split('/') : []
  const dropDir = (dir: string) =>
    onMoveTo
      ? {
          onDragOver: (ev: React.DragEvent) => {
            if (!ev.dataTransfer.types.includes(DRAG_MIME)) return
            ev.preventDefault()
            ev.stopPropagation()
            ev.dataTransfer.dropEffect = 'move'
            setOverDir(dir)
          },
          onDragLeave: () => setOverDir(d => (d === dir ? null : d)),
          onDrop: (ev: React.DragEvent) => {
            ev.preventDefault()
            ev.stopPropagation()
            setOverDir(null)
            document.body.classList.remove('fv-dragging')
            try {
              const ids = JSON.parse(ev.dataTransfer.getData(DRAG_MIME)) as string[]
              if (Array.isArray(ids) && ids.length) onMoveTo(ids, dir)
            } catch {
              /* fremde Daten */
            }
          }
        }
      : {}

  const counts = new Map<string, number>()
  for (const e of bySearch) counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1)
  const inFolder = active === 'all' ? bySearch : bySearch.filter(e => e.folder === active)
  const filtered = sort === 'recent' ? inFolder : [...inFolder].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.size - a.size))

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

      {folderMode && (cwd || subdirs.length > 0) && (
        <nav className="crumbs" aria-label={t.files.path}>
          <button type="button" className={`crumb${overDir === '' ? ' over' : ''}`} onClick={() => onCwd?.('')} {...dropDir('')}>
            <Icon name="cloud" size={14} /> {t.files.root}
          </button>
          {crumbs.map((c, i) => {
            const path = crumbs.slice(0, i + 1).join('/') + '/'
            return (
              <span key={path} className="crumbwrap">
                <span className="crumbsep">/</span>
                <button type="button" className={`crumb${overDir === path ? ' over' : ''}${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => onCwd?.(path)} {...dropDir(path)}>
                  {c}
                </button>
              </span>
            )
          })}
        </nav>
      )}

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
          <span style={{ flex: 1 }} />
          <label className="sortpick">
            <Icon name="list" size={14} />
            <select value={sort} aria-label={t.files.sortLabel} onChange={e => pickSort(e.target.value as 'recent' | 'name' | 'size')}>
              <option value="recent">{t.files.sortRecent}</option>
              <option value="name">{t.files.sortName}</option>
              <option value="size">{t.files.sortSize}</option>
            </select>
          </label>
            <div className="seg viewseg" role="group" aria-label={t.files.view}>
              <button type="button" className={layout === 'list' ? 'on' : ''} aria-pressed={layout === 'list'} title={t.files.viewList} onClick={() => pickLayout('list')}>
                <Icon name="list" size={15} />
              </button>
              <button type="button" className={layout === 'grid' ? 'on' : ''} aria-pressed={layout === 'grid'} title={t.files.viewGrid} onClick={() => pickLayout('grid')}>
                <Icon name="grid" size={15} />
              </button>
            </div>
        </div>
      )}

      {entries.length === 0 && (
        <p className="dim">{t.files.empty}</p>
      )}

      {entries.length > 0 && filtered.length === 0 && subdirs.length === 0 && <p className="dim">{cwd ? t.files.emptyFolder : t.files.noMatch}</p>}

      {(filtered.length > 0 || subdirs.length > 0) && (
        <div className={`filegrid${layout === 'list' ? ' aslist' : ''}`}>
          {layout === 'list' && (
            <div className="filelisthead" aria-hidden="true">
              {onToggleSelect && <span />}
              <span />
              <span>{t.files.colName}</span>
              <span>{t.files.colSize}</span>
              <span>{t.files.colDate}</span>
              <span>{t.files.colBackup}</span>
              <span />
            </div>
          )}
          {subdirs.map(([d, info]) => {
            const path = cwd + d + '/'
            return (
              <div className={`folderrow${overDir === path ? ' over' : ''}`} key={'d' + path} {...dropDir(path)}>
                {onToggleSelect && <span />}
                <button type="button" className="filetile foldertile" aria-label={`${t.files.openFolder}: ${d}`} onClick={() => onCwd?.(path)}>
                  <Icon name="folder" size={26} />
                </button>
                <div className="filename">
                  <button type="button" className="linkish" onClick={() => onCwd?.(path)}>
                    {d}
                  </button>
                </div>
                <div className="filemeta">
                  <span className="fm-size">{info.n ? fmt(info.n === 1 ? t.files.folderCountOne : t.files.folderCount, { n: info.n }) : t.files.folderEmpty}</span>
                  <span className="fm-sep"> · </span>
                  <span className="fm-date">{info.n ? formatBytes(info.size) : ''}</span>
                </div>
                <div className="fileactions">
                  {info.n === 0 && onDeleteDir && (
                    <button className="iconbtn danger" title={t.files.deleteFolder} aria-label={`${t.files.deleteFolder}: ${d}`} onClick={() => onDeleteDir(cwd + d)}>
                      <svg className="icon" width="15" height="15" viewBox="0 0 24 24">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
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
                    {shownName(e)}
                  </button>
                ) : (
                  shownName(e)
                )}
                {layout === 'list' && !!e.versions?.length && onVersions && (
                  <button type="button" className="versionbadge" onClick={() => onVersions(e)}>
                    {e.versions.length === 1 ? t.versions.badgeOne : fmt(t.versions.badge, { n: e.versions.length })}
                  </button>
                )}
              </div>
              <div className="filemeta">
                <span className="fm-size">{formatBytes(e.size)}</span>
                <span className="fm-sep"> · </span>
                <span className="fm-date">{fmtDate(e.storedAt)}</span>
                {layout !== 'list' && !!e.versions?.length && onVersions && (
                  <button type="button" className="versionbadge" onClick={() => onVersions(e)}>
                    {e.versions.length === 1 ? t.versions.badgeOne : fmt(t.versions.badge, { n: e.versions.length })}
                  </button>
                )}
                {e.objectId && !onFilecoin?.[e.objectId] && <span className="fm-pending" title={t.files.euTitle}>{t.files.eu}</span>}
                {e.objectId && onFilecoin?.[e.objectId] && (
                  <button
                    type="button"
                    className="focbadge"
                    title={fmt(t.files.onFilecoinTitle, { copies: onFilecoin[e.objectId].copies })}
                    onClick={() => onProof?.(e)}
                  >
                    {t.files.onFilecoin}
                    <span className="fm-copies"> · {fmt(t.files.copies, { n: onFilecoin[e.objectId].copies })}</span>
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
