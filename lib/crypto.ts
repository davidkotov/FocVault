const enc = new TextEncoder()

type Bytes = Uint8Array<ArrayBuffer>

const MIN_PIECE_BYTES = 127

export const CHUNK_SIZE = 256 * 1024 * 1024

export interface ChunkCipher {
  cipher: Bytes
  iv: string
  padLen: number
}

export interface EncryptedFile {
  chunks: ChunkCipher[]
  rawKey: Bytes
}

export interface WrappedKey {
  wrapped: string
  iv: string
}

export function toB64(buf: Bytes | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromB64(s: string): Bytes {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function hexToBytes(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function randomHex(len: number): string {
  const b = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

function utf8(s: string): Bytes {
  return enc.encode(s) as Bytes
}

export function getOrCreateSalt(address: string): string {
  const key = `focvault:salt:${address.toLowerCase()}`
  let salt: string | null = null
  if (typeof window !== 'undefined') salt = window.localStorage.getItem(key)
  if (!salt) {
    salt = randomHex(16)
    if (typeof window !== 'undefined') window.localStorage.setItem(key, salt)
  }
  return salt
}

export function buildSignMessage(salt: string): string {
  return [
    'FocVault Key Derivation v1',
    '',
    'Diese Signatur leitet deinen lokalen Verschluesselungsschluessel ab.',
    'Sie ist keine Transaktion und erteilt keine Berechtigungen.',
    `Salt: ${salt}`
  ].join('\n')
}

export async function deriveMasterKey(signature: string, salt: string): Promise<CryptoKey> {
  const sigBytes = utf8(signature)
  const saltBytes = hexToBytes(salt)
  const base = await crypto.subtle.importKey('raw', sigBytes, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: utf8('focvault-master-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptBytesWithKey(data: Bytes, fileKey: CryptoKey): Promise<ChunkCipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, data)
  const cipher = new Uint8Array(cipherBuf)
  let out: Bytes = cipher
  let padLen = 0
  if (cipher.byteLength < MIN_PIECE_BYTES) {
    padLen = MIN_PIECE_BYTES - cipher.byteLength
    out = new Uint8Array(MIN_PIECE_BYTES)
    out.set(cipher)
  }
  return { cipher: out, iv: toB64(iv), padLen }
}

export async function encryptFileChunked(
  file: File,
  onChunk?: (done: number, total: number) => void
): Promise<EncryptedFile> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
  const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  const chunks: ChunkCipher[] = []
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const data = new Uint8Array(await blob.arrayBuffer())
    chunks.push(await encryptBytesWithKey(data, fileKey))
    onChunk?.(i + 1, total)
  }
  return { chunks, rawKey }
}

export async function wrapFileKey(rawKey: Bytes, master: CryptoKey): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, rawKey))
  return { wrapped: toB64(wrapped), iv: toB64(iv) }
}

export async function unwrapFileKey(wrapped: WrappedKey, master: CryptoKey): Promise<CryptoKey> {
  const raw = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrapped.iv) }, master, fromB64(wrapped.wrapped))
  )
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
}

export async function decryptChunk(
  cipher: Bytes,
  iv: string,
  padLen: number,
  fileKey: CryptoKey
): Promise<Bytes> {
  const unpadded = cipher.subarray(0, cipher.byteLength - padLen)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, fileKey, unpadded))
}

export async function encryptVaultJsonBytes(json: string, master: CryptoKey): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, utf8(json)))
  const container = new Uint8Array(12 + cipher.byteLength)
  container.set(iv, 0)
  container.set(cipher, 12)
  return container
}

export async function encryptVaultJson(json: string, master: CryptoKey): Promise<Blob> {
  const container = await encryptVaultJsonBytes(json, master)
  return new Blob([container.buffer as ArrayBuffer], { type: 'application/octet-stream' })
}

export async function decryptVaultJsonBytes(container: Bytes, master: CryptoKey): Promise<string> {
  const iv = container.subarray(0, 12)
  const cipher = container.subarray(12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, master, cipher))
  return new TextDecoder().decode(plain)
}

export async function decryptVaultJson(container: ArrayBuffer, master: CryptoKey): Promise<string> {
  return decryptVaultJsonBytes(new Uint8Array(new Uint8Array(container)), master)
}

export function randomLinkKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(32)) as Bytes
}

export function toB64Url(buf: Bytes): string {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return fromB64(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
}

export async function unwrapFileKeyRaw(wrapped: WrappedKey, master: CryptoKey): Promise<Bytes> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrapped.iv) }, master, fromB64(wrapped.wrapped))
  )
}

export async function importFileKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
}

export async function encryptShareContainer(json: string, linkKey: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', linkKey, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(json)))
  const container = new Uint8Array(12 + cipher.byteLength)
  container.set(iv, 0)
  container.set(cipher, 12)
  return container
}

export async function decryptShareContainer(container: Bytes, linkKey: Bytes): Promise<string> {
  const key = await crypto.subtle.importKey('raw', linkKey, 'AES-GCM', false, ['decrypt'])
  const iv = container.subarray(0, 12)
  const cipher = container.subarray(12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher))
  return new TextDecoder().decode(plain)
}
