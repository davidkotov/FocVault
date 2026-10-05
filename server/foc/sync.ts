import { createHash, randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { StorageProvider } from '../storage/provider'
import { audit } from '../deps'
import { getPricing } from '../billing/settings'
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
  SELECT op.storage_key, op.cipher_bytes::float8 AS bytes, o.stored_at AS since, o.owner_account_id AS account_id
    FROM object_pieces op JOIN objects o ON o.id = op.object_id
   WHERE o.state IN ('stored', 'version', 'trashed') AND op.cipher_bytes > 0
  UNION ALL
  SELECT storage_key, size::float8 AS bytes, created_at AS since, account_id FROM (
    SELECT DISTINCT ON (account_id) account_id, storage_key, size, created_at
      FROM vault_indexes ORDER BY account_id, version DESC
  ) latest WHERE created_at < now() - interval '30 minutes'
`

/**
 * Konten mit Super Safe (mehr Kopien): Inhaber mit aktiver Buchung auf einem Abo und die
 * Mitglieder seiner Family bzw. seines Teams (geteilte Quota). since = Beginn der Buchung.
 */
const SUPER_SAFE_ACCOUNTS = `
  SELECT s.account_id, s.created_at AS since FROM account_super_safe s JOIN accounts a ON a.id = s.account_id
   WHERE s.status = 'active' AND a.plan <> 'free'
  UNION ALL
  SELECT f.account_id, s.created_at AS since FROM family_members f
    JOIN account_super_safe s ON s.account_id = f.owner_account_id AND s.status = 'active'
    JOIN accounts a ON a.id = s.account_id AND a.plan <> 'free'
`

/** Bestätigte Kopien je Key über alle lebenden Pakete (Basis + Zusatz). */
const KEY_COPIES = `
  SELECT m.storage_key, sum(jsonb_array_length(p.copies))::float8 AS copies, bool_or(p.kind = 'base') AS based
    FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id
   WHERE m.deleted_at IS NULL AND p.state = 'stored' AND p.network = $1
   GROUP BY m.storage_key
`

export interface UploadOptions {
  /** gewünschte Anzahl Kopien (verschiedene Anbieter) */
  copies: number
  /** Anbieter, die den Inhalt schon haben (Zusatzkopien müssen woanders liegen) */
  excludeProviderIds: string[]
}

/** Was der Abgleich von FOC braucht – in Tests durch eine Attrappe ersetzbar. */
export interface FocBackend {
  upload(pack: Uint8Array, opts: UploadOptions): Promise<{ pieceCid: string; copies: PackCopy[] }>
  removePiece(copy: PackCopy): Promise<void>
}

/** Echtes FOC über das Synapse SDK, signiert mit dem Session-Key. */
export function synapseBackend(db: Db, s: FocSettings): FocBackend {
  return {
    async upload(pack, { copies, excludeProviderIds }) {
      const synapse = await serverSynapse(db, s)
      const metadata = { Application: 'focvault', Version: 'accounts-1' }
      let contexts: Awaited<ReturnType<typeof synapse.storage.createContexts>>
      if (excludeProviderIds.length) {
        // Zusatzkopien: Anbieter einzeln wählen, die den Inhalt noch nicht haben. Das SDK liefert
        // stillschweigend weniger, wenn nicht genug zugelassene Anbieter erreichbar sind.
        const exclude = excludeProviderIds.map(id => BigInt(id))
        contexts = []
        for (let i = 0; i < copies; i++) {
          try {
            const ctx = await synapse.storage.createContext({ metadata, excludeProviderIds: exclude })
            contexts.push(ctx)
            exclude.push(ctx.provider.id)
          } catch {
            break
          }
        }
      } else {
        const state = await getFocState(db)
        const known = (state.dataSets[dataSetKey(s.network, s.payer)] ?? []).map(id => BigInt(id))
        try {
          contexts = await synapse.storage.createContexts({ copies, metadata, ...(known.length === copies ? { dataSetIds: known } : {}) })
        } catch {
          contexts = await synapse.storage.createContexts({ copies, metadata })
        }
      }
      // Zusatzkopien: lieber sichtbar scheitern als still weniger speichern. (Basis-Pakete laden wie bisher
      // auch mit weniger Anbietern hoch – die Lücke steht dann in der Meldung und wird bei Super Safe nachgeholt.)
      if (excludeProviderIds.length && contexts.length < copies) {
        throw new Error(`Nur ${contexts.length} von ${copies} benötigten Speicheranbietern verfügbar – nichts hochgeladen.`)
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

export interface PackResult {
  keys: number
  bytes: number
  pieceCid: string
  /** bestätigte Kopien */
  copies: number
  /** angefragte Kopien */
  requested: number
}

export interface FocSyncResult {
  ran: boolean
  message: string
  /** Basis-Paket (Standard-Kopien) */
  packed?: PackResult
  /** Zusatz-Paket für Super Safe (fehlende Kopien) */
  extra?: PackResult
  markedDeleted: number
  /** Zusatzkopien freigegeben, weil Super Safe endete */
  released: number
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

/** Noch nicht im Basis-Paket gesicherte Keys. */
const NOT_BASED = `NOT EXISTS (SELECT 1 FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id WHERE m.storage_key = l.storage_key AND p.kind = 'base')`

export async function focBacklog(db: Db): Promise<{ keys: number; bytes: number; oldest: string | null }> {
  const rows = await db.query<{ n: number; b: number; oldest: string | null }>(
    `SELECT count(*)::float8 AS n, coalesce(sum(bytes), 0)::float8 AS b, min(since)::text AS oldest
       FROM (${LIVE_KEYS}) l WHERE ${NOT_BASED}`
  )
  return { keys: Number(rows[0]?.n ?? 0), bytes: Number(rows[0]?.b ?? 0), oldest: rows[0]?.oldest ?? null }
}

interface ExtraCandidate {
  storage_key: string
  bytes: number
  since: string
  missing: number
}

/** Super-Safe-Keys mit weniger bestätigten Kopien als gewünscht (nur bereits im Basis-Paket gesicherte). */
async function extraCandidates(db: Db, s: FocSettings, target: number, limit: number): Promise<ExtraCandidate[]> {
  return db.query<ExtraCandidate>(
    `SELECT l.storage_key, max(l.bytes)::float8 AS bytes, max(GREATEST(l.since, ss.since))::text AS since, ($2 - max(k.copies))::float8 AS missing
       FROM (${LIVE_KEYS}) l
       JOIN (${SUPER_SAFE_ACCOUNTS}) ss ON ss.account_id = l.account_id
       JOIN (${KEY_COPIES}) k ON k.storage_key = l.storage_key AND k.based
      WHERE k.copies < $2
      GROUP BY l.storage_key
      ORDER BY 3, 1 LIMIT ${limit}`,
    [s.network, target]
  )
}

/** Super Safe: wartende Zusatzkopien (Keys, Bytes) – für die Admin-Übersicht. */
export async function focExtraBacklog(db: Db): Promise<{ keys: number; bytes: number; target: number }> {
  const s = await getFocSettings(db)
  const target = (await getPricing(db)).superSafe.copies
  if (target <= s.copies) return { keys: 0, bytes: 0, target }
  const rows = await extraCandidates(db, s, target, 100_000)
  return { keys: rows.length, bytes: rows.reduce((n, r) => n + Number(r.bytes), 0), target }
}

/**
 * Gelöschte Keys markieren; Zusatzkopien freigeben, deren Konto kein Super Safe mehr hat;
 * Pakete ohne lebende Inhalte bei den Anbietern entfernen lassen.
 */
async function reconcileDeletions(db: Db, s: FocSettings, backend: FocBackend): Promise<{ marked: number; released: number; removed: number }> {
  const marked = await db.query(
    `UPDATE foc_members m SET deleted_at = now()
      WHERE m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM (${LIVE_KEYS}) l WHERE l.storage_key = m.storage_key)
        AND NOT EXISTS (SELECT 1 FROM vault_indexes v WHERE v.storage_key = m.storage_key)
      RETURNING m.storage_key`
  )
  // Downgrade: Super Safe beendet → Mitgliedschaft in Zusatz-Paketen beenden (das Basis-Paket bleibt)
  const released = await db.query(
    `UPDATE foc_members m SET deleted_at = now()
       FROM foc_packs p
      WHERE p.id = m.pack_id AND p.kind = 'extra' AND m.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM (${LIVE_KEYS}) l JOIN (${SUPER_SAFE_ACCOUNTS}) ss ON ss.account_id = l.account_id
                         WHERE l.storage_key = m.storage_key)
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
  return { marked: marked.length, released: released.length, removed }
}

/** Schnelle Kopie von Datei-Pieces entfernen, die sicher auf Filecoin liegen (optional). */
async function evict(db: Db, storage: StorageProvider, s: FocSettings): Promise<number> {
  if (s.evictAfterHours === null) return 0
  const rows = await db.query<{ storage_key: string }>(
    `SELECT m.storage_key FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id
      WHERE p.state = 'stored' AND p.kind = 'base' AND jsonb_array_length(p.copies) >= $1
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

const due = (s: FocSettings, bytes: number, oldest: string | null, force: boolean) =>
  force || bytes >= s.packMinMb * MB || (!!oldest && (Date.now() - new Date(oldest).getTime()) / 3_600_000 >= s.packMaxWaitHours)

/** Auswahl nach den in der DB bekannten Größen, höchstens packMaxMb. */
function choose(s: FocSettings, candidates: Array<{ storage_key: string; bytes: number }>): Array<{ key: string; bytes: number }> {
  const max = s.packMaxMb * MB
  const chosen: Array<{ key: string; bytes: number }> = []
  let planned = 0
  for (const c of candidates) {
    const b = Number(c.bytes)
    if (planned + b > max && chosen.length) break
    chosen.push({ key: c.storage_key, bytes: b })
    planned += b
  }
  return chosen
}

/** Keys direkt in einen Puffer lesen (kein Doppel-RAM), hochladen und Paket samt Mitgliedern festhalten. */
async function uploadPack(
  db: Db,
  storage: StorageProvider,
  s: FocSettings,
  backend: FocBackend,
  chosen: Array<{ key: string; bytes: number }>,
  kind: 'base' | 'extra',
  opts: UploadOptions
): Promise<PackResult | undefined> {
  if (!chosen.length) return undefined
  const planned = chosen.reduce((n, c) => n + c.bytes, 0)
  const buf = new Uint8Array(Math.max(planned, MIN_PIECE))
  const members: Array<{ key: string; offset: number; length: number; sha256: Buffer }> = []
  let off = 0
  for (const c of chosen) {
    const got = await readInto(storage, c.key, buf, off, c.bytes)
    if (got !== c.bytes) continue // fehlt oder Größe passt nicht → später erneut
    members.push({ key: c.key, offset: off, length: got, sha256: createHash('sha256').update(buf.subarray(off, off + got)).digest() })
    off += got
  }
  if (!members.length) return undefined
  const pack = off === buf.byteLength ? buf : buf.subarray(0, Math.max(off, MIN_PIECE))

  const { pieceCid, copies } = await backend.upload(pack, opts)
  const packId = randomUUID()
  await db.tx(async tx => {
    await tx.query(
      `INSERT INTO foc_packs (id, network, state, bytes, piece_cid, copies, kind) VALUES ($1, $2, 'stored', $3, $4, $5, $6)`,
      [packId, s.network, pack.byteLength, pieceCid, JSON.stringify(copies), kind]
    )
    // evicted_at übernehmen: Ist die schnelle Kopie schon weg, gilt das für jede Mitgliedschaft des Keys
    await tx.query(
      `INSERT INTO foc_members (storage_key, pack_id, byte_offset, byte_length, sha256, evicted_at)
       SELECT k, $1, o, l, decode(h, 'hex'), (SELECT max(x.evicted_at) FROM foc_members x WHERE x.storage_key = k AND x.deleted_at IS NULL)
         FROM unnest($2::text[], $3::bigint[], $4::bigint[], $5::text[]) AS t(k, o, l, h)
       ON CONFLICT DO NOTHING`,
      [packId, members.map(m => m.key), members.map(m => m.offset), members.map(m => m.length), members.map(m => m.sha256.toString('hex'))]
    )
  })
  if (kind === 'base') {
    await updateFocState(db, st => {
      st.dataSets[dataSetKey(s.network, s.payer)] = [...new Set(copies.map(c => c.dataSetId))]
    })
  }
  return { keys: members.length, bytes: pack.byteLength, pieceCid, copies: copies.length, requested: opts.copies }
}

/** Nächstes Basis-Paket bilden und mit den Standard-Kopien hochladen (höchstens eines pro Lauf). */
async function packAndUpload(db: Db, storage: StorageProvider, s: FocSettings, backend: FocBackend, force: boolean): Promise<PackResult | undefined> {
  const backlog = await focBacklog(db)
  if (!backlog.keys || !due(s, backlog.bytes, backlog.oldest, force)) return undefined
  const candidates = await db.query<{ storage_key: string; bytes: number }>(
    `SELECT storage_key, bytes FROM (${LIVE_KEYS}) l WHERE ${NOT_BASED} ORDER BY since, storage_key LIMIT 2000`
  )
  return uploadPack(db, storage, s, backend, choose(s, candidates), 'base', { copies: s.copies, excludeProviderIds: [] })
}

/**
 * Super Safe: Keys mit zu wenigen Kopien bekommen ein Zusatz-Paket mit den fehlenden Kopien –
 * bei Anbietern, die den Key noch nicht haben (höchstens eines pro Lauf, gleiche Lücke je Paket).
 */
async function packExtra(db: Db, storage: StorageProvider, s: FocSettings, backend: FocBackend, force: boolean): Promise<PackResult | undefined> {
  const target = (await getPricing(db)).superSafe.copies
  if (target <= s.copies) return undefined
  const all = await extraCandidates(db, s, target, 2000)
  if (!all.length) return undefined
  const oldest = all[0].since
  if (!due(s, all.reduce((n, c) => n + Number(c.bytes), 0), oldest, force)) return undefined
  const missing = Number(all[0].missing)
  const chosen = choose(s, all.filter(c => Number(c.missing) === missing))
  const holders = await db.query<{ id: string }>(
    `SELECT DISTINCT c->>'providerId' AS id
       FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id, jsonb_array_elements(p.copies) c
      WHERE m.storage_key = ANY($1::text[]) AND m.deleted_at IS NULL AND p.state = 'stored' ORDER BY 1`,
    [chosen.map(c => c.key)]
  )
  return uploadPack(db, storage, s, backend, chosen, 'extra', { copies: missing, excludeProviderIds: holders.map(h => h.id) })
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
  const empty: FocSyncResult = { ran: false, message: '', markedDeleted: 0, released: 0, removedPacks: 0, evicted: 0 }
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
    const parts: string[] = []
    let ok = true
    const mib = (b: number) => `${(b / MB).toFixed(1)} MiB`
    const short = (p: PackResult) => (p.copies < p.requested ? ` Achtung: nur ${p.copies} von ${p.requested} Kopien bestätigt.` : '')
    const packed = await packAndUpload(db, storage, s, backend, !!opts.force)
    if (packed) {
      parts.push(`${packed.keys} Teile (${mib(packed.bytes)}) als ${packed.copies} Kopien gesichert.${short(packed)}`)
      ok &&= packed.copies >= packed.requested
      await audit(db, null, 'system', 'foc.pack_stored', { ...packed })
    }
    // Super Safe getrennt behandeln: ein Fehler hier darf das Basis-Paket nicht verdecken
    let extra: PackResult | undefined
    try {
      extra = await packExtra(db, storage, s, backend, !!opts.force)
      if (extra) {
        parts.push(`Super Safe: ${extra.keys} Teile (${mib(extra.bytes)}) um ${extra.copies} Kopien ergänzt.${short(extra)}`)
        ok &&= extra.copies >= extra.requested
        await audit(db, null, 'system', 'foc.extra_pack_stored', { ...extra })
      }
    } catch (e) {
      ok = false
      parts.push(`Super Safe fehlgeschlagen: ${(e as Error).message.split('\n')[0].slice(0, 300)}`)
    }
    if (del.released) parts.push(`${del.released} Zusatzkopien freigegeben (Super Safe beendet).`)
    const message = parts.join(' ') || 'Nichts hochzuladen.'
    await updateFocState(db, st => void (st.lastRun = { at: new Date().toISOString(), ok, message }))
    invalidateFocHealth()
    return { ran: true, message, packed, extra, markedDeleted: del.marked, released: del.released, removedPacks: del.removed, evicted }
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
       FROM foc_members m JOIN foc_packs p ON p.id = m.pack_id WHERE p.state = 'stored' AND p.kind = 'base'`
  )
  const byState = Object.fromEntries(rows.map(r => [r.state, { packs: Number(r.n), bytes: Number(r.b) }]))
  const m = members[0]
  return {
    packs: byState as Record<string, { packs: number; bytes: number }>,
    liveKeys: Number(m?.live ?? 0),
    liveBytes: Number(m?.live_b ?? 0),
    deadBytes: Number(m?.dead_b ?? 0),
    evictedKeys: Number(m?.evicted ?? 0),
    backlog: await focBacklog(db),
    superSafe: await focExtraBacklog(db)
  }
}
