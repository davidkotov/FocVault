'use client'

import { useEffect } from 'react'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type FileVersion, type VaultEntry } from '@/lib/vault'

/** Versionen einer Datei: aktuelle Fassung oben, ältere mit Wiederherstellen/Herunterladen. */
export default function VersionsDialog({
  entry,
  purgeAt,
  days,
  max,
  busy,
  onRestore,
  onDownload,
  onClose
}: {
  entry: VaultEntry
  purgeAt: Record<string, string>
  days: number
  max: number
  busy: boolean
  onRestore: (v: FileVersion) => void
  onDownload: (v: FileVersion) => void
  onClose: () => void
}) {
  const m = useMessages(appMessages).versions
  const { fmtDate } = useI18n()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="versions-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal">
        <div className="sharehead">
          <h3 id="versions-title">
            {m.title} · {entry.name}
          </h3>
          <button className="small" onClick={onClose}>
            {m.close}
          </button>
        </div>
        <p className="lead">{fmt(m.lead, { days, max })}</p>
        <div className="trashlist">
          <div className="trashrow">
            <div className="trashinfo">
              <strong>{when(entry.storedAt)}</strong>
              <span className="hint">{formatBytes(entry.size)}</span>
            </div>
            <span className="badge ok">{m.current}</span>
          </div>
          {(entry.versions ?? []).map(v => (
            <div className="trashrow" key={v.objectId}>
              <div className="trashinfo">
                <strong>{when(v.storedAt)}</strong>
                <span className="hint">
                  {formatBytes(v.size)}
                  {purgeAt[v.objectId] && ` · ${fmt(m.until, { date: fmtDate(purgeAt[v.objectId]) })}`}
                </span>
              </div>
              <div className="row">
                <button className="small" disabled={busy} onClick={() => onDownload(v)}>
                  {m.download}
                </button>
                <button className="small primary" disabled={busy} onClick={() => onRestore(v)}>
                  {m.restore}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
