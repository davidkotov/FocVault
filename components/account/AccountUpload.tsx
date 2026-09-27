'use client'

import { useRef, useState, type DragEvent } from 'react'
import { formatBytes, type VaultEntry } from '@/lib/vault'
import { uploadFile } from '@/features/objects/transfer'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'

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
  /** Hochladen in den Familienordner (Datei-Schlüssel mit dem Ordner-Schlüssel verpackt) */
  space?: boolean
  onStored: (entry: VaultEntry) => void
  onError: (msg: string) => void
}

/** Drag & Drop, mehrere Dateien, nacheinander: verschlüsseln → hochladen → abschließen. */
export default function AccountUpload({ masterKey, freeBytes, onStored, onError, space }: Props) {
  const m = useMessages(appMessages).upload
  const errText = useErrorText()
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
          space,
          signal: abort.signal,
          onProgress: p => patch(job.id, { pct: p.total ? Math.round((p.done / p.total) * 100) : 100 })
        })
        patch(job.id, { state: 'done', pct: 100 })
        onStored(entry)
      } catch (e) {
        patch(job.id, { state: 'error' })
        onError(`${files[i].name}: ${errText(e) || m.failed}`)
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
    <div className="card uploadcard">
      <h3>
        {m.title}
        <span className="dim">{fmt(m.free, { size: formatBytes(freeBytes) })}</span>
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
        <div className="big">
          <svg className="icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
          </svg>
        </div>
        <div className="droptext">
          <div>
            <strong>{m.drop}</strong> {m.orClick}
          </div>
          <div className="dropinfo">{m.info}</div>
        </div>
        <span className="dropfree">{fmt(m.free, { size: formatBytes(freeBytes) })}</span>
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
                ⏹ {m.abort}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
