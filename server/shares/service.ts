import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { DownloadResult } from '../../lib/api-types'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid } from '../shared/ids'
import { policyFor } from '../team/service'

const DOWNLOAD_URL_TTL_SEC = 15 * 60
const MAX_ACTIVE_SHARES = 500
const MAX_ITEMS = 100

/**
 * Secure Send: ein Link für eine oder mehrere gespeicherte Dateien (keine Kopien). Name, Typ und
 * Datei-Schlüssel stehen verschlüsselt in `meta` – der Schlüssel dazu nur im URL-Fragment.
 */
export const createShareSchema = z
  .object({
    /** eine Datei (ältere Clients) … */
    objectId: z.string().uuid().optional(),
    /** … oder mehrere, in dieser Reihenfolge */
    objectIds: z.array(z.string().uuid()).max(MAX_ITEMS).optional(),
    /** mit dem Link-Schlüssel verschlüsselte Metadaten, base64 */
    meta: z.string().min(20).max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/),
    /** verschlüsselter Inhalt (z. B. Notiz) – erst beim gezählten Abruf ausgeliefert, base64 */
    payload: z.string().min(20).max(400_000).regex(/^[A-Za-z0-9+/=]+$/).optional(),
    expiresInHours: z.number().int().min(1).max(24 * 365).nullable(),
    maxDownloads: z.number().int().min(1).max(1000).nullable()
  })
  .refine(v => !(v.objectId && v.objectIds), { message: 'objectId oder objectIds angeben' })
  .refine(v => !!v.objectId || (v.objectIds?.length ?? 0) > 0 || !!v.payload, { message: 'Datei oder Inhalt erforderlich' })

export interface ShareSummary {
  id: string
  objectId: string | null
  objectIds: string[]
  /** enthält einen Inhalt (Notiz) */
  hasPayload: boolean
  createdAt: string
  expiresAt: string | null
  maxDownloads: number | null
  downloads: number
  active: boolean
}

export interface PublicShare {
  objectId: string | null
  objectIds: string[]
  hasPayload: boolean
  meta: string
  expiresAt: string | null
  remaining: number | null
}

interface ShareRow {
  id: string
  account_id: string
  meta: Uint8Array
  expires_at: string | null
  max_downloads: number | null
  downloads: number
  created_at: string
  revoked_at: string | null
  object_ids: string[]
  stored: number
  has_payload: boolean
}

function isActive(r: ShareRow): boolean {
  if (r.revoked_at || (Number(r.stored) === 0 && !r.has_payload)) return false
  if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) return false
  return r.max_downloads === null || r.downloads < r.max_downloads
}

function summary(r: ShareRow): ShareSummary {
  return {
    id: r.id,
    objectId: r.object_ids[0] ?? null,
    objectIds: r.object_ids,
    hasPayload: !!r.has_payload,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    maxDownloads: r.max_downloads,
    downloads: Number(r.downloads),
    active: isActive(r)
  }
}

const SELECT = `
  SELECT s.id, s.account_id, s.meta, s.expires_at, s.max_downloads, s.downloads, s.created_at, s.revoked_at,
         coalesce(array_remove(array_agg(i.object_id::text ORDER BY i.position), NULL), '{}') AS object_ids,
         count(o.id) FILTER (WHERE o.state = 'stored')::float8 AS stored,
         (s.payload IS NOT NULL) AS has_payload
    FROM shares s LEFT JOIN share_items i ON i.share_id = s.id LEFT JOIN objects o ON o.id = i.object_id`
const GROUP = `GROUP BY s.id, s.account_id, s.meta, s.expires_at, s.max_downloads, s.downloads, s.created_at, s.revoked_at, s.payload`

/** 16 Zufallsbytes → nicht erratbare Link-ID (die ID allein entschlüsselt nichts). */
function newId(): string {
  return randomBytes(16).toString('base64url')
}

export async function createShare(deps: Deps, session: SessionInfo, input: z.output<typeof createShareSchema>): Promise<ShareSummary> {
  const ids = input.objectIds ?? (input.objectId ? [input.objectId] : [])
  if (!ids.length && !input.payload) throw new ApiError('BAD_REQUEST', 'Datei oder Inhalt erforderlich.')
  const policy = await policyFor(deps.db, session.accountId)
  if (policy && !policy.allowShareLinks) throw new ApiError('FORBIDDEN', 'Secure-Send-Links sind in deinem Team per Richtlinie deaktiviert.')
  if (policy?.maxShareDays && (input.expiresInHours === null || input.expiresInHours > policy.maxShareDays * 24)) {
    throw new ApiError('FORBIDDEN', `Richtlinie deines Teams: Links höchstens ${policy.maxShareDays} Tage gültig.`)
  }
  if (new Set(ids).size !== ids.length) throw new ApiError('BAD_REQUEST', 'Dateien doppelt ausgewählt.')
  const owned = await deps.db.query<{ id: string }>(
    `SELECT id FROM objects WHERE id = ANY($1::uuid[]) AND owner_account_id = $2 AND state = 'stored'`,
    [ids, session.accountId]
  )
  if (owned.length !== ids.length) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const count = await deps.db.query<{ n: number }>(
    `SELECT count(*)::float8 AS n FROM shares WHERE account_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [session.accountId]
  )
  if (Number(count[0]?.n ?? 0) >= MAX_ACTIVE_SHARES) throw new ApiError('BAD_REQUEST', 'Zu viele aktive Links – bitte alte widerrufen.')
  const id = newId()
  await deps.db.tx(async tx => {
    await tx.query(
      `INSERT INTO shares (id, account_id, object_id, meta, expires_at, max_downloads, payload)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() + make_interval(hours => $5::int) END, $6, $7)`,
      [
        id,
        session.accountId,
        ids[0] ?? null,
        Buffer.from(input.meta, 'base64'),
        input.expiresInHours,
        input.maxDownloads,
        input.payload ? Buffer.from(input.payload, 'base64') : null
      ]
    )
    await tx.query(
      `INSERT INTO share_items (share_id, position, object_id) SELECT $1, p - 1, o FROM unnest($2::uuid[]) WITH ORDINALITY AS t(o, p)`,
      [id, ids]
    )
  })
  await audit(deps.db, session.accountId, 'user', 'share.created', { files: ids.length, note: !!input.payload, expiresInHours: input.expiresInHours, maxDownloads: input.maxDownloads })
  const rows = await deps.db.query<ShareRow>(`${SELECT} WHERE s.id = $1 ${GROUP}`, [id])
  return summary(rows[0])
}

export async function listShares(deps: Deps, session: SessionInfo, objectId?: string): Promise<ShareSummary[]> {
  if (objectId && !isUuid(objectId)) return []
  const rows = await deps.db.query<ShareRow>(
    `${SELECT} WHERE s.account_id = $1 ${objectId ? 'AND EXISTS (SELECT 1 FROM share_items x WHERE x.share_id = s.id AND x.object_id = $2)' : ''}
      ${GROUP} ORDER BY s.created_at DESC LIMIT 200`,
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
  const rows = await deps.db.query<ShareRow>(`${SELECT} WHERE s.id = $1 ${GROUP}`, [id])
  const r = rows[0]
  if (!r) throw new ApiError('NOT_FOUND', 'Link nicht gefunden.')
  if (!isActive(r)) throw new ApiError('GONE', 'Dieser Link ist abgelaufen oder wurde widerrufen.')
  return r
}

/** Öffentlich: verschlüsselte Metadaten – ohne den Schlüssel im Fragment wertlos. */
export async function publicShare(deps: Deps, id: string): Promise<PublicShare> {
  const r = await loadPublic(deps, id)
  return {
    objectId: r.object_ids[0] ?? null,
    objectIds: r.object_ids,
    hasPayload: !!r.has_payload,
    meta: Buffer.from(r.meta).toString('base64'),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    remaining: r.max_downloads === null ? null : r.max_downloads - Number(r.downloads)
  }
}

/**
 * Download starten: zählt serverseitig einmal pro Abruf (auch bei mehreren Dateien) und liefert
 * die Abruf-URLs aller noch vorhandenen Dateien. Einmal-Links gelten global, nicht pro Gerät.
 */
export async function startShareDownload(
  deps: Deps,
  id: string
): Promise<DownloadResult & { items: Array<{ objectId: string } & DownloadResult>; payload?: string }> {
  const r = await loadPublic(deps, id)
  const upd = await deps.db.query(
    `UPDATE shares SET downloads = downloads + 1
      WHERE id = $1 AND revoked_at IS NULL AND (max_downloads IS NULL OR downloads < max_downloads)
        AND (expires_at IS NULL OR expires_at > now()) RETURNING id`,
    [id]
  )
  if (!upd.length) throw new ApiError('GONE', 'Dieser Link ist abgelaufen oder wurde widerrufen.')
  const pieces = await deps.db.query<{ object_id: string; piece_index: number; storage_key: string; cipher_bytes: number }>(
    `SELECT op.object_id, op.piece_index, op.storage_key, op.cipher_bytes::float8 AS cipher_bytes
       FROM object_pieces op JOIN objects o ON o.id = op.object_id
      WHERE op.object_id = ANY($1::uuid[]) AND o.state = 'stored' ORDER BY op.object_id, op.piece_index`,
    [r.object_ids]
  )
  await audit(deps.db, r.account_id, 'system', 'share.downloaded', { files: r.object_ids.length })
  const presign = async (p: (typeof pieces)[number]) => ({
    index: Number(p.piece_index),
    cipherBytes: Number(p.cipher_bytes),
    ...(await deps.storage.presignGet(p.storage_key, DOWNLOAD_URL_TTL_SEC))
  })
  const items = await Promise.all(
    r.object_ids.map(async objectId => ({ objectId, pieces: await Promise.all(pieces.filter(p => p.object_id === objectId).map(presign)) }))
  )
  // `pieces` der ersten Datei für ältere Empfängerseiten
  let payload: string | undefined
  if (r.has_payload) {
    const p = await deps.db.query<{ payload: Uint8Array }>('SELECT payload FROM shares WHERE id = $1', [id])
    payload = Buffer.from(p[0].payload).toString('base64')
  }
  return { pieces: items[0]?.pieces ?? [], items: items.filter(i => i.pieces.length), ...(payload ? { payload } : {}) }
}
