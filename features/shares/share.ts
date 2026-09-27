'use client'

import { absoluteUrl, api } from '@/features/api/client'
import {
  decodeShareFragment,
  decryptShareContainer,
  deriveSharePasswordKey,
  encodeShareFragment,
  encryptShareContainer,
  fromB64,
  importFileKey,
  randomLinkKey,
  toB64,
  unwrapFileKeyRaw,
  unwrapLinkKeyWithPassword,
  wrapLinkKeyWithPassword,
  type Bytes
} from '@/lib/crypto'
import { decryptChunksTo, type PieceSource } from '@/lib/pieces'
import type { ChunkMeta, VaultEntry } from '@/lib/vault'
import type { PresignedPiece } from '@/lib/api-types'

/**
 * Secure Send (Konto-Modus). Der Link verweist auf gespeicherte, verschlüsselte Dateien – eine oder
 * mehrere. Der Server kennt nur die Link-ID und verschlüsselte Metadaten; Namen, Typen und
 * Datei-Schlüssel stehen darin, verschlüsselt mit dem Link-Schlüssel aus dem URL-Fragment (#…).
 */
export interface SharedFile {
  objectId: string
  name: string
  type: string
  size: number
  pieceSize?: number
  chunks: ChunkMeta[]
  fileKey: string
}

interface ShareMetaV3 {
  v: 3
  name: string
  type: string
  size: number
  pieceSize?: number
  chunks: ChunkMeta[]
  fileKey: string
}
interface ShareMetaV4 {
  v: 4
  files: SharedFile[]
}

export interface ShareLinkOptions {
  expiresInHours: number | null
  maxDownloads: number | null
  password?: string
}

/** Link für eine oder mehrere Dateien. `keyFor` liefert den Schlüssel, mit dem der Datei-Schlüssel verpackt ist. */
export async function createShareLink(
  entries: VaultEntry | VaultEntry[],
  keyFor: CryptoKey | ((e: VaultEntry) => CryptoKey),
  opts: ShareLinkOptions
): Promise<{ url: string; id: string }> {
  const list = Array.isArray(entries) ? entries : [entries]
  if (!list.length || list.some(e => !e.objectId)) throw new Error('Diese Datei kann nicht geteilt werden.')
  const linkKey = randomLinkKey()
  const raws: Bytes[] = []
  try {
    const files: SharedFile[] = []
    for (const e of list) {
      const k = typeof keyFor === 'function' ? keyFor(e) : keyFor
      const raw = await unwrapFileKeyRaw({ wrapped: e.wrappedKey, iv: e.wrapIv }, k)
      raws.push(raw)
      files.push({ objectId: e.objectId!, name: e.name, type: e.type, size: e.size, pieceSize: e.pieceSize, chunks: e.chunks, fileKey: toB64(raw) })
    }
    const meta: ShareMetaV4 = { v: 4, files }
    const container = await encryptShareContainer(JSON.stringify(meta), linkKey)
    const share = await api.createShare({
      objectIds: files.map(f => f.objectId),
      meta: toB64(container),
      expiresInHours: opts.expiresInHours,
      maxDownloads: opts.maxDownloads
    })
    let fragment: string
    if (opts.password) {
      const salt = crypto.getRandomValues(new Uint8Array(16)) as Bytes
      const { iv, cipher } = await wrapLinkKeyWithPassword(await deriveSharePasswordKey(opts.password, salt), linkKey)
      fragment = encodeShareFragment({ kind: 'password', salt, iv, cipher })
    } else {
      fragment = encodeShareFragment({ kind: 'key', linkKey })
    }
    return { id: share.id, url: `${window.location.origin}/s/${share.id}#${fragment}` }
  } finally {
    raws.forEach(r => r.fill(0))
    linkKey.fill(0)
  }
}

export function fragmentNeedsPassword(fragment: string): boolean {
  try {
    return decodeShareFragment(fragment).kind === 'password'
  } catch {
    return false
  }
}

export class SharePasswordError extends Error {}

export interface OpenedShare {
  id: string
  files: SharedFile[]
  expiresAt: string | null
  remaining: number | null
}

export async function openShareLink(id: string, fragment: string, password?: string): Promise<OpenedShare> {
  const frag = decodeShareFragment(fragment)
  let linkKey: Bytes
  if (frag.kind === 'password') {
    if (!password) throw new SharePasswordError('Passwort nötig')
    try {
      linkKey = await unwrapLinkKeyWithPassword(await deriveSharePasswordKey(password, frag.salt), frag.iv, frag.cipher)
    } catch {
      throw new SharePasswordError('Falsches Passwort')
    }
  } else {
    linkKey = frag.linkKey
  }
  const pub = await api.publicShare(id)
  const meta = JSON.parse(await decryptShareContainer(fromB64(pub.meta), linkKey)) as ShareMetaV3 | ShareMetaV4
  const files: SharedFile[] =
    meta.v === 4
      ? meta.files
      : meta.v === 3
        ? [{ objectId: pub.objectId, name: meta.name, type: meta.type, size: meta.size, pieceSize: meta.pieceSize, chunks: meta.chunks, fileKey: meta.fileKey }]
        : (() => {
            throw new Error('Unbekanntes Link-Format')
          })()
  return { id, files, expiresAt: pub.expiresAt, remaining: pub.remaining }
}

/** Download-Vorgang starten (zählt einmal) → Abruf-URLs je Datei. */
export async function startSharedDownload(share: OpenedShare): Promise<Map<string, PresignedPiece[]>> {
  const r = await api.shareDownload(share.id)
  const items = r.items ?? [{ objectId: share.files[0].objectId, pieces: r.pieces }]
  return new Map(items.map(i => [i.objectId, i.pieces]))
}

export async function downloadSharedFile(file: SharedFile, pieces: PresignedPiece[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const fileKey = await importFileKey(fromB64(file.fileKey))
  const byIndex = new Map(pieces.map(p => [p.index, p]))
  const source: PieceSource = {
    openStream: async ref => {
      const index = Number(ref.split('/').pop())
      const piece = byIndex.get(index)
      if (!piece) throw new Error(`Teil ${index + 1} fehlt.`)
      const res = await fetch(absoluteUrl(piece.url), { headers: piece.headers })
      if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`)
      return res.body
    },
    download: async () => {
      throw new Error('Nicht unterstützt.')
    }
  }
  const parts: BlobPart[] = []
  let done = 0
  await decryptChunksTo({ ...file }, fileKey, source, plain => {
    parts.push(plain)
    done += plain.byteLength
    onProgress?.(done, file.size)
  })
  const url = URL.createObjectURL(new Blob(parts, { type: file.type || 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
