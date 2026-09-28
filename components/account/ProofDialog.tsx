'use client'

import { Icon } from '@/components/site/Icons'
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

  const [cidCopied, setCidCopied] = useState(false)
  const since = cert ? packs.map(p => p.storedAt).sort().pop() : null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="proof-title" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sharemodal sm2 proofmodal">
        <div className="proofhero">
          <button className="linkish sm2-close proofclose" onClick={onClose} aria-label={m.close}>
            {m.close}
          </button>
          <span className="proofseal">
            <Icon name="proof" size={26} />
          </span>
          <span className="inviteeyebrow">{m.eyebrow}</span>
          <h3 id="proof-title">{m.title}</h3>
          <span className="prooffile">
            <Icon name="file" size={14} /> {entry.name} · {formatBytes(entry.size)}
          </span>
        </div>
        <div className="proofbody">
          {error && <div className="errorbox">{error}</div>}
          {!cert && !error && <div className="hint">{m.loading}</div>}
          {cert && (
            <>
              <div className="proofstats">
                <div>
                  <span className="dim">{m.copiesLabel}</span>
                  <b>{copies.length}</b>
                </div>
                <div>
                  <span className="dim">{m.network}</span>
                  <b>{cert.network === 'mainnet' ? m.mainnet : m.calibration}</b>
                </div>
                <div>
                  <span className="dim">{m.since}</span>
                  <b>{since ? fmtDate(since) : '—'}</b>
                </div>
                <div>
                  <span className="dim">{m.parts}</span>
                  <b>{cert.pieces.length}</b>
                </div>
              </div>
              <p className="prooflead">{fmt(m.lead, { copies: copies.length })}</p>
              <div className="proofcopies">
                {copies.map((c, i) => (
                  <div className="proofcopy" key={`${c.providerId}:${c.dataSetId}`}>
                    <span className="proofdot" aria-hidden="true" />
                    <div className="invmain">
                      <b>{fmt(m.copy, { n: i + 1 })}</b>
                      <span className="dim">
                        {fmt(m.provider, { id: c.providerId })} · {fmt(m.dataset, { id: c.dataSetId })}
                      </span>
                    </div>
                    <span className="strongbadge">{m.verified}</span>
                    <a className="button small" href={c.explorer} target="_blank" rel="noreferrer">
                      {m.openDataset} ↗
                    </a>
                  </div>
                ))}
              </div>
              {packs.map(p => (
                <div className="proofcid" key={p.pieceCid}>
                  <span className="dim">{m.piece}</span>
                  <div className="proofcid-row">
                    <code>{p.pieceCid}</code>
                    <button
                      className="small"
                      onClick={() =>
                        void navigator.clipboard?.writeText(p.pieceCid).then(() => {
                          setCidCopied(true)
                          setTimeout(() => setCidCopied(false), 1500)
                        })
                      }
                    >
                      {cidCopied ? '✓' : m.copyCid}
                    </button>
                    <a className="button small" href={p.explorer} target="_blank" rel="noreferrer" aria-label={m.openPiece}>
                      ↗
                    </a>
                  </div>
                </div>
              ))}
              <button className="primary full" style={{ marginTop: 16 }} onClick={download}>
                <Icon name="file" size={15} /> {m.download}
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                {m.certHint}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
