'use client'

import { api } from '@/features/api/client'
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

/**
 * Secure Send (Konto-Modus). Der Link verweist auf die gespeicherte, verschlüsselte Datei.
 * Der Server kennt nur die Link-ID und verschlüsselte Metadaten; Name, Typ und Datei-Schlüssel
 * stehen darin, verschlüsselt mit dem Link-Schlüssel – der steckt nur im URL-Fragment (#…),
 * das Browser nie an den Server senden. Optional zusätzlich mit Passwort geschützt.
 */
interface ShareMeta {
  v: 3
  name: string
  type: string
  size: number
  pieceSize?: number
  chunks: ChunkMeta[]
  fileKey: string
}

export interface ShareLinkOptions {
  expiresInHours: number | null
  maxDownloads: number | null
  password?: string
}

export async function createShareLink(entry: VaultEntry, masterKey: CryptoKey, opts: ShareLinkOptions): Promise<{ url: string; id: string }> {
  if (!entry.objectId) throw new Error('Diese Datei kann nicht geteilt werden.')
  const raw = await unwrapFileKeyRaw({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, masterKey)
  const linkKey = randomLinkKey()
  try {
    const meta: ShareMeta = { v: 3, name: entry.name, type: entry.type, size: entry.size, pieceSize: entry.pieceSize, chunks: entry.chunks, fileKey: toB64(raw) }
    const container = await encryptShareContainer(JSON.stringify(meta), linkKey)
    const share = await api.createShare({
      objectId: entry.objectId,
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
    raw.fill(0)
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
  name: string
  type: string
  size: number
  expiresAt: string | null
  remaining: number | null
  meta: ShareMeta
  objectId: string
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
  const meta = JSON.parse(await decryptShareContainer(fromB64(pub.meta), linkKey)) as ShareMeta
  if (meta.v !== 3) throw new Error('Unbekanntes Link-Format')
  return { id, name: meta.name, type: meta.type, size: meta.size, expiresAt: pub.expiresAt, remaining: pub.remaining, meta, objectId: pub.objectId }
}

export async function downloadShared(share: OpenedShare, onProgress?: (done: number, total: number) => void): Promise<void> {
  const fileKey = await importFileKey(fromB64(share.meta.fileKey))
  const { pieces } = await api.shareDownload(share.id)
  const byIndex = new Map(pieces.map(p => [p.index, p]))
  const source: PieceSource = {
    openStream: async ref => {
      const index = Number(ref.split('/').pop())
      const piece = byIndex.get(index)
      if (!piece) throw new Error(`Teil ${index + 1} fehlt.`)
      const res = await fetch(piece.url, { headers: piece.headers })
      if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`)
      return res.body
    },
    download: async () => {
      throw new Error('Nicht unterstützt.')
    }
  }
  const parts: BlobPart[] = []
  let done = 0
  await decryptChunksTo({ ...share.meta, objectId: share.objectId }, fileKey, source, plain => {
    parts.push(plain)
    done += plain.byteLength
    onProgress?.(done, share.size)
  })
  const url = URL.createObjectURL(new Blob(parts, { type: share.type || 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = share.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
