import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { DownloadResult } from '../../lib/api-types'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid } from '../shared/ids'

const DOWNLOAD_URL_TTL_SEC = 15 * 60
const MAX_ACTIVE_SHARES = 500

export const createShareSchema = z.object({
  objectId: z.string().uuid(),
  /** mit dem Link-Schlüssel verschlüsselte Metadaten (Name, Typ, Größe, Datei-Schlüssel), base64 */
  meta: z.string().min(20).max(96_000).regex(/^[A-Za-z0-9+/=]+$/),
  expiresInHours: z.number().int().min(1).max(24 * 365).nullable(),
  maxDownloads: z.number().int().min(1).max(1000).nullable()
})

export interface ShareSummary {
  id: string
  objectId: string
  createdAt: string
  expiresAt: string | null
  maxDownloads: number | null
  downloads: number
  active: boolean
}

export interface PublicShare {
  objectId: string
  meta: string
  expiresAt: string | null
  remaining: number | null
}

interface ShareRow {
  id: string
  object_id: string
  account_id: string
  meta: Uint8Array
  expires_at: string | null
  max_downloads: number | null
  downloads: number
  created_at: string
  revoked_at: string | null
  object_state: string
}

function isActive(r: ShareRow): boolean {
  if (r.revoked_at || r.object_state !== 'stored') return false
  if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) return false
  return r.max_downloads === null || r.downloads < r.max_downloads
}

function summary(r: ShareRow): ShareSummary {
  return {
    id: r.id,
    objectId: r.object_id,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    maxDownloads: r.max_downloads,
    downloads: Number(r.downloads),
    active: isActive(r)
  }
}

const SELECT = `SELECT s.*, o.state AS object_state FROM shares s JOIN objects o ON o.id = s.object_id`

/** 16 Zufallsbytes → nicht erratbare Link-ID (die ID allein entschlüsselt nichts). */
function newId(): string {
  return randomBytes(16).toString('base64url')
}

export async function createShare(deps: Deps, session: SessionInfo, input: z.output<typeof createShareSchema>): Promise<ShareSummary> {
  const obj = await deps.db.query<{ state: string }>('SELECT state FROM objects WHERE id = $1 AND owner_account_id = $2', [
    input.objectId,
    session.accountId
  ])
  if (obj[0]?.state !== 'stored') throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const count = await deps.db.query<{ n: number }>(
    `SELECT count(*)::float8 AS n FROM shares WHERE account_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [session.accountId]
  )
  if (Number(count[0]?.n ?? 0) >= MAX_ACTIVE_SHARES) throw new ApiError('BAD_REQUEST', 'Zu viele aktive Links – bitte alte widerrufen.')
  const id = newId()
  await deps.db.query(
    `INSERT INTO shares (id, account_id, object_id, meta, expires_at, max_downloads)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() + make_interval(hours => $5::int) END, $6)`,
    [id, session.accountId, input.objectId, Buffer.from(input.meta, 'base64'), input.expiresInHours, input.maxDownloads]
  )
  await audit(deps.db, session.accountId, 'user', 'share.created', { expiresInHours: input.expiresInHours, maxDownloads: input.maxDownloads })
  const rows = await deps.db.query<ShareRow>(`${SELECT} WHERE s.id = $1`, [id])
  return summary(rows[0])
}

export async function listShares(deps: Deps, session: SessionInfo, objectId?: string): Promise<ShareSummary[]> {
  if (objectId && !isUuid(objectId)) return []
  const rows = await deps.db.query<ShareRow>(
    `${SELECT} WHERE s.account_id = $1 ${objectId ? 'AND s.object_id = $2' : ''} ORDER BY s.created_at DESC LIMIT 200`,
    objectId ? [session.accountId, objectId] : [session.accountId]
  )
  return rows.map(summary)
}

export async function revokeShare(deps: Deps, session: SessionInfo, id: string): Promise<void> {
  const rows = await deps.db.query(
    `UPDATE shares SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING id`,
    [id, session.accountId]
  )
  if (!rows.length) throw new ApiError('NOT_FOUND', 'Link nicht gefunden.')
  await audit(deps.db, session.accountId, 'user', 'share.revoked')
}

async function loadPublic(deps: Deps, id: string): Promise<ShareRow> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new ApiError('NOT_FOUND', 'Link nicht gefunden.')
  const rows = await deps.db.query<ShareRow>(`${SELECT} WHERE s.id = $1`, [id])
  const r = rows[0]
  if (!r) throw new ApiError('NOT_FOUND', 'Link nicht gefunden.')
  if (!isActive(r)) throw new ApiError('GONE', 'Dieser Link ist abgelaufen oder wurde widerrufen.')
  return r
}

/** Öffentlich: verschlüsselte Metadaten – ohne den Schlüssel im Fragment wertlos. */
export async function publicShare(deps: Deps, id: string): Promise<PublicShare> {
  const r = await loadPublic(deps, id)
  return {
    objectId: r.object_id,
    meta: Buffer.from(r.meta).toString('base64'),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    remaining: r.max_downloads === null ? null : r.max_downloads - Number(r.downloads)
  }
}

/** Download starten: zählt serverseitig (Einmal-Links gelten global, nicht pro Gerät). */
export async function startShareDownload(deps: Deps, id: string): Promise<DownloadResult> {
  const r = await loadPublic(deps, id)
  const upd = await deps.db.query(
    `UPDATE shares SET downloads = downloads + 1
      WHERE id = $1 AND revoked_at IS NULL AND (max_downloads IS NULL OR downloads < max_downloads)
        AND (expires_at IS NULL OR expires_at > now()) RETURNING id`,
    [id]
  )
  if (!upd.length) throw new ApiError('GONE', 'Dieser Link ist abgelaufen oder wurde widerrufen.')
  const pieces = await deps.db.query<{ piece_index: number; storage_key: string; cipher_bytes: number }>(
    `SELECT piece_index, storage_key, cipher_bytes::float8 AS cipher_bytes FROM object_pieces WHERE object_id = $1 ORDER BY piece_index`,
    [r.object_id]
  )
  await audit(deps.db, r.account_id, 'system', 'share.downloaded')
  return {
    pieces: await Promise.all(
      pieces.map(async p => ({
        index: Number(p.piece_index),
        cipherBytes: Number(p.cipher_bytes),
        ...(await deps.storage.presignGet(p.storage_key, DOWNLOAD_URL_TTL_SEC))
      }))
    )
  }
}
