import type { PresignedPiece } from '@/lib/api-types'
import {
  ACCOUNT_PIECE_SIZE,
  encryptedPieceStream,
  frameAad,
  streamCipherPlan,
  toB64,
  unwrapFileKey,
  wrapFileKey,
  type Bytes
} from '@/lib/crypto'
import { decryptChunksTo, type PieceSource } from '@/lib/pieces'
import { folderFor, type ChunkMeta, type VaultEntry } from '@/lib/vault'
import { absoluteUrl, api } from '@/features/api/client'

export interface TransferProgress {
  done: number
  total: number
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Abgebrochen', 'AbortError'))
      },
      { once: true }
    )
  })
}

/** PUT mit Upload-Fortschritt (fetch kann keinen Upload-Fortschritt melden). */
function putBlob(req: PresignedPiece, body: Blob, signal: AbortSignal | undefined, onProgress: (loaded: number) => void) {
  if (typeof XMLHttpRequest === 'undefined') {
    // Node (Backup-Programm): fetch, Fortschritt pro Teil
    return fetch(absoluteUrl(req.url), { method: 'PUT', body, headers: req.headers, signal }).then(
      res => {
        if (!res.ok) throw new HttpStatusError(res.status)
        onProgress(body.size)
      },
      e => {
        if (signal?.aborted) throw new DOMException('Upload abgebrochen', 'AbortError')
        throw e instanceof HttpStatusError ? e : new HttpStatusError(0)
      }
    )
  }
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', req.url)
    for (const [k, v] of Object.entries(req.headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = e => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new HttpStatusError(xhr.status)))
    xhr.onerror = () => reject(new HttpStatusError(0))
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen', 'AbortError'))
    if (signal?.aborted) return reject(new DOMException('Upload abgebrochen', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

async function uploadPiece(
  objectId: string,
  index: number,
  urls: Map<number, PresignedPiece>,
  blob: Blob,
  signal: AbortSignal | undefined,
  onProgress: (loaded: number) => void
): Promise<void> {
  let refreshedAfter403 = false
  for (let attempt = 0; ; attempt++) {
    let req = urls.get(index)
    if (!req || req.expiresAt - Date.now() < 60_000) {
      req = (await api.refreshUrls(objectId, [index])).pieces[0]
      urls.set(index, req)
    }
    try {
      await putBlob(req, blob, signal, onProgress)
      return
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
      const status = e instanceof HttpStatusError ? e.status : 0
      if (status === 403 && !refreshedAfter403) {
        refreshedAfter403 = true
        urls.delete(index)
        continue
      }
      const retryable = status === 0 || status === 429 || status >= 500
      if (!retryable || attempt >= 4) {
        throw new Error(`Upload von Teil ${index + 1} fehlgeschlagen${status ? ` (HTTP ${status})` : ' (Netzwerk)'}.`)
      }
      onProgress(0)
      await sleep(1000 * 2 ** attempt, signal)
    }
  }
}

/**
 * Verschlüsselt und lädt eine Datei im Konto-Modus hoch (Format frame2):
 * 1. Objekt anlegen → Server prüft Quota und vergibt die Objekt-ID (geht in die AAD ein)
 * 2. je Piece (32 MiB): streamend verschlüsseln → Presigned PUT (Retry, Fortschritt)
 * 3. abschließen → Server prüft die Größen im Storage
 * Liefert den Index-Eintrag; der File-Key existiert nur gewrappt unter dem Master-Key.
 */
export async function uploadFile(
  file: File,
  masterKey: CryptoKey,
  opts: { signal?: AbortSignal; onProgress?: (p: TransferProgress) => void } = {}
): Promise<VaultEntry> {
  const count = Math.max(1, Math.ceil(file.size / ACCOUNT_PIECE_SIZE))
  const ranges = Array.from({ length: count }, (_, i) => {
    const start = i * ACCOUNT_PIECE_SIZE
    const end = Math.min(start + ACCOUNT_PIECE_SIZE, file.size)
    return { start, end, plan: streamCipherPlan(end - start) }
  })
  const total = ranges.reduce((n, r) => n + r.plan.paddedSize, 0)
  const created = await api.createObject({
    fmt: 'frame2',
    pieces: ranges.map((r, index) => ({ index, cipherBytes: r.plan.paddedSize }))
  })
  const objectId = created.objectId
  const urls = new Map(created.pieces.map(p => [p.index, p]))
  const rawKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
  try {
    const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
    const wrapped = await wrapFileKey(rawKey, masterKey)
    const chunks: ChunkMeta[] = []
    let done = 0
    opts.onProgress?.({ done, total })
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]
      const baseIv = crypto.getRandomValues(new Uint8Array(12))
      const stream = encryptedPieceStream(
        file,
        r.start,
        r.end,
        fileKey,
        baseIv,
        r.plan.paddedSize - r.plan.cipherSize,
        opts.signal,
        frameAad(objectId, i)
      )
      const blob = await new Response(stream).blob()
      if (blob.size !== r.plan.paddedSize) throw new Error('Interner Fehler: verschlüsseltes Teil hat die falsche Größe.')
      const base = done
      await uploadPiece(objectId, i, urls, blob, opts.signal, loaded => opts.onProgress?.({ done: base + loaded, total }))
      done += blob.size
      opts.onProgress?.({ done, total })
      chunks.push({ pieceCid: `${objectId}/${i}`, iv: toB64(baseIv), padLen: 0, size: r.plan.paddedSize, fmt: 'frame2' })
    }
    await api.completeObject(objectId)
    const type = file.type || 'application/octet-stream'
    return {
      id: objectId,
      objectId,
      name: file.name,
      size: file.size,
      type,
      folder: folderFor(file.type || ''),
      wrappedKey: wrapped.wrapped,
      wrapIv: wrapped.iv,
      chunks,
      pieceSize: ACCOUNT_PIECE_SIZE,
      storedAt: Date.now(),
      v: 2
    }
  } catch (e) {
    // Quota-Reservierung sofort freigeben, statt 24 h auf das Aufräumen zu warten.
    void api.deleteObject(objectId).catch(() => undefined)
    throw e
  } finally {
    rawKey.fill(0)
  }
}

/** Große Dateien (Chrome/Edge) streamend auf die Platte, sonst im Speicher sammeln. */
const STREAM_TO_DISK_FROM = 512 * 1024 * 1024

export async function pieceSource(entry: VaultEntry, signal?: AbortSignal): Promise<PieceSource> {
  const { pieces } = await api.download(entry.objectId!)
  const byIndex = new Map(pieces.map(p => [p.index, p]))
  return {
    openStream: async ref => {
      const index = Number(ref.split('/').pop())
      const piece = byIndex.get(index)
      if (!piece) throw new Error(`Teil ${index + 1} fehlt auf dem Server.`)
      const res = await fetch(absoluteUrl(piece.url), { signal, headers: piece.headers })
      if (!res.ok || !res.body) throw new Error(`Download von Teil ${index + 1} fehlgeschlagen (HTTP ${res.status}).`)
      return res.body
    },
    download: async () => {
      throw new Error('Legacy-Format wird im Konto-Modus nicht verwendet.')
    }
  }
}

/** Entschlüsselt eine Datei komplett in den Speicher (Vorschau, kleine Dateien). */
export async function decryptToBlob(
  entry: VaultEntry,
  masterKey: CryptoKey,
  opts: { signal?: AbortSignal; onProgress?: (p: TransferProgress) => void } = {}
): Promise<Blob> {
  if (!entry.objectId) throw new Error('Datei nicht verfügbar.')
  const fileKey = await unwrapFileKey({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, masterKey)
  const source = await pieceSource(entry, opts.signal)
  const parts: BlobPart[] = []
  let done = 0
  await decryptChunksTo(entry, fileKey, source, plain => {
    parts.push(plain)
    done += plain.byteLength
    opts.onProgress?.({ done, total: entry.size })
  })
  return new Blob(parts, { type: entry.type || 'application/octet-stream' })
}

export async function downloadFile(
  entry: VaultEntry,
  masterKey: CryptoKey,
  opts: { signal?: AbortSignal; onProgress?: (p: TransferProgress) => void } = {}
): Promise<void> {
  if (!entry.objectId) throw new Error('Diese Datei liegt im Wallet-Speicher und ist im Konto-Modus nicht abrufbar.')
  const fileKey = await unwrapFileKey({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, masterKey)
  const source = await pieceSource(entry, opts.signal)
  let done = 0
  const report = (n: number) => {
    done += n
    opts.onProgress?.({ done, total: entry.size })
  }
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> }).showSaveFilePicker
  if (entry.size >= STREAM_TO_DISK_FROM && typeof picker === 'function') {
    const handle = await picker({ suggestedName: entry.name })
    const writable = await handle.createWritable()
    try {
      await decryptChunksTo(entry, fileKey, source, async plain => {
        await writable.write(plain)
        report(plain.byteLength)
      })
      await writable.close()
    } catch (e) {
      await writable.abort().catch(() => undefined)
      throw e
    }
    return
  }
  const parts: BlobPart[] = []
  await decryptChunksTo(entry, fileKey, source, plain => {
    parts.push(plain)
    report(plain.byteLength)
  })
  const url = URL.createObjectURL(new Blob(parts, { type: entry.type || 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = entry.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
