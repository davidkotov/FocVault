'use client'

import { useRef, useState, type DragEvent } from 'react'
import { formatBytes, type VaultEntry } from '@/lib/vault'
import { errorMessage } from '@/features/api/client'
import { uploadFile } from '@/features/objects/transfer'

interface Job {
  id: string
  name: string
  size: number
  pct: number
  state: 'wait' | 'run' | 'done' | 'error'
}

interface Props {
  masterKey: CryptoKey
  freeBytes: number
  onStored: (entry: VaultEntry) => void
  onError: (msg: string) => void
}

/** Drag & Drop, mehrere Dateien, nacheinander: verschlüsseln → hochladen → abschließen. */
export default function AccountUpload({ masterKey, freeBytes, onStored, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [drag, setDrag] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const busy = jobs.some(j => j.state === 'run' || j.state === 'wait')

  const patch = (id: string, p: Partial<Job>) => setJobs(js => js.map(j => (j.id === id ? { ...j, ...p } : j)))

  const start = async (files: File[]) => {
    if (!files.length || busy) return
    const queue = files.map(f => ({ id: crypto.randomUUID(), name: f.name, size: f.size, pct: 0, state: 'wait' as const }))
    setJobs(queue)
    const abort = new AbortController()
    abortRef.current = abort
    for (let i = 0; i < files.length; i++) {
      const job = queue[i]
      if (abort.signal.aborted) break
      patch(job.id, { state: 'run' })
      try {
        const entry = await uploadFile(files[i], masterKey, {
          signal: abort.signal,
          onProgress: p => patch(job.id, { pct: p.total ? Math.round((p.done / p.total) * 100) : 100 })
        })
        patch(job.id, { state: 'done', pct: 100 })
        onStored(entry)
      } catch (e) {
        patch(job.id, { state: 'error' })
        onError(`${files[i].name}: ${errorMessage(e, 'Upload fehlgeschlagen.')}`)
      }
    }
    abortRef.current = null
    setTimeout(() => setJobs(js => (js.every(j => j.state === 'done' || j.state === 'error') ? [] : js)), 2500)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDrag(false)
    void start(Array.from(e.dataTransfer.files ?? []))
  }

  return (
    <div className="card">
      <h3>
        Dateien speichern
        <span className="dim">{formatBytes(freeBytes)} frei</span>
      </h3>
      <div
        className={`dropzone ${busy ? 'disabled' : ''} ${drag ? 'drag' : ''}`}
        onClick={() => {
          if (!busy) inputRef.current?.click()
        }}
        onDragOver={e => {
          e.preventDefault()
          if (!busy) setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <div className="big">⬆</div>
        <div>
          <strong>Dateien hierher ziehen</strong> oder klicken
        </div>
        <div style={{ marginTop: 6, fontSize: 13 }}>
          Verschlüsselung im Browser · AES-256-GCM · gespeichert auf Filecoin (Fil One, EU)
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          data-testid="upload-input"
          onChange={e => {
            void start(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {jobs.length > 0 && (
        <div className="uploadlist">
          {jobs.map(j => (
            <div className="uploadrow" key={j.id}>
              <span className="name" title={j.name}>
                {j.state === 'done' ? '✓ ' : j.state === 'error' ? '✕ ' : ''}
                {j.name} <span className="dim">· {formatBytes(j.size)}</span>
              </span>
              <div className="dlbar-track">
                <div className="dlbar-fill" style={{ width: `${j.pct}%` }} />
              </div>
              <span className="dim">{j.pct}%</span>
            </div>
          ))}
          {busy && (
            <div className="row">
              <button className="small" onClick={() => abortRef.current?.abort()}>
                ⏹ Abbrechen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
