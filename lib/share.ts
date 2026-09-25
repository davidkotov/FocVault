import type { WalletClient } from 'viem'
import type { ChunkMeta, VaultEntry } from './vault'
import { downloadPiece, getSynapse, getVaultContexts, prepareStorage, uploadPiecesBatched } from './synapse'
import {
  decryptShareContainer,
  deriveSharePasswordKey,
  encodeShareFragment,
  encryptShareContainer,
  fromB64,
  fromB64Url,
  importFileKey,
  randomLinkKey,
  toB64,
  toB64Url,
  unwrapFileKeyRaw,
  unwrapLinkKeyWithPassword,
  wrapLinkKeyWithPassword,
  type Bytes
} from './crypto'

export interface ShareOptions {
  expiryMs: number
  password?: string
  burnAfterUse?: boolean
  maxUses?: number
}

export interface ShareRecord {
  v: 1
  name: string
  type: string
  size: number
  fileKey: string
  chunks: ChunkMeta[]
  createdAt: number
  expiresAt: number
  /** Secure Send v2 – Einmal-Link (nur 1 Download, gerätebasiert). */
  burnAfterUse?: boolean
  /** Secure Send v2 – maximale Anzahl Downloads (gerätebasiert). */
  maxUses?: number
}

export const EXPIRY_OPTIONS = [
  { label: '1 Stunde', ms: 60 * 60 * 1000 },
  { label: '24 Stunden', ms: 24 * 60 * 60 * 1000 },
  { label: '7 Tage', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 Tage', ms: 30 * 24 * 60 * 60 * 1000 }
]

/**
 * Erstellt einen Secure-Send-v2-Link (Client-seitig, Zero-Knowledge).
 * Formate des URL-Fragments (#):
 *   - ohne Passwort  → nackter b64url-Key (legacy-kompatibel, alte Links bleiben lesbar)
 *   - mit Passwort   → `p.<salt>.<iv>.<cipher>` (PBKDF2 → AES-GCM-Key-Wrap)
 */
export async function createShareUrl(
  walletClient: WalletClient,
  masterKey: CryptoKey,
  entry: VaultEntry,
  options: ShareOptions
): Promise<string> {
  const rawKey = await unwrapFileKeyRaw({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, masterKey)
  const linkKey = randomLinkKey()
  const record: ShareRecord = {
    v: 1,
    name: entry.name,
    type: entry.type,
    size: entry.size,
    fileKey: toB64(rawKey),
    chunks: entry.chunks,
    createdAt: Date.now(),
    expiresAt: Date.now() + options.expiryMs,
    ...(options.burnAfterUse ? { burnAfterUse: true } : {}),
    ...(options.maxUses ? { maxUses: options.maxUses } : {})
  }
  const container = await encryptShareContainer(JSON.stringify(record), linkKey)
  const synapse = await getSynapse(walletClient)
  const address = walletClient.account?.address
  const contexts = address ? await getVaultContexts(synapse, address) : undefined
  const prep = await prepareStorage(synapse, [container.byteLength], contexts)
  if (prep.transaction) await prep.transaction.execute()
  const result = await uploadPiecesBatched(synapse, [container], undefined, contexts)
  const cid = result.pieceCids[0]

  let fragment: string
  if (options.password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Bytes
    const pwdKey = await deriveSharePasswordKey(options.password, salt)
    const { iv, cipher } = await wrapLinkKeyWithPassword(pwdKey, linkKey)
    fragment = encodeShareFragment({ kind: 'password', salt, iv, cipher })
  } else {
    fragment = encodeShareFragment({ kind: 'bare', linkKey })
  }

  return `${window.location.origin}/s/${cid}#${fragment}`
}

export async function openShare(
  walletClient: WalletClient,
  pieceCid: string,
  linkKeyB64Url: string
): Promise<ShareRecord> {
  const linkKey = fromB64Url(linkKeyB64Url)
  const synapse = await getSynapse(walletClient)
  const container: Bytes = await downloadPiece(synapse, pieceCid)
  let record: ShareRecord
  try {
    record = JSON.parse(await decryptShareContainer(container, linkKey)) as ShareRecord
  } catch {
    throw new Error('Share konnte nicht entschlüsselt werden – Link unvollständig oder falsches Passwort.')
  }
  if (!record || record.v !== 1 || !Array.isArray(record.chunks) || !record.fileKey) {
    throw new Error('Ungültiger Share-Datensatz.')
  }
  return record
}

export function isShareExpired(record: ShareRecord): boolean {
  return Date.now() > record.expiresAt
}

export async function downloadSharedFile(
  walletClient: WalletClient,
  record: ShareRecord
): Promise<void> {
  const synapse = await getSynapse(walletClient)
  const fileKey = await importFileKey(fromB64(record.fileKey) as Bytes)
  const parts: Uint8Array[] = []
  for (const chunk of record.chunks) {
    const piece = await downloadPiece(synapse, chunk.pieceCid)
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(chunk.iv) }, fileKey, piece)
    )
    parts.push(plain)
  }
  const blob = new Blob(parts.map(p => p.buffer as ArrayBuffer), { type: record.type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = record.name
  a.click()
  URL.revokeObjectURL(url)
}
