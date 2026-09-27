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

const UPLOAD_URL_TTL_SEC = 60 * 60
const DOWNLOAD_URL_TTL_SEC = 15 * 60
/** 10 000 Pieces à 32 MiB ≈ 312 GiB pro Datei */
const MAX_PIECES = 10_000
/** Größtes erlaubtes Ciphertext-Piece (volles Piece inkl. Frame-Header und GCM-Tags). */
export const MAX_PIECE_CIPHER_BYTES = streamCipherPlan(ACCOUNT_PIECE_SIZE).paddedSize

export const createObjectSchema = z
  .object({
    fmt: z.literal('frame2'),
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

export const refreshUrlsSchema = z.object({ pieces: z.array(z.number().int().min(0)).min(1).max(MAX_PIECES) })

interface ObjectRow {
  id: string
  state: 'uploading' | 'stored' | 'failed' | 'deleted'
  cipher_bytes: number
}

async function loadOwned(deps: Deps, session: SessionInfo, objectId: string): Promise<ObjectRow> {
  if (!isUuid(objectId)) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const rows = await deps.db.query<ObjectRow>(
    'SELECT id, state, cipher_bytes::float8 AS cipher_bytes FROM objects WHERE id = $1 AND owner_account_id = $2',
    [objectId, session.accountId]
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
    const used = await usedBytes(tx, session.accountId)
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
      `INSERT INTO objects (id, owner_account_id, state, fmt, cipher_bytes, piece_count)
       VALUES ($1, $2, 'uploading', $3, $4, $5)`,
      [objectId, session.accountId, input.fmt, total, input.pieces.length]
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
    input.pieces.map(p => ({ index: p.index, key: objectPieceKey(session.accountId, objectId, p.index), cipherBytes: p.cipherBytes }))
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
  const obj = await loadOwned(deps, session, objectId)
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

/** Löscht sofort aus dem Storage und gibt die Quota frei (Papierkorb folgt in Phase 2). */
export async function deleteObject(deps: Deps, session: SessionInfo, objectId: string): Promise<void> {
  const obj = await loadOwned(deps, session, objectId)
  const pieces = await pieceRows(deps, objectId)
  await deps.storage.delete(pieces.map(p => p.key))
  await deps.db.tx(async tx => {
    await tx.query(`UPDATE objects SET state = 'deleted', deleted_at = now() WHERE id = $1`, [objectId])
    if (obj.state === 'stored') {
      await tx.query(
        `INSERT INTO usage_ledger (account_id, delta_bytes, reason, object_id) VALUES ($1, $2, 'delete', $3)`,
        [session.accountId, -obj.cipher_bytes, objectId]
      )
    }
    await audit(tx, session.accountId, 'user', 'object.deleted', { bytes: obj.cipher_bytes })
  })
}
