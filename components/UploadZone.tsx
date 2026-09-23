'use client'

import { useRef, useState, type DragEvent, type RefObject } from 'react'
import { formatUnits } from 'viem'
import type { WalletClient } from 'viem'
import { USDFC_DECIMALS } from '@/lib/chains'
import {
  CHUNK_SIZE,
  encryptedPieceStream,
  streamCipherPlan,
  toB64,
  wrapFileKey,
  type StreamPlan
} from '@/lib/crypto'
import { formatBytes, folderFor, type VaultEntry } from '@/lib/vault'
import { getSynapse, getVaultContexts, prepareStorage, uploadPiecesStreamed, type PrepareResult } from '@/lib/synapse'

type Phase = 'idle' | 'estimating' | 'confirm' | 'tx' | 'storing' | 'committing' | 'done'

interface Props {
  walletClient: WalletClient | undefined
  masterKey: CryptoKey | null
  quotaRemaining: number
  onStored: (entry: VaultEntry) => void
  onError: (msg: string) => void
}

interface ChunkRange {
  start: number
  end: number
  clearSize: number
  plan: StreamPlan
}

interface PendingUpload {
  file: File
  fileKey: CryptoKey
  wrappedKey: string
  wrapIv: string
  ranges: ChunkRange[]
  prep: PrepareResult
  totalPadded: number
  contexts: any[]
}

function fmt(amount: bigint): string {
  return formatUnits(amount, USDFC_DECIMALS)
}

const STEPS: Array<{ label: string; phase: Phase[] }> = [
  { label: 'On-Chain Kosten via prepare()', phase: ['estimating'] },
  { label: 'USDFC Deposit + Approval (Wallet-Tx)', phase: ['tx'] },
  { label: 'Live-Verschlüsselung + Upload (Streaming, 16-MiB-Frames)', phase: ['storing'] },
  { label: 'On-Chain Commit – 2 Kopien via Pull', phase: ['committing'] },
  { label: 'Fertig – pieceCids im Vault registriert', phase: ['done'] }
]

export default function UploadZone({ walletClient, masterKey, quotaRemaining, onStored, onError }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [drag, setDrag] = useState(false)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState<number | null>(null)
  const [copiesNote, setCopiesNote] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement>

  const locked = !masterKey || !walletClient

  const reset = (keepFile = false) => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setPending(null)
    setTxHash(null)
    if (!keepFile) setFileLabel(null)
    setProgressPct(null)
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
      const rawKey = crypto.getRandomValues(new Uint8Array(32))
      const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
      const wrapped = await wrapFileKey(rawKey, masterKey)

      const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
      const ranges: ChunkRange[] = []
      let totalPadded = 0
      for (let i = 0; i < total; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const clearSize = end - start
        const plan = streamCipherPlan(clearSize)
        ranges.push({ start, end, clearSize, plan })
        totalPadded += plan.paddedSize
      }

      setPhase('estimating')
      setProgressPct(null)
      const synapse = await getSynapse(walletClient)
      const address = walletClient.account?.address
      const contexts = await getVaultContexts(synapse, address ?? '')
      const prep = await prepareStorage(
        synapse,
        ranges.map(r => r.plan.paddedSize),
        contexts
      )

      setPending({
        file,
        fileKey,
        wrappedKey: wrapped.wrapped,
        wrapIv: wrapped.iv,
        ranges,
        prep,
        totalPadded,
        contexts
      })
      setPhase('confirm')
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Kostenschätzung fehlgeschlagen')
      reset(true)
    }
  }

  const confirmAndUpload = async () => {
    if (!pending || !walletClient) return
    try {
      const { prep, file, fileKey, ranges, contexts } = pending
      let hash: string | undefined
      if (prep.transaction) {
        setPhase('tx')
        const res = await prep.transaction.execute()
        hash = res.hash
        setTxHash(hash ?? null)
      }
      const synapse = await getSynapse(walletClient)

      const abort = new AbortController()
      abortRef.current = abort
      setPhase('storing')
      setProgressPct(0)

      // baseIv pro Chunk beim Start erzeugen (im Streaming-Format im iv-Feld gespeichert)
      const baseIvs: Uint8Array[] = []
      const pieceStreams = ranges.map(r => {
        const baseIv = crypto.getRandomValues(new Uint8Array(12))
        baseIvs.push(baseIv)
        return encryptedPieceStream(
          file,
          r.start,
          r.end,
          fileKey,
          baseIv,
          r.plan.paddedSize - r.plan.cipherSize,
          abort.signal
        )
      })

      const uploadedPerPiece: number[] = ranges.map(() => 0)
      let lastPct = -1

      const result = await uploadPiecesStreamed(
        synapse,
        pieceStreams.map(s => ({ data: s })),
        {
        signal: abort.signal,
        onStored: (done, total) => {
          if (abort.signal.aborted) return
          const base = uploadedPerPiece.reduce((s, n) => s + n, 0)
          const pct = Math.round((base / pending.totalPadded) * 100)
          if (pct !== lastPct) {
            lastPct = pct
            setProgressPct(pct)
          }
        },
        onPieceProgress: (i, bytes) => {
          if (abort.signal.aborted) return
          uploadedPerPiece[i] = bytes
          const total = uploadedPerPiece.reduce((s, n) => s + n, 0)
          const pct = Math.min(100, Math.round((total / pending.totalPadded) * 100))
          if (pct !== lastPct) {
            lastPct = pct
            setProgressPct(pct)
          }
        }
      }, contexts)

      abortRef.current = null
      setPhase('committing')
      setProgressPct(null)

      if (result.pieceCids.length !== ranges.length) {
        throw new Error('Nicht alle Chunks committed')
      }

      onStored({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        folder: folderFor(file.type || ''),
        wrappedKey: pending.wrappedKey,
        wrapIv: pending.wrapIv,
        chunks: ranges.map((r, i) => ({
          pieceCid: result.pieceCids[i],
          iv: toB64(baseIvs[i] as Uint8Array<ArrayBuffer>),
          padLen: 0,
          size: r.plan.paddedSize,
          fmt: 'frame' as const
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
      if (abortRef.current?.signal.aborted) {
        onError('Upload abgebrochen – bereits einbezahlte Mittel bleiben als Guthaben auf dem Konto stehen.')
      } else {
        onError(e?.shortMessage ?? e?.message ?? 'Upload fehlgeschlagen')
      }
      reset(true)
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
            {locked ? 'Zuerst Vault entschlüsseln' : 'Streaming-Verschlüsselung · 16-MiB-Frames · kein RAM-Wachstum'}
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
          <div className="dim" style={{ lineHeight: 1.5 }}>
            {fileLabel}
            {progressPct !== null ? ` · ${progressPct}%` : ''}
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
                <span className="k">{pending.ranges.length} 256-MiB-Chunk{pending.ranges.length > 1 ? 's' : ''} (Streaming)</span>
                <span className="v">~{formatBytes(pending.totalPadded)} verschlüsselt</span>
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
                Kein Kaufpreis: die Einzahlung ist <strong>dein Guthaben</strong>. Verschlüsselung passiert{' '}
                <strong>live beim Upload</strong> (16-MiB-Frames, AES-GCM) – der Browser speichert zu keiner
                Zeit die ganze Datei im RAM.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="primary" onClick={confirmAndUpload}>
                  {pending.prep.costs.ready ? 'Kostenlos speichern' : 'Zahlen & speichern'}
                </button>
                <button onClick={() => reset()}>Abbrechen</button>
              </div>
            </div>
          )}

          {(phase === 'storing' || phase === 'committing') && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                onClick={() => {
                  abortRef.current?.abort()
                  reset(true)
                }}
              >
                ⏹ Upload abbrechen
              </button>
            </div>
          )}

          {txHash && phase !== 'confirm' && <div className="txline">TX: {txHash}</div>}

          {phase === 'done' && (
            <div className="costbox" style={{ borderColor: 'rgba(53, 201, 138, 0.4)' }}>
              ✓ Gespeichert – {pending?.ranges.length ?? 1} Chunk(s) committed.
              {copiesNote ? ` ${copiesNote}` : ' Beide Kopien aktiv.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}