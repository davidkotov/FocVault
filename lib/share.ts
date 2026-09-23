import type { WalletClient } from 'viem'
import type { ChunkMeta, VaultEntry } from './vault'
import { downloadPiece, getSynapse, getVaultContexts, prepareStorage, uploadPiecesBatched } from './synapse'
import {
  encryptShareContainer,
  decryptShareContainer,
  randomLinkKey,
  toB64,
  toB64Url,
  fromB64Url,
  fromB64,
  unwrapFileKeyRaw,
  importFileKey
} from './crypto'

type Bytes = Uint8Array<ArrayBuffer>

export interface ShareRecord {
  v: 1
  name: string
  type: string
  size: number
  fileKey: string
  chunks: ChunkMeta[]
  createdAt: number
  expiresAt: number
}

export const EXPIRY_OPTIONS = [
  { label: '1 Tag', days: 1 },
  { label: '7 Tage', days: 7 },
  { label: '30 Tage', days: 30 }
]

export async function createShareUrl(
  walletClient: WalletClient,
  masterKey: CryptoKey,
  entry: VaultEntry,
  expiryDays: number
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
    expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000
  }
  const container = await encryptShareContainer(JSON.stringify(record), linkKey)
  const synapse = await getSynapse(walletClient)
  const address = walletClient.account?.address
  const contexts = address ? await getVaultContexts(synapse, address) : undefined
  const prep = await prepareStorage(synapse, [container.byteLength], contexts)
  if (prep.transaction) await prep.transaction.execute()
  const result = await uploadPiecesBatched(synapse, [container], undefined, contexts)
  const cid = result.pieceCids[0]
  return `${window.location.origin}/s/${cid}#${toB64Url(linkKey)}`
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
    throw new Error('Share konnte nicht entschlüsselt werden – Link unvollständig oder falscher Schlüssel.')
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
  const fileKey = await importFileKey(fromB64(record.fileKey))
  const parts: Uint8Array[] = []
  for (const chunk of record.chunks) {
    const bytes = await downloadPiece(synapse, chunk.pieceCid)
    const unpadded = bytes.subarray(0, bytes.byteLength - chunk.padLen)
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(chunk.iv) }, fileKey, unpadded)
    )
    parts.push(plain)
  }
  const blob = new Blob(parts.map(p => p.buffer as ArrayBuffer), {
    type: record.type || 'application/octet-stream'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = record.name
  a.click()
  URL.revokeObjectURL(url)
}