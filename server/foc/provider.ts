import type { Db } from '../db'
import type { PresignedRequest, StorageProvider } from '../storage/provider'
import { signedStorageUrl } from '../storage/signing'
import { getFocSettings } from './config'
import { serverSynapse } from './chain'
import type { PackCopy } from './sync'

interface MemberRow {
  byte_offset: number
  byte_length: number
  evicted_at: string | null
  piece_cid: string
  copies: PackCopy[]
}

async function member(db: Db, key: string): Promise<MemberRow | null> {
  const rows = await db.query<MemberRow>(
    `SELECT m.byte_offset::float8 AS byte_offset, m.byte_length::float8 AS byte_length, m.evicted_at, p.piece_cid, p.copies
       FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id
      WHERE m.storage_key = $1 AND m.deleted_at IS NULL AND p.state = 'stored'`,
    [key]
  )
  return rows[0] ?? null
}

/** Byte-Bereich eines Pakets bei einem der Anbieter holen (HTTP Range, sonst ganzes Piece). */
async function fetchRange(db: Db, m: MemberRow): Promise<Uint8Array> {
  const start = Number(m.byte_offset)
  const len = Number(m.byte_length)
  for (const copy of m.copies) {
    try {
      const res = await fetch(copy.retrievalUrl, { headers: { Range: `bytes=${start}-${start + len - 1}` } })
      if (res.status === 206) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength === len) return buf
      } else if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength >= start + len) return buf.slice(start, start + len)
      }
    } catch {
      // nächster Anbieter
    }
  }
  const synapse = await serverSynapse(db, await getFocSettings(db))
  const all = await synapse.storage.download({ pieceCid: m.piece_cid })
  return all.slice(start, start + len)
}

function toStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes)
      c.close()
    }
  })
}

/**
 * Storage mit Filecoin im Rücken: Schreiben und Lesen laufen über die schnelle Kopie
 * (Fil One bzw. lokal). Fehlt dort ein Key – weil er nach der Sicherung entfernt wurde –,
 * wird er aus dem FOC-Paket gelesen. Direkte Anbieter-URLs werden dann auf den Proxy umgelenkt.
 */
export class FocBackedProvider implements StorageProvider {
  readonly kind: StorageProvider['kind']
  readonly direct: boolean

  constructor(
    private readonly base: StorageProvider,
    private readonly db: () => Promise<Db>
  ) {
    this.kind = base.kind
    this.direct = base.direct
  }

  presignPut(key: string, size: number, ttlSec: number): Promise<PresignedRequest> {
    return this.base.presignPut(key, size, ttlSec)
  }

  async presignGet(key: string, ttlSec: number): Promise<PresignedRequest> {
    if (this.base.direct) {
      const m = await member(await this.db(), key)
      if (m?.evicted_at) {
        const { url, expiresAt } = signedStorageUrl('get', key, ttlSec)
        return { url, method: 'GET', expiresAt }
      }
    }
    return this.base.presignGet(key, ttlSec)
  }

  async head(key: string): Promise<{ size: number } | null> {
    const h = await this.base.head(key)
    if (h) return h
    const m = await member(await this.db(), key)
    return m ? { size: Number(m.byte_length) } : null
  }

  delete(keys: string[]): Promise<void> {
    return this.base.delete(keys)
  }

  putSmall(key: string, body: Uint8Array): Promise<void> {
    return this.base.putSmall(key, body)
  }

  async getSmall(key: string): Promise<Uint8Array | null> {
    const b = await this.base.getSmall(key)
    if (b) return b
    const db = await this.db()
    const m = await member(db, key)
    return m ? fetchRange(db, m) : null
  }

  writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    return this.base.writeStream(key, body, size)
  }

  async readStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
    const r = await this.base.readStream(key)
    if (r) return r
    const db = await this.db()
    const m = await member(db, key)
    if (!m) return null
    const bytes = await fetchRange(db, m)
    return { body: toStream(bytes), size: bytes.byteLength }
  }
}
