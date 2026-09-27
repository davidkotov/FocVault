'use client'

import { useEffect, useState } from 'react'
import { api, type ProofCertificate } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type VaultEntry } from '@/lib/vault'

/** Nachweis einer Datei: Kopien, Anbieter, Datensätze mit Link zum öffentlichen PDP-Explorer. */
export default function ProofDialog({ entry, onClose }: { entry: VaultEntry; onClose: () => void }) {
  const m = useMessages(appMessages).proof
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const [cert, setCert] = useState<ProofCertificate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry.objectId) return
    api.proof(entry.objectId).then(setCert).catch(e => setError(errText(e)))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [entry.objectId, errText, onClose])

  // Kopien über alle Teile zusammenfassen (alle Teile liegen in denselben Datensätzen)
  const copies = cert
    ? [...new Map(cert.pieces.flatMap(p => p.copies).map(c => [`${c.providerId}:${c.dataSetId}`, c])).values()]
    : []
  const packs = cert ? [...new Map(cert.pieces.map(p => [p.pack.pieceCid, p.pack])).values()] : []

  const download = () => {
    if (!cert) return
    const blob = new Blob([JSON.stringify({ ...cert, fileName: entry.name, size: entry.size }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `FocVault-Nachweis-${entry.name.replace(/[^\w.-]+/g, '_')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="proof-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal">
        <div className="sharehead">
          <h3 id="proof-title">⛓ {m.title}</h3>
          <button className="small" onClick={onClose}>
            {m.close}
          </button>
        </div>
        <div className="hint" style={{ margin: '6px 0 10px' }}>
          {entry.name} · {formatBytes(entry.size)}
        </div>
        {error && <div className="errorbox">{error}</div>}
        {!cert && !error && <div className="hint">{m.loading}</div>}
        {cert && (
          <>
            <p className="lead">{fmt(m.lead, { copies: copies.length })}</p>
            <div className="stat">
              <span className="k">{m.network}</span>
              <span className="v">{cert.network === 'mainnet' ? m.mainnet : m.calibration}</span>
            </div>
            <div className="stat">
              <span className="k">{m.since}</span>
              <span className="v">{fmtDate(packs.map(p => p.storedAt).sort().pop()!)}</span>
            </div>
            <div className="stat">
              <span className="k">{m.parts}</span>
              <span className="v">{cert.pieces.length}</span>
            </div>
            <div className="trashlist">
              {copies.map((c, i) => (
                <div className="trashrow" key={`${c.providerId}:${c.dataSetId}`}>
                  <div className="trashinfo">
                    <strong>{fmt(m.copy, { n: i + 1 })}</strong>
                    <span className="hint">
                      {fmt(m.provider, { id: c.providerId })} · {fmt(m.dataset, { id: c.dataSetId })}
                    </span>
                  </div>
                  <a className="small linkbtn" href={c.explorer} target="_blank" rel="noreferrer">
                    {m.openDataset} ↗
                  </a>
                </div>
              ))}
              {packs.map(p => (
                <div className="trashrow" key={p.pieceCid}>
                  <div className="trashinfo">
                    <strong>{m.piece}</strong>
                    <span className="hint mono" style={{ overflowWrap: 'anywhere' }}>
                      {p.pieceCid}
                    </span>
                  </div>
                  <a className="small linkbtn" href={p.explorer} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                </div>
              ))}
            </div>
            <button className="primary full" style={{ marginTop: 14 }} onClick={download}>
              {m.download}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
