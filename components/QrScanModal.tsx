'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { useMessages } from '@/features/i18n/I18nProvider'
import { secretsMessages } from '@/lib/i18n/messages/secrets'

interface Props {
  onDetected: (data: string) => void
  onClose: () => void
}

export default function QrScanModal({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { common: c, qr: m } = useMessages(secretsMessages)
  // Fehler als Schlüssel speichern, damit ein Sprachwechsel den Text mitzieht
  const [cameraError, setCameraError] = useState<'cameraUnavailable' | 'cameraUnsupported' | 'imageUnreadable' | null>(null)
  const [busy, setBusy] = useState(false)

  const decodeImageData = useCallback(
    (data: Uint8ClampedArray, width: number, height: number) => {
      const code = jsQR(data, width, height)
      if (code?.data) onDetected(code.data)
      return code?.data
    },
    [onDetected]
  )

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let alive = true

    const loop = () => {
      const video = videoRef.current
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0)
          const found = decodeImageData(
            ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height
          )
          if (found) return
        }
      }
      if (alive) raf = requestAnimationFrame(loop)
    }

    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        })
        .then(s => {
          if (!alive) {
            s.getTracks().forEach(t => t.stop())
            return
          }
          stream = s
          const v = videoRef.current
          if (v) {
            v.srcObject = s
            void v.play()
            raf = requestAnimationFrame(loop)
          }
        })
        .catch(() => setCameraError('cameraUnavailable'))
    } else {
      setCameraError('cameraUnsupported')
    }

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [decodeImageData])

  const handleFile = async (file: File) => {
    setBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(bitmap, 0, 0)
      decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    } catch {
      setCameraError('imageUnreadable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="qrmodal" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <h4>{m.title}</h4>
          <button className="iconbtn" title={c.close} onClick={onClose}>
            <svg className="icon" width="16" height="16" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="dim" style={{ margin: '8px 0 12px' }}>{m.lead}</p>
        <div className="qrvideo">
          <video ref={videoRef} playsInline muted />
          {cameraError && <div className="qrerr">{m[cameraError]}</div>}
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="small" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? m.readingImage : m.scanImage}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}