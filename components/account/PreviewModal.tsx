'use client'

import { useEffect, useState } from 'react'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { decryptToBlob } from '@/features/objects/transfer'
import { appMessages } from '@/lib/i18n/messages/app'
import { PREVIEW_MAX, previewInfo } from '@/lib/preview'
import { formatBytes, type VaultEntry } from '@/lib/vault'

/**
 * Vorschau im Browser: Die Datei wird lokal entschlüsselt und als Blob-URL angezeigt –
 * nichts verlässt das Gerät. Pfeiltasten blättern, Escape schließt.
 */
export default function PreviewModal({
  entry,
  masterKey,
  onClose,
  onDownload,
  onPrev,
  onNext
}: {
  entry: VaultEntry
  masterKey: CryptoKey
  onClose: () => void
  onDownload: (e: VaultEntry) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const m = useMessages(appMessages).preview
  const errText = useErrorText()
  const info = previewInfo(entry.name, entry.type)
  const tooLarge = !!info && entry.size > PREVIEW_MAX[info.kind]
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setUrl(null)
    setText(null)
    setError(null)
    setPct(0)
    setBroken(false)
    if (!info || tooLarge) return
    const abort = new AbortController()
    let objectUrl: string | null = null
    decryptToBlob(entry, masterKey, {
      signal: abort.signal,
      onProgress: p => setPct(p.total ? Math.round((p.done / p.total) * 100) : 100)
    })
      .then(async blob => {
        if (abort.signal.aborted) return
        if (info.kind === 'text') return setText(await blob.text())
        objectUrl = URL.createObjectURL(new Blob([blob], { type: info.mime }))
        setUrl(objectUrl)
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(errText(e))
      })
    return () => {
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, masterKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const loading = !!info && !tooLarge && !url && text === null && !error

  return (
    <div className="modal-backdrop previewbackdrop" role="dialog" aria-modal="true" aria-label={entry.name} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="previewmodal">
        <div className="previewhead">
          <div className="previewtitle">
            <strong title={entry.name}>{entry.name}</strong>
            <span className="hint">
              {formatBytes(entry.size)} · {m.local}
            </span>
          </div>
          <div className="row">
            {onPrev && (
              <button className="small" aria-label={m.prev} onClick={onPrev}>
                ←
              </button>
            )}
            {onNext && (
              <button className="small" aria-label={m.next} onClick={onNext}>
                →
              </button>
            )}
            <button className="small" onClick={() => onDownload(entry)}>
              {m.download}
            </button>
            <button className="small" onClick={onClose}>
              {m.close}
            </button>
          </div>
        </div>
        <div className="previewbody">
          {loading && (
            <div className="previewstate">
              <div className="spinner" />
              {fmt(m.loading, { pct })}
            </div>
          )}
          {error && <div className="errorbox">{error}</div>}
          {!info && <div className="previewstate">{m.unsupported}</div>}
          {tooLarge && <div className="previewstate">{m.tooLarge}</div>}
          {url && info?.kind === 'image' && !broken && <img src={url} alt={entry.name} onError={() => setBroken(true)} />}
          {broken && <div className="previewstate">{m.unsupported}</div>}
          {url && info?.kind === 'pdf' && <iframe src={url} title={entry.name} />}
          {url && info?.kind === 'video' && <video src={url} controls autoPlay playsInline />}
          {url && info?.kind === 'audio' && <audio src={url} controls autoPlay />}
          {text !== null && <pre className="previewtext">{text}</pre>}
        </div>
      </div>
    </div>
  )
}
