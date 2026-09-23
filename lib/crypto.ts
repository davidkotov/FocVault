const enc = new TextEncoder()

type Bytes = Uint8Array<ArrayBuffer>

const MIN_PIECE_BYTES = 127

export const CHUNK_SIZE = 256 * 1024 * 1024

/** Klartext-Groesse eines Streaming-Subblocks (AES-GCM wird blockweise angewendet). */
export const STREAM_BLOCK_SIZE = 16 * 1024 * 1024

const GCM_TAG = 16
const FRAME_HEADER = 4

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

/** Deterministische IV je Subblock: baseIv[0..7] (zufaellig) + 4-Byte-Zaehler (BE).
 *  Verhindert IV-Wiederverwendung pro Chunk und braucht kein iv-Array im Meta. */
function frameIv(baseIv: Uint8Array, counter: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  iv.set(baseIv.subarray(0, 8), 0)
  iv[8] = (counter >>> 24) & 0xff
  iv[9] = (counter >>> 16) & 0xff
  iv[10] = (counter >>> 8) & 0xff
  iv[11] = counter & 0xff
  return iv
}

export interface StreamPlan {
  frames: number
  cipherSize: number
  paddedSize: number
}

/** Exakt berechnete Kapsel-Groesse eines verschlusselten Chunks:
 *  pro Subblock 4B Laenge-Prefix + Block + 16B GCM-Tag, danach ggf. Pad auf MIN_PIECE_BYTES. */
export function streamCipherPlan(clearSize: number): StreamPlan {
  const frames = Math.max(1, Math.ceil(clearSize / STREAM_BLOCK_SIZE))
  let cipherSize = 0
  let rest = clearSize
  for (let i = 0; i < frames; i++) {
    const blockLen = Math.min(rest, STREAM_BLOCK_SIZE)
    cipherSize += FRAME_HEADER + blockLen + GCM_TAG
    rest -= blockLen
  }
  return { frames, cipherSize, paddedSize: Math.max(cipherSize, MIN_PIECE_BYTES) }
}

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

/** Verschluesselt einen Datei-Abschnitt [start, end) live als Stream.
 *  Pro 16-MiB-Subblock entsteht ein Frame `[u32le cipherLen][cipher+tag]`,
 *  IV deterministisch aus baseIv + Zaehler. Am Ende wird bis `padding` mit
 *  NUL-Bytes aufgefuellt (MIN_PIECE_BYTES). RAM-frei: nie mehr als ~1 Block im Speicher. */
export function encryptedPieceStream(
  file: File,
  start: number,
  end: number,
  fileKey: CryptoKey,
  baseIv: Uint8Array<ArrayBuffer>,
  padding: number,
  signal?: AbortSignal
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const source = file.slice(start, end).stream() as ReadableStream<Uint8Array>
  const reader = source.getReader()
  let buffer = new Uint8Array(0)
  let eof = false
  let counter = 0
  let ended = false

  const encryptBlock = async (block: Uint8Array, ctr: number): Promise<Uint8Array<ArrayBuffer>> => {
    const iv = frameIv(baseIv, ctr)
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, block as Bytes)
    )
    const frame = new Uint8Array(FRAME_HEADER + cipher.byteLength)
    new DataView(frame.buffer).setUint32(0, cipher.byteLength, true)
    frame.set(cipher, FRAME_HEADER)
    return frame
  }

  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      if (ended) return
      if (signal?.aborted) {
        ended = true
        await reader.cancel().catch(() => undefined)
        controller.error(new DOMException('Upload abgebrochen', 'AbortError'))
        return
      }
      while (buffer.byteLength < STREAM_BLOCK_SIZE && !eof) {
        const { done, value } = await reader.read()
        if (done) {
          eof = true
          break
        }
        buffer = concatBytes(buffer, value)
      }
      if (buffer.byteLength >= STREAM_BLOCK_SIZE) {
        const block = buffer.subarray(0, STREAM_BLOCK_SIZE)
        buffer = buffer.subarray(STREAM_BLOCK_SIZE)
        controller.enqueue(await encryptBlock(block, counter++))
        return
      }
      if (eof && buffer.byteLength > 0) {
        const block = buffer
        buffer = new Uint8Array(0)
        controller.enqueue(await encryptBlock(block, counter++))
      }
      if (eof && buffer.byteLength === 0) {
        ended = true
        if (padding > 0) controller.enqueue(new Uint8Array(padding))
        controller.close()
      }
    },
    cancel(_reason) {
      ended = true
      void reader.cancel().catch(() => undefined)
    }
  })
}

/** Decryptiert einen Piece-Stream Frame fuer Frame und ruft onBlock serialisiert auf.
 *  Liest exakt `frames` Frames (self-describing via Laengen-Prefix), Rest = Padding.
 *  RAM-frei: nie mehr als ~1 Frame im Speicher. */
export async function decryptPieceFrames(
  stream: ReadableStream<Uint8Array>,
  fileKey: CryptoKey,
  baseIvB64: string,
  frames: number,
  onBlock: (plain: Uint8Array<ArrayBuffer>) => void | Promise<void>
): Promise<void> {
  const baseIv = fromB64(baseIvB64)
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)
  let counter = 0
  try {
    while (counter < frames) {
      while (buffer.byteLength < FRAME_HEADER) {
        const { done, value } = await reader.read()
        if (done) throw new Error('Piece abgeschnitten – Frame-Header fehlt')
        buffer = concatBytes(buffer, value)
      }
      const len = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, true)
      while (buffer.byteLength < FRAME_HEADER + len) {
        const { done, value } = await reader.read()
        if (done) throw new Error('Piece abgeschnitten – Frame-Daten fehlen')
        buffer = concatBytes(buffer, value)
      }
      const cipher = buffer.subarray(FRAME_HEADER, FRAME_HEADER + len)
      buffer = buffer.subarray(FRAME_HEADER + len)
      const plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: frameIv(baseIv, counter) },
          fileKey,
          cipher as Bytes
        )
      )
      counter++
      await onBlock(plain)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
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
