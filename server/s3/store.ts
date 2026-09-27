import { createHash, randomBytes } from 'node:crypto'
import { ACCOUNT_PIECE_SIZE } from '../../lib/crypto'
import { pooledUsedBytes } from '../family/service'
import { quotaFor } from '../billing/quota'
import { getPricing } from '../billing/settings'
import { audit, type Deps } from '../deps'
import { uuidv7 } from '../shared/ids'
import { objectPieceKey } from '../storage/provider'
import { S3Error, type LockMode, type Retention, type S3Object, type S3Store } from './protocol'

/**
 * S3-Speicher eines Kontos im Rechenzentrum. Objekte sind normale `objects` (Quota, Filecoin-
 * Sicherung, Abrechnung, Nachweis); der Body wird direkt in 32-MiB-Teile gestreamt – ohne
 * Zwischendatei, beliebig groß (Multipart bis 10 000 Teile à 5 GiB). Die Daten verschlüsseln die
 * Backup-Werkzeuge selbst (restic, pgBackRest, WAL-G, Proxmox …).
 */
const PIECE = ACCOUNT_PIECE_SIZE

interface Row {
  key: string
  size: number
  etag: string
  content_type: string
  created_at: string
  lock_mode: LockMode | null
  retain_until: string | null
  object_id: string
}

const toObj = (r: Row): S3Object => ({
  key: r.key,
  size: Number(r.size),
  etag: r.etag,
  lastModified: new Date(r.created_at),
  contentType: r.content_type,
  lockMode: r.lock_mode,
  retainUntil: r.retain_until ? new Date(r.retain_until) : null
})

function locked(r: { lock_mode: LockMode | null; retain_until: string | null } | undefined, bypassGovernance: boolean): boolean {
  if (!r?.retain_until || new Date(r.retain_until).getTime() <= Date.now()) return false
  return r.lock_mode === 'COMPLIANCE' || !bypassGovernance
}

const lockedError = () => new S3Error(403, 'AccessDenied', 'Objekt ist bis zum Ablauf der Aufbewahrungsfrist geschützt (Object Lock).')

export class AccountS3Store implements S3Store {
  constructor(
    private readonly deps: Deps,
    private readonly accountId: string
  ) {}

  private get db() {
    return this.deps.db
  }

  async listBuckets() {
    const rows = await this.db.query<{ name: string; created_at: string }>('SELECT name, created_at FROM s3_buckets WHERE account_id = $1 ORDER BY name', [this.accountId])
    return rows.map(r => ({ name: r.name, created: new Date(r.created_at) }))
  }

  async createBucket(name: string, opts: { objectLock: boolean }) {
    const n = await this.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM s3_buckets WHERE account_id = $1', [this.accountId])
    if (Number(n[0]?.n ?? 0) >= 100) throw new S3Error(400, 'TooManyBuckets', 'Höchstens 100 Buckets.')
    const r = await this.db.query(
      `INSERT INTO s3_buckets (account_id, name, object_lock) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING name`,
      [this.accountId, name, opts.objectLock]
    )
    if (!r.length) throw new S3Error(409, 'BucketAlreadyOwnedByYou', 'Bucket existiert bereits.')
    await audit(this.db, this.accountId, 'user', 's3.bucket_created', { objectLock: opts.objectLock })
  }

  async deleteBucket(name: string) {
    const up = await this.db.query('SELECT 1 FROM s3_uploads WHERE account_id = $1 AND bucket = $2 LIMIT 1', [this.accountId, name])
    if (up.length) throw new S3Error(409, 'BucketNotEmpty', 'Offene Multipart-Uploads vorhanden.')
    await this.db.query('DELETE FROM s3_buckets WHERE account_id = $1 AND name = $2', [this.accountId, name])
  }

  async bucketInfo(name: string) {
    const r = await this.db.query<{ object_lock: boolean; lock_mode: LockMode | null; lock_days: number | null }>(
      'SELECT object_lock, lock_mode, lock_days FROM s3_buckets WHERE account_id = $1 AND name = $2',
      [this.accountId, name]
    )
    if (!r[0]) return null
    return { objectLock: r[0].object_lock, defaultRetention: r[0].lock_mode && r[0].lock_days ? { mode: r[0].lock_mode, days: Number(r[0].lock_days) } : null }
  }

  async setBucketLock(name: string, rule: { mode: LockMode; days: number } | null) {
    const info = await this.bucketInfo(name)
    if (!info) throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
    if (!info.objectLock) throw new S3Error(409, 'InvalidBucketState', 'Object Lock lässt sich nur beim Anlegen des Buckets aktivieren.')
    await this.db.query('UPDATE s3_buckets SET lock_mode = $3, lock_days = $4 WHERE account_id = $1 AND name = $2', [this.accountId, name, rule?.mode ?? null, rule?.days ?? null])
  }

  async list(bucket: string, prefix: string, after: string, limit: number) {
    const rows = await this.db.query<Row>(
      `SELECT key, size::float8 AS size, etag, content_type, created_at, lock_mode, retain_until, object_id FROM s3_objects
        WHERE account_id = $1 AND bucket = $2 AND key LIKE $3 ESCAPE '\\' AND key > $4 ORDER BY key COLLATE "C" LIMIT $5`,
      [this.accountId, bucket, prefix.replace(/[\\%_]/g, m => '\\' + m) + '%', after, limit]
    )
    return rows.map(toObj)
  }

  private async row(bucket: string, key: string): Promise<Row | undefined> {
    const r = await this.db.query<Row>(
      `SELECT key, size::float8 AS size, etag, content_type, created_at, lock_mode, retain_until, object_id FROM s3_objects
        WHERE account_id = $1 AND bucket = $2 AND key = $3`,
      [this.accountId, bucket, key]
    )
    return r[0]
  }

  async head(bucket: string, key: string) {
    const r = await this.row(bucket, key)
    return r ? toObj(r) : null
  }

  async read(bucket: string, key: string, range?: { start: number; end: number }) {
    const r = await this.row(bucket, key)
    if (!r) return null
    const pieces = await this.db.query<{ storage_key: string; cipher_bytes: number }>(
      'SELECT storage_key, cipher_bytes::float8 AS cipher_bytes FROM object_pieces WHERE object_id = $1 ORDER BY piece_index',
      [r.object_id]
    )
    const storage = this.deps.storage
    const start = range?.start ?? 0
    const end = range?.end ?? Number(r.size) - 1
    const body = (async function* () {
      let pos = 0
      for (const p of pieces) {
        const len = Number(p.cipher_bytes)
        const pEnd = pos + len - 1
        if (pEnd < start || pos > end) {
          pos += len
          continue
        }
        const obj = await storage.readStream(p.storage_key)
        if (!obj) throw new S3Error(500, 'InternalError', 'Teil fehlt im Speicher.')
        let off = pos
        for await (const c of obj.body as unknown as AsyncIterable<Uint8Array>) {
          const s = Math.max(start - off, 0)
          const e = Math.min(end + 1 - off, c.length)
          if (e > s) yield c.subarray(s, e)
          off += c.length
        }
        pos += len
        if (pos > end) return
      }
    })()
    return { meta: toObj(r), body }
  }

  /** Quota vor dem Schreiben prüfen (angekündigte Größe). */
  private async assertQuota(bytes: number) {
    const acc = await this.db.query<{ id: string; plan: 'free' | 'pro' | 'family' | 'business'; status: string; payg_enabled: boolean; payg_cap_gb: number | null }>(
      'SELECT id, plan, status, payg_enabled, payg_cap_gb FROM accounts WHERE id = $1',
      [this.accountId]
    )
    if (!acc[0] || acc[0].status !== 'active') throw new S3Error(403, 'AccessDenied', 'Konto ist schreibgeschützt.')
    const { quotaBytes } = await quotaFor(this.db, acc[0], await getPricing(this.db))
    const used = await pooledUsedBytes(this.db, this.accountId)
    if (used + bytes > quotaBytes) throw new S3Error(403, 'QuotaExceeded', 'Speicherkontingent erreicht.')
  }

  /** Strom in Teile schneiden und direkt in den Speicher schreiben; liefert MD5 und Größe. */
  private async writePieces(objectId: string, body: AsyncIterable<Buffer>, firstIndex: number): Promise<{ md5: Buffer; size: number; pieces: number }> {
    const md5 = createHash('md5')
    let buf: Buffer[] = []
    let bufLen = 0
    let index = firstIndex
    let size = 0
    const flush = async () => {
      const data = bufLen ? Buffer.concat(buf, bufLen) : Buffer.alloc(0)
      buf = []
      bufLen = 0
      const key = objectPieceKey(this.accountId, objectId, index)
      await this.deps.storage.writeStream(key, new Blob([data]).stream(), data.length)
      await this.db.query('INSERT INTO object_pieces (object_id, piece_index, storage_key, cipher_bytes) VALUES ($1, $2, $3, $4)', [objectId, index, key, data.length])
      index++
    }
    for await (const chunk of body) {
      md5.update(chunk)
      size += chunk.length
      let c = chunk
      while (c.length) {
        const take = Math.min(PIECE - bufLen, c.length)
        buf.push(c.subarray(0, take))
        bufLen += take
        c = c.subarray(take)
        if (bufLen === PIECE) await flush()
      }
    }
    if (bufLen || index === firstIndex) await flush()
    return { md5: md5.digest(), size, pieces: index - firstIndex }
  }

  private async newObject(bytes: number, state: 'uploading' = 'uploading'): Promise<string> {
    const id = uuidv7()
    await this.db.query(
      `INSERT INTO objects (id, owner_account_id, state, fmt, cipher_bytes, piece_count) VALUES ($1, $2, $3, 's3', $4, 1)`,
      [id, this.accountId, state, bytes]
    )
    return id
  }

  private async dropObject(objectId: string) {
    const keys = await this.db.query<{ storage_key: string }>('SELECT storage_key FROM object_pieces WHERE object_id = $1', [objectId])
    await this.deps.storage.delete(keys.map(k => k.storage_key)).catch(() => undefined)
    await this.db.query(`UPDATE objects SET state = 'deleted', deleted_at = now() WHERE id = $1`, [objectId])
  }

  /** Fertiges Objekt unter bucket/key ablegen, altes ersetzen (nur wenn nicht gesperrt). */
  private async commit(bucket: string, key: string, objectId: string, size: number, etag: string, contentType: string, retention: Retention | null) {
    let replaced: string | null = null
    await this.db.tx(async tx => {
      const prev = await tx.query<{ object_id: string; lock_mode: LockMode | null; retain_until: string | null }>(
        'SELECT object_id, lock_mode, retain_until FROM s3_objects WHERE account_id = $1 AND bucket = $2 AND key = $3 FOR UPDATE',
        [this.accountId, bucket, key]
      )
      if (locked(prev[0], false)) throw lockedError()
      await tx.query(`UPDATE objects SET state = 'stored', stored_at = now(), cipher_bytes = $2, piece_count = GREATEST(piece_count, 1) WHERE id = $1`, [objectId, size])
      await tx.query(`INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'store', $3)`, [this.accountId, size, objectId])
      await tx.query(
        `INSERT INTO s3_objects (account_id, bucket, key, object_id, size, etag, content_type, lock_mode, retain_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (account_id, bucket, key) DO UPDATE SET object_id = EXCLUDED.object_id, size = EXCLUDED.size, etag = EXCLUDED.etag,
           content_type = EXCLUDED.content_type, created_at = now(), lock_mode = EXCLUDED.lock_mode, retain_until = EXCLUDED.retain_until`,
        [this.accountId, bucket, key, objectId, size, etag, contentType, retention?.mode ?? null, retention?.until ?? null]
      )
      if (prev[0]) {
        const old = await tx.query<{ cipher_bytes: number }>(
          `UPDATE objects SET state = 'deleted', deleted_at = now() WHERE id = $1 AND state = 'stored' RETURNING cipher_bytes::float8 AS cipher_bytes`,
          [prev[0].object_id]
        )
        if (old[0]) {
          await tx.query(`INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'delete', $3)`, [this.accountId, -Number(old[0].cipher_bytes), prev[0].object_id])
          replaced = prev[0].object_id
        }
      }
    })
    // Speicher des ersetzten Objekts nach dem Commit freigeben
    if (replaced) {
      const dead = await this.db.query<{ storage_key: string }>('SELECT storage_key FROM object_pieces WHERE object_id = $1', [replaced])
      await this.deps.storage.delete(dead.map(d => d.storage_key)).catch(() => undefined)
    }
  }

  async put(bucket: string, key: string, body: AsyncIterable<Buffer>, meta: { size: number; contentType: string; retention: Retention | null }) {
    if (locked(await this.row(bucket, key), false)) throw lockedError()
    await this.assertQuota(meta.size)
    const objectId = await this.newObject(meta.size)
    try {
      const w = await this.writePieces(objectId, body, 0)
      await this.db.query('UPDATE objects SET piece_count = $2 WHERE id = $1', [objectId, w.pieces])
      const etag = w.md5.toString('hex')
      await this.commit(bucket, key, objectId, w.size, etag, meta.contentType, meta.retention)
      return { etag }
    } catch (e) {
      await this.dropObject(objectId)
      throw e
    }
  }

  async delete(bucket: string, key: string, opts: { bypassGovernance: boolean }) {
    const r = await this.row(bucket, key)
    if (!r) return
    if (locked(r, opts.bypassGovernance)) throw lockedError()
    await this.db.tx(async tx => {
      await tx.query('DELETE FROM s3_objects WHERE account_id = $1 AND bucket = $2 AND key = $3', [this.accountId, bucket, key])
      const old = await tx.query<{ cipher_bytes: number }>(
        `UPDATE objects SET state = 'deleted', deleted_at = now() WHERE id = $1 AND state = 'stored' RETURNING cipher_bytes::float8 AS cipher_bytes`,
        [r.object_id]
      )
      if (old[0]) await tx.query(`INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'delete', $3)`, [this.accountId, -Number(old[0].cipher_bytes), r.object_id])
    })
    const keys = await this.db.query<{ storage_key: string }>('SELECT storage_key FROM object_pieces WHERE object_id = $1', [r.object_id])
    await this.deps.storage.delete(keys.map(k => k.storage_key)).catch(() => undefined)
  }

  async setRetention(bucket: string, key: string, ret: Retention, opts: { bypassGovernance: boolean }) {
    const r = await this.row(bucket, key)
    if (!r) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
    const active = r.retain_until && new Date(r.retain_until).getTime() > Date.now()
    // Verlängern geht immer; verkürzen/abschwächen nur bei GOVERNANCE mit Bypass
    const shortening = active && (ret.until.getTime() < new Date(r.retain_until!).getTime() || (r.lock_mode === 'COMPLIANCE' && ret.mode === 'GOVERNANCE'))
    if (shortening && (r.lock_mode === 'COMPLIANCE' || !opts.bypassGovernance)) throw lockedError()
    await this.db.query('UPDATE s3_objects SET lock_mode = $4, retain_until = $5 WHERE account_id = $1 AND bucket = $2 AND key = $3', [this.accountId, bucket, key, ret.mode, ret.until])
  }

  async mpCreate(bucket: string, key: string, meta: { contentType: string; retention: Retention | null }) {
    if (locked(await this.row(bucket, key), false)) throw lockedError()
    const objectId = await this.newObject(0)
    const id = randomBytes(18).toString('base64url')
    await this.db.query(
      `INSERT INTO s3_uploads (upload_id, account_id, bucket, key, object_id, content_type, lock_mode, retain_until) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, this.accountId, bucket, key, objectId, meta.contentType, meta.retention?.mode ?? null, meta.retention?.until ?? null]
    )
    return id
  }

  private async upload(uploadId: string, bucket: string, key: string) {
    const r = await this.db.query<{ object_id: string; content_type: string; lock_mode: LockMode | null; retain_until: string | null }>(
      'SELECT object_id, content_type, lock_mode, retain_until FROM s3_uploads WHERE upload_id = $1 AND account_id = $2 AND bucket = $3 AND key = $4',
      [uploadId, this.accountId, bucket, key]
    )
    if (!r[0]) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
    return r[0]
  }

  /** Teil N belegt Piece-Indizes N·1000 … (bis 5 GiB = 160 Pieces); beim Abschluss wird durchnummeriert. */
  async mpPart(uploadId: string, bucket: string, key: string, part: number, body: AsyncIterable<Buffer>, size: number) {
    const up = await this.upload(uploadId, bucket, key)
    await this.assertQuota(size)
    const base = part * 1000
    const old = await this.db.query<{ storage_key: string }>(
      'DELETE FROM object_pieces WHERE object_id = $1 AND piece_index >= $2 AND piece_index < $3 RETURNING storage_key',
      [up.object_id, base, base + 1000]
    )
    if (old.length) await this.deps.storage.delete(old.map(o => o.storage_key)).catch(() => undefined)
    const w = await this.writePieces(up.object_id, body, base)
    const etag = w.md5.toString('hex')
    await this.db.query(
      `INSERT INTO s3_parts (upload_id, part_number, size, etag) VALUES ($1, $2, $3, $4)
       ON CONFLICT (upload_id, part_number) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag`,
      [uploadId, part, w.size, etag]
    )
    // Reservierung: laufende Uploads zählen zur Quota
    await this.db.query('UPDATE objects SET cipher_bytes = (SELECT COALESCE(SUM(size), 0) FROM s3_parts WHERE upload_id = $2) WHERE id = $1', [up.object_id, uploadId])
    return { etag }
  }

  async mpComplete(uploadId: string, bucket: string, key: string, parts: Array<{ part: number; etag?: string }>) {
    const up = await this.upload(uploadId, bucket, key)
    const stored = await this.db.query<{ part_number: number; size: number; etag: string }>(
      'SELECT part_number, size::float8 AS size, etag FROM s3_parts WHERE upload_id = $1',
      [uploadId]
    )
    const byNo = new Map(stored.map(p => [Number(p.part_number), p]))
    for (const p of parts) {
      const s = byNo.get(p.part)
      if (!s || (p.etag && p.etag !== s.etag)) throw new S3Error(400, 'InvalidPart', `Teil ${p.part} fehlt oder passt nicht.`)
    }
    const chosen = new Set(parts.map(p => p.part))
    // Nicht genannte Teile verwerfen, gewählte Pieces lückenlos durchnummerieren
    const pieceRows = await this.db.query<{ piece_index: number; storage_key: string }>('SELECT piece_index, storage_key FROM object_pieces WHERE object_id = $1 ORDER BY piece_index', [up.object_id])
    const drop = pieceRows.filter(r => !chosen.has(Math.floor(Number(r.piece_index) / 1000)))
    if (drop.length) {
      await this.db.query('DELETE FROM object_pieces WHERE object_id = $1 AND piece_index = ANY($2::int[])', [up.object_id, drop.map(d => Number(d.piece_index))])
      await this.deps.storage.delete(drop.map(d => d.storage_key)).catch(() => undefined)
    }
    await this.db.query('UPDATE object_pieces SET piece_index = piece_index + 100000000 WHERE object_id = $1', [up.object_id])
    await this.db.query(
      `UPDATE object_pieces op SET piece_index = n.rn - 1
         FROM (SELECT piece_index, row_number() OVER (ORDER BY piece_index) AS rn FROM object_pieces WHERE object_id = $1) n
        WHERE op.object_id = $1 AND op.piece_index = n.piece_index`,
      [up.object_id]
    )
    const count = await this.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM object_pieces WHERE object_id = $1', [up.object_id])
    await this.db.query('UPDATE objects SET piece_count = $2 WHERE id = $1', [up.object_id, Math.max(1, Number(count[0]?.n ?? 1))])
    const size = parts.reduce((n, p) => n + Number(byNo.get(p.part)!.size), 0)
    const md5s = Buffer.concat(parts.map(p => Buffer.from(byNo.get(p.part)!.etag, 'hex')))
    const etag = `${createHash('md5').update(md5s).digest('hex')}-${parts.length}`
    await this.commit(bucket, key, up.object_id, size, etag, up.content_type, up.lock_mode && up.retain_until ? { mode: up.lock_mode, until: new Date(up.retain_until) } : null)
    await this.db.query('DELETE FROM s3_uploads WHERE upload_id = $1', [uploadId])
    return { etag }
  }

  async mpAbort(uploadId: string, bucket: string, key: string) {
    const up = await this.upload(uploadId, bucket, key)
    await this.dropObject(up.object_id)
    await this.db.query('DELETE FROM s3_uploads WHERE upload_id = $1', [uploadId])
  }
}
