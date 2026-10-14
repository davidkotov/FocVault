'use client'

import { useEffect } from 'react'
import { Icon } from '@/components/site/Icons'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type VaultEntry } from '@/lib/vault'

interface Props {
  files: VaultEntry[]
  /** objectId → bestätigte Kopien auf Filecoin (und seit wann) */
  onFilecoin: Record<string, { copies: number; since?: string }>
  /** Nachweis einer einzelnen Datei öffnen */
  onOpen: (entry: VaultEntry) => void
  onClose: () => void
}

/** Übersicht aller Speicherbeweise: welche Datei wann mit wie vielen Kopien gesichert wurde. */
export default function ProofsDialog({ files, onFilecoin, onOpen, onClose }: Props) {
  const t = useMessages(appMessages)
  const m = t.proofs
  const { fmtDate } = useI18n()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const withObj = files.filter(f => f.objectId)
  const secured = withObj
    .map(f => ({ f, s: onFilecoin[f.objectId!] }))
    .filter((x): x is { f: VaultEntry; s: { copies: number; since?: string } } => (x.s?.copies ?? 0) > 0)
    .sort((a, b) => (b.s.since ?? '').localeCompare(a.s.since ?? '') || a.f.name.localeCompare(b.f.name))
  const pending = withObj.length - secured.length

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="proofs-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal proofsmodal">
        <div className="sharehead">
          <h3 id="proofs-title">
            <Icon name="proof" size={18} className="inlineicon" /> {m.title}
          </h3>
          <button type="button" className="modalclose" aria-label={m.close} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="lead">{m.lead}</p>
        <div className="proofsstats">
          <b>{fmt(m.summary, { n: secured.length, total: withObj.length })}</b>
          {pending > 0 && <span className="dim">{fmt(m.pending, { n: pending })}</span>}
        </div>
        {secured.length === 0 ? (
          <p className="dim">{m.empty}</p>
        ) : (
          <div className="proofslist">
            {secured.map(({ f, s }) => (
              <div className="proofsrow" key={f.id}>
                <span className="proofdot" aria-hidden="true" />
                <div className="invmain">
                  <b title={f.name}>{f.name}</b>
                  <span className="dim">
                    {formatBytes(f.size)} · {fmt(m.copies, { n: s.copies })}
                    {s.since ? ` · ${fmt(m.since, { date: fmtDate(s.since) })}` : ''}
                  </span>
                </div>
                <button className="small" onClick={() => onOpen(f)}>
                  {m.open}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
