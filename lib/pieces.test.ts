import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_PIECE_SIZE,
  ByteQueue,
  CHUNK_SIZE,
  frameAad,
  STREAM_BLOCK_SIZE,
  encryptFileChunked,
  encryptedPieceStream,
  framesForChunk,
  fromB64,
  streamCipherPlan,
  toB64,
  type Bytes
} from './crypto'
import { decryptSharedChunks, type PieceSource } from './pieces'
import type { ChunkMeta } from './vault'

function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff
  return out
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Bytes> {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out as Bytes
}

/** Gibt Bytes in unregelmäßigen Stücken aus, damit die Frame-Pufferung wirklich getestet wird. */
function jaggedStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const sizes = [1, 3, 4, 5, 4093, 65_537, 1_000_003]
  let off = 0
  let k = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (off >= bytes.byteLength) return controller.close()
      const n = sizes[k++ % sizes.length]
      controller.enqueue(bytes.slice(off, off + n))
      off += n
    }
  })
}

/** Verschlüsselt wie components/UploadZone.tsx (Streaming-Frame-Format). */
async function encryptLikeUpload(data: Uint8Array<ArrayBuffer>) {
  const file = new File([data], 'test.bin')
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
  const store = new Map<string, Bytes>()
  const chunks: ChunkMeta[] = []
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  for (let i = 0; i < total; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const plan = streamCipherPlan(end - start)
    const baseIv = crypto.getRandomValues(new Uint8Array(12))
    const piece = await collect(
      encryptedPieceStream(file, start, end, key, baseIv, plan.paddedSize - plan.cipherSize)
    )
    expect(piece.byteLength).toBe(plan.paddedSize)
    const pieceCid = `frame-${i}`
    store.set(pieceCid, piece)
    chunks.push({ pieceCid, iv: toB64(baseIv), padLen: 0, size: plan.paddedSize, fmt: 'frame' })
  }
  const source: PieceSource = {
    openStream: async cid => jaggedStream(store.get(cid)!),
    download: async cid => store.get(cid)!
  }
  return { key, chunks, store, source }
}

/** Byte-Vergleich ohne toEqual – das legt bei 16 MiB einen String-Key pro Byte an (OOM). */
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength)
  expect(Buffer.compare(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength), Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))).toBe(0)
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

describe('ByteQueue', () => {
  it('entnimmt über Stückgrenzen hinweg in Reihenfolge', () => {
    const q = new ByteQueue()
    q.push(new Uint8Array([1, 2]))
    q.push(new Uint8Array([]))
    q.push(new Uint8Array([3, 4, 5]))
    q.push(new Uint8Array([6]))
    expect(q.length).toBe(6)
    expect(Array.from(q.take(3))).toEqual([1, 2, 3])
    expect(Array.from(q.take(3))).toEqual([4, 5, 6])
    expect(q.length).toBe(0)
  })

  it('liest u32le über Stückgrenzen, ohne zu entnehmen', () => {
    const q = new ByteQueue()
    q.push(new Uint8Array([0x78]))
    q.push(new Uint8Array([0x56, 0x34]))
    q.push(new Uint8Array([0x12, 0xff]))
    expect(q.peekU32le()).toBe(0x12345678)
    expect(q.length).toBe(5)
    q.take(1)
    expect(q.peekU32le()).toBe(0xff123456)
  })

  it('wirft bei Unterlauf statt still falsche Daten zu liefern', () => {
    const q = new ByteQueue()
    q.push(new Uint8Array([1, 2, 3]))
    expect(() => q.take(4)).toThrow(RangeError)
    expect(() => q.peekU32le()).toThrow(RangeError)
  })
})

describe('framesForChunk', () => {
  it('rechnet volle und letzte Pieces korrekt', () => {
    expect(framesForChunk(10, 0, 1)).toBe(1)
    expect(framesForChunk(0, 0, 1)).toBe(1)
    expect(framesForChunk(STREAM_BLOCK_SIZE, 0, 1)).toBe(1)
    expect(framesForChunk(STREAM_BLOCK_SIZE + 1, 0, 1)).toBe(2)
    const size = 2 * CHUNK_SIZE + 5
    expect(framesForChunk(size, 0, 3)).toBe(CHUNK_SIZE / STREAM_BLOCK_SIZE)
    expect(framesForChunk(size, 1, 3)).toBe(CHUNK_SIZE / STREAM_BLOCK_SIZE)
    expect(framesForChunk(size, 2, 3)).toBe(1)
  })
})

/** Verschlüsselt wie der Konto-Upload (frame2, AAD = Objekt-ID + Piece-Index). */
async function encryptFrame2(data: Uint8Array<ArrayBuffer>, objectId: string, pieceSize: number) {
  const file = new File([data], 'konto.bin')
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'encrypt',
    'decrypt'
  ])
  const store = new Map<string, Bytes>()
  const chunks: ChunkMeta[] = []
  const total = Math.max(1, Math.ceil(file.size / pieceSize))
  for (let i = 0; i < total; i++) {
    const start = i * pieceSize
    const end = Math.min(start + pieceSize, file.size)
    const plan = streamCipherPlan(end - start)
    const baseIv = crypto.getRandomValues(new Uint8Array(12))
    const piece = await collect(
      encryptedPieceStream(file, start, end, key, baseIv, plan.paddedSize - plan.cipherSize, undefined, frameAad(objectId, i))
    )
    store.set(`${objectId}/${i}`, piece)
    chunks.push({ pieceCid: `${objectId}/${i}`, iv: toB64(baseIv), padLen: 0, size: plan.paddedSize, fmt: 'frame2' })
  }
  const source: PieceSource = {
    openStream: async cid => jaggedStream(store.get(cid)!),
    download: async cid => store.get(cid)!
  }
  return { key, chunks, source }
}

describe('frame2 – AAD-Bindung an Objekt und Piece (Audit M4)', () => {
  const OBJ = '0192f6a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b'
  const OTHER = '0192f6a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c'

  it('Roundtrip über 2 Pieces', async () => {
    const data = pattern(STREAM_BLOCK_SIZE + 4096)
    const { key, chunks, source } = await encryptFrame2(data, OBJ, STREAM_BLOCK_SIZE)
    expect(chunks).toHaveLength(2)
    const parts = await decryptSharedChunks(
      { size: data.byteLength, chunks, objectId: OBJ, pieceSize: STREAM_BLOCK_SIZE },
      key,
      source
    )
    expectSameBytes(join(parts), data)
  })

  it('fremde Objekt-ID scheitert', async () => {
    const data = pattern(5000)
    const { key, chunks, source } = await encryptFrame2(data, OBJ, ACCOUNT_PIECE_SIZE)
    await expect(
      decryptSharedChunks({ size: data.byteLength, chunks, objectId: OTHER, pieceSize: ACCOUNT_PIECE_SIZE }, key, source)
    ).rejects.toThrow()
  })

  it('vertauschte Pieces scheitern – selbst wenn Bytes und Metadaten mitgetauscht werden', async () => {
    const data = pattern(2 * STREAM_BLOCK_SIZE)
    const { key, chunks, source } = await encryptFrame2(data, OBJ, STREAM_BLOCK_SIZE)
    const swapped = [chunks[1], chunks[0]]
    await expect(
      decryptSharedChunks(
        { size: data.byteLength, chunks: swapped, objectId: OBJ, pieceSize: STREAM_BLOCK_SIZE },
        key,
        source
      )
    ).rejects.toThrow()
  })

  it('frame2 ohne Objekt-ID wird abgelehnt', async () => {
    const { key, chunks, source } = await encryptFrame2(pattern(10), OBJ, ACCOUNT_PIECE_SIZE)
    await expect(decryptSharedChunks({ size: 10, chunks }, key, source)).rejects.toThrow(/Objekt-ID/)
  })
})

describe('decryptSharedChunks – Secure Send (Befund D1)', () => {
  it.each([
    ['0 B (leere Datei)', 0],
    ['10 B (auf 127 B gepolstert)', 10],
    ['1 MiB', 1024 * 1024],
    ['16 MiB + 5 B (2 Frames)', STREAM_BLOCK_SIZE + 5]
  ])('Frame-Format Roundtrip: %s', async (_label, size) => {
    const data = pattern(size)
    const { key, chunks, source } = await encryptLikeUpload(data)
    const parts = await decryptSharedChunks({ size, chunks }, key, source)
    expectSameBytes(join(parts), data)
  })

  it('der alte Pfad (ein decrypt pro Frame-Piece) scheitert – Nachweis für D1', async () => {
    const data = pattern(1000)
    const { key, chunks, store } = await encryptLikeUpload(data)
    const piece = store.get(chunks[0].pieceCid)!
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(chunks[0].iv) }, key, piece)
    ).rejects.toThrow()
  })

  it('Legacy-Chunks (ohne fmt, mit Padding) bleiben entschlüsselbar', async () => {
    const data = pattern(5000)
    const enc = await encryptFileChunked(new File([data], 'legacy.bin'))
    const key = await crypto.subtle.importKey('raw', enc.rawKey, 'AES-GCM', false, ['decrypt'])
    const store = new Map<string, Bytes>()
    const chunks: ChunkMeta[] = enc.chunks.map((c, i) => {
      store.set(`legacy-${i}`, c.cipher)
      return { pieceCid: `legacy-${i}`, iv: c.iv, padLen: c.padLen, size: c.cipher.byteLength }
    })
    const parts = await decryptSharedChunks({ size: data.byteLength, chunks }, key, {
      openStream: async () => {
        throw new Error('Legacy darf nicht streamen')
      },
      download: async cid => store.get(cid)!
    })
    expectSameBytes(join(parts), data)
  })
})
