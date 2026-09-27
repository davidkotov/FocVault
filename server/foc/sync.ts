import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { StorageProvider } from '../storage/provider'
import { audit } from '../deps'
import { serverSynapse } from './chain'
import { dataSetKey, getFocSettings, getFocState, updateFocState, type FocSettings } from './config'
import { focHealth, invalidateFocHealth } from './health'

/** FOC nimmt Pieces ab 127 Byte an. */
const MIN_PIECE = 127
const MB = 1024 * 1024

export interface PackCopy {
  providerId: string
  dataSetId: string
  pieceId: string
  role: string
  retrievalUrl: string
}

/**
 * Alle Storage-Keys, die dauerhaft gesichert werden sollen: Pieces fertig hochgeladener Dateien
 * und pro Konto nur der **neueste** Tresor-Index, sobald er 30 Minuten alt ist (der Index
 * ändert sich bei jeder Aktion – ältere Versionen würden nur Gebühren verursachen).
 */
const LIVE_KEYS = `
  SELECT op.storage_key, op.cipher_bytes::float8 AS bytes, o.stored_at AS since
    FROM object_pieces op JOIN objects o ON o.id = op.object_id
   WHERE o.state = 'stored'
  UNION ALL
  SELECT storage_key, size::float8 AS bytes, created_at AS since FROM (
    SELECT DISTINCT ON (account_id) account_id, storage_key, size, created_at
      FROM vault_indexes ORDER BY account_id, version DESC
  ) latest WHERE created_at < now() - interval '30 minutes'
`

/** Was der Abgleich von FOC braucht – in Tests durch eine Attrappe ersetzbar. */
export interface FocBackend {
  upload(pack: Uint8Array): Promise<{ pieceCid: string; copies: PackCopy[] }>
  removePiece(copy: PackCopy): Promise<void>
}

/** Echtes FOC über das Synapse SDK, signiert mit dem Session-Key. */
export function synapseBackend(db: Db, s: FocSettings): FocBackend {
  return {
    async upload(pack) {
      const synapse = await serverSynapse(db, s)
      const state = await getFocState(db)
      const dsKey = dataSetKey(s.network, s.payer)
      const known = (state.dataSets[dsKey] ?? []).map(id => BigInt(id))
      const metadata = { Application: 'focvault', Version: 'accounts-1' }
      let contexts
      try {
        contexts = await synapse.storage.createContexts({
          copies: s.copies,
          metadata,
          ...(known.length === s.copies ? { dataSetIds: known } : {})
        })
      } catch {
        contexts = await synapse.storage.createContexts({ copies: s.copies, metadata })
      }
      const result = await synapse.storage.upload(pack, { contexts })
      if (!result.copies.length) {
        throw new Error(`Upload ohne bestätigte Kopie (${result.failedAttempts.map(f => f.error).join('; ').slice(0, 300)})`)
      }
      return {
        pieceCid: result.pieceCid.toString(),
        copies: result.copies.map(c => ({
          providerId: c.providerId.toString(),
          dataSetId: c.dataSetId.toString(),
          pieceId: c.pieceId.toString(),
          role: c.role,
          retrievalUrl: c.retrievalUrl
        }))
      }
    },
    async removePiece(copy) {
      const synapse = await serverSynapse(db, s)
      const ctx = await synapse.storage.createContext({ dataSetId: BigInt(copy.dataSetId) })
      await ctx.deletePiece({ piece: BigInt(copy.pieceId) })
    }
  }
}

export interface FocSyncResult {
  ran: boolean
  message: string
  packed?: { keys: number; bytes: number; pieceCid: string; copies: number }
  markedDeleted: number
  removedPacks: number
  evicted: number
}

async function acquireLease(db: Db, seconds: number): Promise<boolean> {
  const rows = await db.query<{ key: string }>(
    `INSERT INTO settings (key, value) VALUES ('foc_lease', jsonb_build_object('until', (extract(epoch from now()) + $1)::float8))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE (settings.value->>'until')::float8 < extract(epoch from now())
     RETURNING key`,
    [seconds]
  )
  return rows.length > 0
}

async function releaseLease(db: Db): Promise<void> {
  await db.query(`DELETE FROM settings WHERE key = 'foc_lease'`)
}

/** Liest einen Key an eine Stelle im Paket-Puffer; liefert die Länge (-1 = fehlt/passt nicht). */
async function readInto(storage: StorageProvider, key: string, buf: Uint8Array, at: number, expected: number): Promise<number> {
  const obj = await storage.readStream(key)
  if (!obj) return -1
  const reader = obj.body.getReader()
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (n + value.byteLength > expected) {
      await reader.cancel()
      return -1
    }
    buf.set(value, at + n)
    n += value.byteLength
  }
  return n
}

export async function focBacklog(db: Db): Promise<{ keys: number; bytes: number; oldest: string | null }> {
  const rows = await db.query<{ n: number; b: number; oldest: string | null }>(
    `SELECT count(*)::float8 AS n, coalesce(sum(bytes), 0)::float8 AS b, min(since)::text AS oldest
       FROM (${LIVE_KEYS}) l WHERE NOT EXISTS (SELECT 1 FROM foc_members m WHERE m.storage_key = l.storage_key)`
  )
  return { keys: Number(rows[0]?.n ?? 0), bytes: Number(rows[0]?.b ?? 0), oldest: rows[0]?.oldest ?? null }
}

/** Gelöschte Keys markieren; Pakete ohne lebende Inhalte bei den Anbietern entfernen lassen. */
async function reconcileDeletions(db: Db, s: FocSettings, backend: FocBackend): Promise<{ marked: number; removed: number }> {
  const marked = await db.query(
    `UPDATE foc_members m SET deleted_at = now()
      WHERE m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM (${LIVE_KEYS}) l WHERE l.storage_key = m.storage_key)
        AND NOT EXISTS (SELECT 1 FROM vault_indexes v WHERE v.storage_key = m.storage_key)
      RETURNING m.storage_key`
  )
  const dead = await db.query<{ id: string; copies: PackCopy[] }>(
    `SELECT p.id, p.copies FROM foc_packs p
      WHERE p.state = 'stored' AND p.network = $1
        AND NOT EXISTS (SELECT 1 FROM foc_members m WHERE m.pack_id = p.id AND m.deleted_at IS NULL)
      LIMIT 20`,
    [s.network]
  )
  let removed = 0
  if (dead.length) {
    for (const pack of dead) {
      for (const copy of pack.copies) await backend.removePiece(copy)
      await db.query(`UPDATE foc_packs SET state = 'removed', removal_requested_at = now() WHERE id = $1`, [pack.id])
      removed++
    }
  }
  return { marked: marked.length, removed }
}

/** Schnelle Kopie von Datei-Pieces entfernen, die sicher auf Filecoin liegen (optional). */
async function evict(db: Db, storage: StorageProvider, s: FocSettings): Promise<number> {
  if (s.evictAfterHours === null) return 0
  const rows = await db.query<{ storage_key: string }>(
    `SELECT m.storage_key FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id
      WHERE p.state = 'stored' AND jsonb_array_length(p.copies) >= $1
        AND m.deleted_at IS NULL AND m.evicted_at IS NULL AND m.storage_key LIKE 'u/%/o/%'
        AND p.created_at < now() - make_interval(secs => $2)
      LIMIT 500`,
    [s.copies, s.evictAfterHours * 3600]
  )
  if (!rows.length) return 0
  const keys = rows.map(r => r.storage_key)
  await storage.delete(keys)
  await db.query(`UPDATE foc_members SET evicted_at = now() WHERE storage_key = ANY($1::text[])`, [keys])
  return keys.length
}

/** Nächstes Paket bilden und auf FOC hochladen (höchstens eines pro Lauf). */
async function packAndUpload(db: Db, storage: StorageProvider, s: FocSettings, backend: FocBackend, force: boolean): Promise<FocSyncResult['packed']> {
  const backlog = await focBacklog(db)
  if (!backlog.keys) return undefined
  const ageHours = backlog.oldest ? (Date.now() - new Date(backlog.oldest).getTime()) / 3_600_000 : 0
  if (!force && backlog.bytes < s.packMinMb * MB && ageHours < s.packMaxWaitHours) return undefined

  const candidates = await db.query<{ storage_key: string; bytes: number }>(
    `SELECT storage_key, bytes FROM (${LIVE_KEYS}) l
      WHERE NOT EXISTS (SELECT 1 FROM foc_members m WHERE m.storage_key = l.storage_key)
      ORDER BY since LIMIT 2000`
  )
  // Auswahl nach den in der DB bekannten Größen, dann direkt in einen Puffer lesen (kein Doppel-RAM).
  const max = s.packMaxMb * MB
  const chosen: Array<{ key: string; bytes: number }> = []
  let planned = 0
  for (const c of candidates) {
    const b = Number(c.bytes)
    if (planned + b > max && chosen.length) break
    chosen.push({ key: c.storage_key, bytes: b })
    planned += b
  }
  if (!chosen.length) return undefined
  const buf = new Uint8Array(Math.max(planned, MIN_PIECE))
  const members: Array<{ key: string; offset: number; length: number }> = []
  let off = 0
  for (const c of chosen) {
    const got = await readInto(storage, c.key, buf, off, c.bytes)
    if (got !== c.bytes) continue // fehlt oder Größe passt nicht → später erneut
    members.push({ key: c.key, offset: off, length: got })
    off += got
  }
  if (!members.length) return undefined
  const pack = off === buf.byteLength ? buf : buf.subarray(0, Math.max(off, MIN_PIECE))

  const { pieceCid, copies } = await backend.upload(pack)
  const packId = randomUUID()
  await db.tx(async tx => {
    await tx.query(
      `INSERT INTO foc_packs (id, network, state, bytes, piece_cid, copies) VALUES ($1, $2, 'stored', $3, $4, $5)`,
      [packId, s.network, pack.byteLength, pieceCid, JSON.stringify(copies)]
    )
    await tx.query(
      `INSERT INTO foc_members (storage_key, pack_id, byte_offset, byte_length)
       SELECT k, $1, o, l FROM unnest($2::text[], $3::bigint[], $4::bigint[]) AS t(k, o, l)
       ON CONFLICT (storage_key) DO NOTHING`,
      [packId, members.map(m => m.key), members.map(m => m.offset), members.map(m => m.length)]
    )
  })
  await updateFocState(db, st => {
    st.dataSets[dataSetKey(s.network, s.payer)] = [...new Set(copies.map(c => c.dataSetId))]
  })
  return { keys: members.length, bytes: pack.byteLength, pieceCid, copies: copies.length }
}

/**
 * Ein Abgleich-Lauf: Löschungen nachziehen, optional schnelle Kopien entfernen, dann das
 * nächste Paket hochladen. Läuft im Hintergrund (instrumentation.ts) oder per Cron-Aufruf.
 */
export async function runFocSync(
  db: Db,
  storage: StorageProvider,
  opts: { force?: boolean; actor?: string; backend?: FocBackend } = {}
): Promise<FocSyncResult> {
  const s = await getFocSettings(db)
  const empty: FocSyncResult = { ran: false, message: '', markedDeleted: 0, removedPacks: 0, evicted: 0 }
  if (!s.enabled) return { ...empty, message: 'FOC ist ausgeschaltet.' }
  if (!s.payer) return { ...empty, message: 'Keine zahlende Wallet hinterlegt.' }
  if (!(await acquireLease(db, 15 * 60))) return { ...empty, message: 'Läuft bereits.' }
  try {
    const backend = opts.backend ?? synapseBackend(db, s)
    const health = opts.backend ? null : await focHealth(db, true)
    if (health?.level === 'critical') {
      const r = { ...empty, message: `Übersprungen: ${health.message}` }
      await updateFocState(db, st => void (st.lastRun = { at: new Date().toISOString(), ok: false, message: r.message }))
      return r
    }
    const del = await reconcileDeletions(db, s, backend)
    const evicted = await evict(db, storage, s)
    const packed = await packAndUpload(db, storage, s, backend, !!opts.force)
    const message = packed
      ? `${packed.keys} Teile (${(packed.bytes / MB).toFixed(1)} MiB) als ${packed.copies} Kopien gesichert.`
      : 'Nichts hochzuladen.'
    if (packed) await audit(db, null, 'system', 'foc.pack_stored', { ...packed })
    await updateFocState(db, st => void (st.lastRun = { at: new Date().toISOString(), ok: true, message }))
    invalidateFocHealth()
    return { ran: true, message, packed, markedDeleted: del.marked, removedPacks: del.removed, evicted }
  } catch (e) {
    const message = `Fehler: ${(e as Error).message.split('\n')[0].slice(0, 300)}`
    await updateFocState(db, st => void (st.lastRun = { at: new Date().toISOString(), ok: false, message }))
    return { ...empty, ran: true, message }
  } finally {
    await releaseLease(db)
  }
}

export async function focStats(db: Db) {
  const rows = await db.query<{ state: string; n: number; b: number }>(
    `SELECT state, count(*)::float8 AS n, coalesce(sum(bytes), 0)::float8 AS b FROM foc_packs GROUP BY state`
  )
  const members = await db.query<{ live: number; dead: number; evicted: number; live_b: number; dead_b: number }>(
    `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::float8 AS live,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)::float8 AS dead,
            count(*) FILTER (WHERE evicted_at IS NOT NULL AND deleted_at IS NULL)::float8 AS evicted,
            coalesce(sum(byte_length) FILTER (WHERE deleted_at IS NULL), 0)::float8 AS live_b,
            coalesce(sum(byte_length) FILTER (WHERE deleted_at IS NOT NULL), 0)::float8 AS dead_b
       FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id WHERE p.state = 'stored'`
  )
  const byState = Object.fromEntries(rows.map(r => [r.state, { packs: Number(r.n), bytes: Number(r.b) }]))
  const m = members[0]
  return {
    packs: byState as Record<string, { packs: number; bytes: number }>,
    liveKeys: Number(m?.live ?? 0),
    liveBytes: Number(m?.live_b ?? 0),
    deadBytes: Number(m?.dead_b ?? 0),
    evictedKeys: Number(m?.evicted ?? 0),
    backlog: await focBacklog(db)
  }
}
