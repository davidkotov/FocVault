'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface Props {
  onDetected: (data: string) => void
  onClose: () => void
}

export default function QrScanModal({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
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
        .catch(() => setCameraError('Kamera nicht verfügbar – nutze alternativ „Bild scannen".'))
    } else {
      setCameraError('Kamera wird von diesem Browser nicht unterstützt – nutze „Bild scannen".')
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
      setCameraError('Das Bild konnte nicht gelesen werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="qrmodal" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <h4>QR-Code scannen</h4>
          <button className="iconbtn" title="Schließen" onClick={onClose}>
            <svg className="icon" width="16" height="16" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="dim" style={{ margin: '8px 0 12px' }}>
          Halte den otpauth://-QR-Code deines 2FA-Setups in die Kamera.
        </p>
        <div className="qrvideo">
          <video ref={videoRef} playsInline muted />
          {cameraError && <div className="qrerr">{cameraError}</div>}
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="small" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Lese Bild…' : 'Bild scannen'}
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