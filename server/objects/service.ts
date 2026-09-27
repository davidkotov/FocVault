import { z } from 'zod'
import type { CreateObjectResult, DownloadResult, PresignedPiece } from '../../lib/api-types'
import { ACCOUNT_PIECE_SIZE, streamCipherPlan } from '../../lib/crypto'
import { formatBytes } from '../../lib/vault'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'
import type { SessionInfo } from '../auth/sessions'
import { usedBytes } from '../accounts/plans'
import { quotaFor } from '../billing/quota'
import { getPricing } from '../billing/settings'
import { objectPieceKey } from '../storage/provider'
import { assertFocWritable } from '../foc/health'
import { pooledUsedBytes } from '../family/service'
import { spaceOwnerOf } from '../family/space'

const UPLOAD_URL_TTL_SEC = 60 * 60
const DOWNLOAD_URL_TTL_SEC = 15 * 60
/** 160 000 Pieces à 32 MiB ≈ 5 TiB pro Datei (wie S3) */
const MAX_PIECES = 160_000
/** Upload-URLs werden in Etappen ausgestellt; der Client holt weitere über /urls. */
const PRESIGN_FIRST = 64
/** Größtes erlaubtes Ciphertext-Piece (volles Piece inkl. Frame-Header und GCM-Tags). */
export const MAX_PIECE_CIPHER_BYTES = streamCipherPlan(ACCOUNT_PIECE_SIZE).paddedSize

export const createObjectSchema = z
  .object({
    fmt: z.literal('frame2'),
    /** in den Familienordner (nur Family-Mitglieder) */
    space: z.boolean().optional(),
    pieces: z
      .array(
        z.object({
          index: z.number().int().min(0),
          cipherBytes: z.number().int().min(1).max(MAX_PIECE_CIPHER_BYTES)
        })
      )
      .min(1)
      .max(MAX_PIECES)
  })
  .refine(v => v.pieces.every((p, i) => p.index === i), {
    message: 'Pieces müssen lückenlos ab 0 nummeriert sein',
    path: ['pieces']
  })

export const refreshUrlsSchema = z.object({ pieces: z.array(z.number().int().min(0)).min(1).max(256) })

interface ObjectRow {
  id: string
  state: 'uploading' | 'stored' | 'version' | 'trashed' | 'failed' | 'deleted'
  cipher_bytes: number
  owner_account_id?: string
}

/** Eigene Objekte; mit `allowSpace` auch Objekte im Familienordner der eigenen Familie. */
async function loadOwned(deps: Deps, session: SessionInfo, objectId: string, allowSpace = false): Promise<ObjectRow> {
  if (!isUuid(objectId)) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const space = allowSpace ? await spaceOwnerOf(deps.db, session.accountId) : null
  const rows = await deps.db.query<ObjectRow>(
    `SELECT id, state, cipher_bytes::float8 AS cipher_bytes, owner_account_id FROM objects
      WHERE id = $1 AND (owner_account_id = $2 OR ($3::uuid IS NOT NULL AND space_owner = $3::uuid))`,
    [objectId, session.accountId, space]
  )
  if (!rows[0] || rows[0].state === 'deleted') throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  return { ...rows[0], cipher_bytes: Number(rows[0].cipher_bytes) }
}

async function pieceRows(deps: Deps, objectId: string) {
  const rows = await deps.db.query<{ piece_index: number; storage_key: string; cipher_bytes: number }>(
    `SELECT piece_index, storage_key, cipher_bytes::float8 AS cipher_bytes
       FROM object_pieces WHERE object_id = $1 ORDER BY piece_index`,
    [objectId]
  )
  return rows.map(r => ({ index: Number(r.piece_index), key: r.storage_key, cipherBytes: Number(r.cipher_bytes) }))
}

/** Uploads, die länger als 24 h hängen, freigeben (Fil One hat keine Lifecycle-Regeln). */
async function releaseStaleUploads(deps: Deps, accountId: string): Promise<void> {
  const stale = await deps.db.query<{ id: string }>(
    `SELECT id FROM objects WHERE owner_account_id = $1 AND state = 'uploading'
        AND created_at < now() - interval '24 hours'`,
    [accountId]
  )
  for (const { id } of stale) {
    const pieces = await pieceRows(deps, id)
    await deps.storage.delete(pieces.map(p => p.key)).catch(() => undefined)
    await deps.db.query(`UPDATE objects SET state = 'failed' WHERE id = $1 AND state = 'uploading'`, [id])
  }
}

/**
 * Legt ein Objekt an und reserviert Quota (Ciphertext-Bytes). Die Objekt-ID wird vor der
 * Verschlüsselung vergeben, weil sie in die AAD jedes Frames eingeht (frame2).
 */
export async function createObject(
  deps: Deps,
  session: SessionInfo,
  input: z.output<typeof createObjectSchema>
): Promise<CreateObjectResult> {
  await releaseStaleUploads(deps, session.accountId)
  await assertFocWritable(deps.db)
  const spaceOwner = input.space ? await spaceOwnerOf(deps.db, session.accountId) : null
  if (input.space && !spaceOwner) throw new ApiError('PLAN_REQUIRED', 'Den Familienordner gibt es mit Family.')
  const total = input.pieces.reduce((n, p) => n + p.cipherBytes, 0)
  const objectId = uuidv7()
  await deps.db.tx(async tx => {
    // Zeilensperre auf dem Konto serialisiert parallele Uploads → Quota kann nicht überbucht werden.
    const acc = await tx.query<{
      id: string
      plan: SessionInfo['plan']
      status: string
      payg_enabled: boolean
      payg_cap_gb: number | null
    }>('SELECT id, plan, status, payg_enabled, payg_cap_gb FROM accounts WHERE id = $1 FOR UPDATE', [session.accountId])
    if (!acc[0]) throw new ApiError('UNAUTHENTICATED', 'Konto nicht gefunden.')
    if (acc[0].status !== 'active') throw new ApiError('FORBIDDEN', 'Konto ist schreibgeschützt.')
    const { quotaBytes: quota } = await quotaFor(tx, acc[0], await getPricing(tx))
    const used = await pooledUsedBytes(tx, session.accountId)
    if (used + total > quota) {
      const free = Math.max(0, quota - used)
      const hint =
        acc[0].plan === 'free'
          ? acc[0].payg_enabled
            ? ' Erhöhe deine Pay-as-you-go-Grenze oder wechsle zu Pro.'
            : ' Mehr Platz: Pay-as-you-go aktivieren oder zu Pro wechseln.'
          : ' Mehr Platz: Zusatzspeicher buchen.'
      throw new ApiError(
        'QUOTA_EXCEEDED',
        `Nicht genug Speicher: ${formatBytes(free)} frei, ${formatBytes(total)} benötigt.${hint}`,
        { freeBytes: free, neededBytes: total, plan: acc[0].plan }
      )
    }
    await tx.query(
      `INSERT INTO objects (id, owner_account_id, state, fmt, cipher_bytes, piece_count, space_owner)
       VALUES ($1, $2, 'uploading', $3, $4, $5, $6)`,
      [objectId, session.accountId, input.fmt, total, input.pieces.length, spaceOwner]
    )
    await tx.query(
      `INSERT INTO object_pieces (object_id, piece_index, storage_key, cipher_bytes)
       SELECT $1, i, k, b FROM unnest($2::int[], $3::text[], $4::bigint[]) AS t(i, k, b)`,
      [
        objectId,
        input.pieces.map(p => p.index),
        input.pieces.map(p => objectPieceKey(session.accountId, objectId, p.index)),
        input.pieces.map(p => p.cipherBytes)
      ]
    )
  })
  const pieces = await presignUploads(
    deps,
    input.pieces.slice(0, PRESIGN_FIRST).map(p => ({ index: p.index, key: objectPieceKey(session.accountId, objectId, p.index), cipherBytes: p.cipherBytes }))
  )
  await audit(deps.db, session.accountId, 'user', 'object.upload_started', { pieces: input.pieces.length, bytes: total })
  return { objectId, pieces }
}

async function presignUploads(
  deps: Deps,
  pieces: Array<{ index: number; key: string; cipherBytes: number }>
): Promise<PresignedPiece[]> {
  return Promise.all(
    pieces.map(async p => ({ index: p.index, ...(await deps.storage.presignPut(p.key, p.cipherBytes, UPLOAD_URL_TTL_SEC)) }))
  )
}

/** Neue Upload-URLs, falls ein langer Upload die ursprüngliche Gültigkeit überschreitet. */
export async function refreshUploadUrls(
  deps: Deps,
  session: SessionInfo,
  objectId: string,
  indices: number[]
): Promise<{ pieces: PresignedPiece[] }> {
  const obj = await loadOwned(deps, session, objectId)
  if (obj.state !== 'uploading') throw new ApiError('BAD_REQUEST', 'Dieser Upload ist nicht mehr aktiv.')
  const wanted = new Set(indices)
  const pieces = (await pieceRows(deps, objectId)).filter(p => wanted.has(p.index))
  return { pieces: await presignUploads(deps, pieces) }
}

/**
 * Schließt einen Upload ab: jedes Piece muss im Storage mit exakt der angekündigten Größe
 * liegen. Erst dann zählt das Objekt als gespeichert und wird im Usage-Ledger gebucht.
 */
export async function completeObject(
  deps: Deps,
  session: SessionInfo,
  objectId: string
): Promise<{ state: 'stored'; cipherBytes: number }> {
  const obj = await loadOwned(deps, session, objectId)
  if (obj.state === 'stored') return { state: 'stored', cipherBytes: obj.cipher_bytes }
  if (obj.state !== 'uploading') throw new ApiError('BAD_REQUEST', 'Dieser Upload ist nicht mehr aktiv.')
  const pieces = await pieceRows(deps, objectId)
  for (const p of pieces) {
    const head = await deps.storage.head(p.key)
    if (!head || head.size !== p.cipherBytes) {
      throw new ApiError('UPLOAD_SIZE_MISMATCH', `Teil ${p.index + 1} von ${pieces.length} ist unvollständig.`, {
        pieceIndex: p.index,
        expected: p.cipherBytes,
        actual: head?.size ?? null
      })
    }
  }
  await deps.db.tx(async tx => {
    const updated = await tx.query(
      `UPDATE objects SET state = 'stored', stored_at = now() WHERE id = $1 AND state = 'uploading' RETURNING id`,
      [objectId]
    )
    if (!updated.length) return
    await tx.query(
      `INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'store', $3)`,
      [session.accountId, obj.cipher_bytes, objectId]
    )
    await audit(tx, session.accountId, 'user', 'object.stored', { bytes: obj.cipher_bytes, pieces: pieces.length })
  })
  return { state: 'stored', cipherBytes: obj.cipher_bytes }
}

export async function downloadObject(deps: Deps, session: SessionInfo, objectId: string): Promise<DownloadResult> {
  const obj = await loadOwned(deps, session, objectId, true)
  if (obj.state !== 'stored') throw new ApiError('NOT_FOUND', 'Datei ist nicht (mehr) verfügbar.')
  const pieces = await pieceRows(deps, objectId)
  return {
    pieces: await Promise.all(
      pieces.map(async p => ({
        index: p.index,
        cipherBytes: p.cipherBytes,
        ...(await deps.storage.presignGet(p.key, DOWNLOAD_URL_TTL_SEC))
      }))
    )
  }
}

/** Endgültig löschen: sofort aus dem Storage, Quota frei (auch direkt aus dem Papierkorb). */
export async function deleteObject(deps: Deps, session: SessionInfo, objectId: string): Promise<void> {
  const obj = await loadOwned(deps, session, objectId, true)
  await purgeObject(deps, obj.owner_account_id ?? session.accountId, objectId, obj, 'user')
}

async function purgeObject(deps: Deps, accountId: string, objectId: string, obj: ObjectRow, actor: 'user' | 'system'): Promise<void> {
  const pieces = await pieceRows(deps, objectId)
  await deps.storage.delete(pieces.map(p => p.key))
  await deps.db.tx(async tx => {
    const upd = await tx.query(
      `UPDATE objects SET state = 'deleted', deleted_at = now(), purge_after = NULL WHERE id = $1 AND state <> 'deleted' RETURNING id`,
      [objectId]
    )
    if (!upd.length) return
    if (obj.state === 'stored' || obj.state === 'version' || obj.state === 'trashed') {
      await tx.query(
        `INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'delete', $3)`,
        [accountId, -obj.cipher_bytes, objectId]
      )
    }
    await audit(tx, accountId, actor, actor === 'system' ? 'object.purged' : 'object.deleted', { bytes: obj.cipher_bytes })
  })
}

const PAID_PLANS = new Set(['pro', 'family', 'business'])

export interface TrashItem {
  objectId: string
  trashedAt: string
  purgeAfter: string
}

/**
 * In den Papierkorb (nur Abos): Datei bleibt `trashDays` Tage wiederherstellbar und belegt
 * weiter Speicher (ehrlich angezeigt). Freigabe-Links werden sofort ungültig.
 */
export async function trashObject(deps: Deps, session: SessionInfo, objectId: string): Promise<TrashItem> {
  const obj = await loadOwned(deps, session, objectId)
  const acc = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  if (!PAID_PLANS.has(acc[0]?.plan ?? 'free')) throw new ApiError('PLAN_REQUIRED', 'Den Papierkorb gibt es mit Pro und Family.')
  if (obj.state !== 'stored') throw new ApiError('NOT_FOUND', 'Datei ist nicht (mehr) verfügbar.')
  const days = (await getPricing(deps.db)).trashDays
  const rows = await deps.db.query<{ trashed_at: string; purge_after: string }>(
    `UPDATE objects SET state = 'trashed', trashed_at = now(), purge_after = now() + make_interval(days => $2)
      WHERE id = $1 AND state = 'stored' RETURNING trashed_at, purge_after`,
    [objectId, days]
  )
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Datei ist nicht (mehr) verfügbar.')
  await audit(deps.db, session.accountId, 'user', 'object.trashed', { bytes: obj.cipher_bytes })
  return { objectId, trashedAt: new Date(rows[0].trashed_at).toISOString(), purgeAfter: new Date(rows[0].purge_after).toISOString() }
}

export async function restoreObject(deps: Deps, session: SessionInfo, objectId: string): Promise<void> {
  const obj = await loadOwned(deps, session, objectId)
  if (obj.state !== 'trashed') throw new ApiError('NOT_FOUND', 'Datei liegt nicht im Papierkorb.')
  await deps.db.query(`UPDATE objects SET state = 'stored', trashed_at = NULL, purge_after = NULL WHERE id = $1 AND state = 'trashed'`, [objectId])
  await audit(deps.db, session.accountId, 'user', 'object.restored', { bytes: obj.cipher_bytes })
}

/** Papierkorb des Kontos laut Server – der Client gleicht damit seinen verschlüsselten Index ab. */
export async function listTrash(deps: Deps, session: SessionInfo): Promise<TrashItem[]> {
  const rows = await deps.db.query<{ id: string; trashed_at: string; purge_after: string }>(
    `SELECT id, trashed_at, purge_after FROM objects WHERE owner_account_id = $1 AND state = 'trashed' ORDER BY trashed_at DESC`,
    [session.accountId]
  )
  return rows.map(r => ({ objectId: r.id, trashedAt: new Date(r.trashed_at).toISOString(), purgeAfter: new Date(r.purge_after).toISOString() }))
}

/** Abgelaufene Papierkorb-Einträge endgültig löschen (Hintergrund/Cron). */
export async function purgeExpiredTrash(deps: Deps, limit = 200): Promise<number> {
  const rows = await deps.db.query<{ id: string; owner_account_id: string; cipher_bytes: number }>(
    `SELECT id, owner_account_id, cipher_bytes::float8 AS cipher_bytes FROM objects
      WHERE state IN ('trashed', 'version') AND purge_after <= now() ORDER BY purge_after LIMIT $1`,
    [limit]
  )
  for (const r of rows) {
    await purgeObject(deps, r.owner_account_id, r.id, { id: r.id, state: 'trashed', cipher_bytes: Number(r.cipher_bytes) }, 'system')
  }
  return rows.length
}

async function assertPaid(deps: Deps, session: SessionInfo, what: string): Promise<void> {
  const acc = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  if (!PAID_PLANS.has(acc[0]?.plan ?? 'free')) throw new ApiError('PLAN_REQUIRED', `${what} gibt es mit Pro und Family.`)
}

/** Neue Fassung hochgeladen: die bisherige wird zur Version (Pro/Family), Aufbewahrung laut Preisbuch. */
export async function keepAsVersion(deps: Deps, session: SessionInfo, objectId: string): Promise<{ purgeAfter: string }> {
  await assertPaid(deps, session, 'Dateiversionen')
  const obj = await loadOwned(deps, session, objectId)
  if (obj.state !== 'stored') throw new ApiError('NOT_FOUND', 'Datei ist nicht (mehr) verfügbar.')
  const days = (await getPricing(deps.db)).versions.days
  const rows = await deps.db.query<{ purge_after: string }>(
    `UPDATE objects SET state = 'version', purge_after = now() + make_interval(days => $2)
      WHERE id = $1 AND state = 'stored' RETURNING purge_after`,
    [objectId, days]
  )
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Datei ist nicht (mehr) verfügbar.')
  await audit(deps.db, session.accountId, 'user', 'object.versioned', { bytes: obj.cipher_bytes })
  return { purgeAfter: new Date(rows[0].purge_after).toISOString() }
}

/** Ältere Fassung wiederherstellen: sie wird aktuell, die bisherige aktuelle wird Version. */
export async function promoteVersion(deps: Deps, session: SessionInfo, versionId: string, currentId: string): Promise<void> {
  await assertPaid(deps, session, 'Dateiversionen')
  const v = await loadOwned(deps, session, versionId)
  const cur = await loadOwned(deps, session, currentId)
  if (v.state !== 'version' || cur.state !== 'stored') throw new ApiError('NOT_FOUND', 'Version nicht (mehr) verfügbar.')
  const days = (await getPricing(deps.db)).versions.days
  await deps.db.tx(async tx => {
    await tx.query(`UPDATE objects SET state = 'stored', purge_after = NULL WHERE id = $1 AND state = 'version'`, [versionId])
    await tx.query(`UPDATE objects SET state = 'version', purge_after = now() + make_interval(days => $2) WHERE id = $1 AND state = 'stored'`, [
      currentId,
      days
    ])
  })
  await audit(deps.db, session.accountId, 'user', 'object.version_restored', { bytes: v.cipher_bytes })
}

/** Aufbewahrte Versionen des Kontos laut Server (Abgleich mit dem verschlüsselten Index). */
export async function listVersions(deps: Deps, session: SessionInfo): Promise<Array<{ objectId: string; purgeAfter: string }>> {
  const rows = await deps.db.query<{ id: string; purge_after: string }>(
    `SELECT id, purge_after FROM objects WHERE owner_account_id = $1 AND state = 'version'`,
    [session.accountId]
  )
  return rows.map(r => ({ objectId: r.id, purgeAfter: new Date(r.purge_after).toISOString() }))
}
