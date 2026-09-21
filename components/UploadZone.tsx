'use client'

import { useRef, useState, type DragEvent, type RefObject } from 'react'
import { formatUnits } from 'viem'
import type { WalletClient } from 'viem'
import { USDFC_DECIMALS } from '@/lib/chains'
import { encryptFileChunked, wrapFileKey, type ChunkCipher } from '@/lib/crypto'
import { formatBytes, folderFor, type VaultEntry } from '@/lib/vault'
import {
  getSynapse,
  prepareStorage,
  uploadPiecesBatched,
  type PrepareResult
} from '@/lib/synapse'

type Phase = 'idle' | 'encrypting' | 'estimating' | 'confirm' | 'tx' | 'storing' | 'committing' | 'done'

interface Props {
  walletClient: WalletClient | undefined
  masterKey: CryptoKey | null
  quotaRemaining: number
  onStored: (entry: VaultEntry) => void
  onError: (msg: string) => void
}

interface PendingFile {
  file: File
  chunks: ChunkCipher[]
  wrappedKey: string
  wrapIv: string
  prep: PrepareResult
}

function fmt(amount: bigint): string {
  return formatUnits(amount, USDFC_DECIMALS)
}

const STEPS: Array<{ label: string; phase: Phase[] }> = [
  { label: 'Client-side AES-256-GCM Verschlüsselung', phase: ['encrypting'] },
  { label: 'On-Chain Kosten via prepare()', phase: ['estimating'] },
  { label: 'USDFC Deposit + Approval (Wallet-Tx)', phase: ['tx'] },
  { label: 'Chunks zum Primary-Provider', phase: ['storing'] },
  { label: 'On-Chain Commit – 2 Kopien via Pull', phase: ['committing'] },
  { label: 'Fertig – pieceCids im Vault registriert', phase: ['done'] }
]

export default function UploadZone({ walletClient, masterKey, quotaRemaining, onStored, onError }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [drag, setDrag] = useState(false)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [copiesNote, setCopiesNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement>

  const locked = !masterKey || !walletClient

  const reset = () => {
    setPhase('idle')
    setPending(null)
    setTxHash(null)
    setFileLabel(null)
    setProgress(null)
    setCopiesNote(null)
  }

  const handleFile = async (file: File) => {
    if (locked || !walletClient || !masterKey) return
    if (file.size > quotaRemaining) {
      onError(`Datei zu groß für dein Tier-Quota (${formatBytes(file.size)} > ${formatBytes(quotaRemaining)} frei).`)
      return
    }
    setFileLabel(`${file.name} (${formatBytes(file.size)})`)
    setCopiesNote(null)
    try {
      setPhase('encrypting')
      setProgress('0/1')
      const enc = await encryptFileChunked(file, (done, total) => setProgress(`${done}/${total}`))
      const wrapped = await wrapFileKey(enc.rawKey, masterKey)

      setPhase('estimating')
      setProgress(null)
      const synapse = await getSynapse(walletClient)
      const prep = await prepareStorage(
        synapse,
        enc.chunks.map(c => c.cipher.byteLength)
      )

      setPending({
        file,
        chunks: enc.chunks,
        wrappedKey: wrapped.wrapped,
        wrapIv: wrapped.iv,
        prep
      })
      setPhase('confirm')
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Verschlüsselung oder Kostenschätzung fehlgeschlagen')
      reset()
    }
  }

  const confirmAndUpload = async () => {
    if (!pending || !walletClient) return
    try {
      const { prep } = pending
      let hash: string | undefined
      if (prep.transaction) {
        setPhase('tx')
        const res = await prep.transaction.execute()
        hash = res.hash
        setTxHash(hash ?? null)
      }
      const synapse = await getSynapse(walletClient)

      setPhase('storing')
      setProgress(`0/${pending.chunks.length}`)
      const result = await uploadPiecesBatched(
        synapse,
        pending.chunks.map(c => c.cipher),
        (done, total) => setProgress(`${done}/${total}`)
      )

      setPhase('committing')
      setProgress(null)

      if (result.pieceCids.length !== pending.chunks.length) {
        throw new Error('Nicht alle Chunks committed')
      }

      onStored({
        id: crypto.randomUUID(),
        name: pending.file.name,
        size: pending.file.size,
        type: pending.file.type || 'application/octet-stream',
        folder: folderFor(pending.file.type || ''),
        wrappedKey: pending.wrappedKey,
        wrapIv: pending.wrapIv,
        chunks: pending.chunks.map((c, i) => ({
          pieceCid: result.pieceCids[i],
          iv: c.iv,
          padLen: c.padLen,
          size: c.cipher.byteLength
        })),
        storedAt: Date.now(),
        txHash: hash ?? result.primaryTxHash,
        v: 2
      })
      if (!result.secondaryComplete) {
        setCopiesNote('Nur 1 Kopie committed – zweite Kopie fehlgeschlagen (Daten sind trotzdem sicher gespeichert).')
      }
      setPhase('done')
      setTimeout(reset, 2200)
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Upload fehlgeschlagen')
      reset()
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const activeIndex = STEPS.findIndex(s => s.phase.includes(phase))
  const visibleSteps = phase === 'done' ? STEPS : STEPS.slice(0, Math.max(activeIndex, 0) + 1)

  return (
    <div className="card">
      <h3>
        Datei speichern
        <span className="dim">{formatBytes(quotaRemaining)} frei</span>
      </h3>

      {phase === 'idle' && (
        <div
          className={`dropzone ${locked ? 'disabled' : ''} ${drag ? 'drag' : ''}`}
          onClick={() => { if (!locked) inputRef.current?.click() }}
          onDragOver={e => { e.preventDefault(); if (!locked) setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <div className="big">⬆</div>
          <div><strong>Datei hierher ziehen</strong> oder klicken</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {locked ? 'Zuerst Vault entschlüsseln' : 'End-to-End verschlüsselt · automatisch in 256-MiB-Chunks'}
          </div>
          <input
            ref={inputRef}
            type="file"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {phase !== 'idle' && (
        <div>
          <div className="dim">
            {fileLabel}
            {progress && phase !== 'confirm' ? ` · ${progress}` : ''}
          </div>
          <ul className="steps">
            {visibleSteps.map((s, i) => (
              <li
                key={s.label}
                className={i < activeIndex || phase === 'done' ? 'done' : i === activeIndex ? 'active' : ''}
              >
                <span>{i < activeIndex || phase === 'done' ? '✓' : i === activeIndex ? '›' : '·'}</span>
                {s.label}
              </li>
            ))}
          </ul>

          {phase === 'confirm' && pending && (
            <div className="costbox">
              <div className="stat">
                <span className="k">{pending.chunks.length} Chunk{pending.chunks.length > 1 ? 's' : ''}</span>
                <span className="v">{pending.chunks.map(c => formatBytes(c.cipher.byteLength)).join(' + ')}</span>
              </div>
              <div className="stat">
                <span className="k">Einzahlung (Deposit + Approval)</span>
                <span className="v amount">{fmt(pending.prep.costs.depositNeeded)} USDFC</span>
              </div>
              <div className="stat">
                <span className="k">Laufende Rate</span>
                <span className="v">{fmt(pending.prep.costs.rates.perMonth)} USDFC / Monat</span>
              </div>
              <div className="stat">
                <span className="k">Zahlungsbereit</span>
                <span className="v">{pending.prep.costs.ready ? 'ja – keine Tx nötig' : 'eine Wallet-Tx erforderlich'}</span>
              </div>
              <p className="dim" style={{ marginTop: 12 }}>
                Kein Kaufpreis: die Einzahlung ist <strong>dein Guthaben</strong>. Nur die laufende
                Rate (≈{(Number(fmt(pending.prep.costs.rates.perMonth)) / 30).toFixed(4)} USDFC/Tag) wird
                verbraucht, solange du speicherst – der Rest bleibt über das Konto-Panel abhebbar.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="primary" onClick={confirmAndUpload}>
                  {pending.prep.costs.ready ? 'Kostenlos speichern' : 'Zahlen & speichern'}
                </button>
                <button onClick={reset}>Abbrechen</button>
              </div>
            </div>
          )}

          {txHash && phase !== 'confirm' && <div className="txline">TX: {txHash}</div>}

          {phase === 'done' && (
            <div className="costbox" style={{ borderColor: 'rgba(53, 201, 138, 0.4)' }}>
              ✓ Gespeichert – {pending?.chunks.length ?? 1} Chunk(s) committed.
              {copiesNote ? ` ${copiesNote}` : ' Beide Kopien aktiv.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
