import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { DownloadResult } from '../../lib/api-types'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'
import { getIndex } from '../vault/service'

/**
 * Notfallzugang (digitaler Nachlass). Ablauf:
 *  1. Inhaber (Abo) erstellt eine Einladung mit Wartezeit → Link mit Token.
 *  2. Vertrauensperson (beliebiges Konto) nimmt an; ihr öffentlicher ECDH-Schlüssel ist hinterlegt.
 *  3. Inhaber bestätigt: sein Master-Key wird im Browser für diesen Schlüssel verpackt (Server sieht ihn nie).
 *  4. Vertrauensperson fordert Zugriff an. Nach Ablauf der Wartezeit (oder früherer Freigabe) liefert der
 *     Server die Hülle aus und erlaubt Lesen von Tresor-Index und Dateien. Ablehnen setzt zurück.
 */
const WAIT_OPTIONS = [0, 24, 48, 24 * 7, 24 * 14, 24 * 30] as const
const INVITE_TTL_DAYS = 14
const MAX_CONTACTS = 5
const DOWNLOAD_URL_TTL_SEC = 15 * 60
const PAID = new Set(['pro', 'family', 'business'])

const jwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
})
export const createEmergencySchema = z.object({ waitHours: z.number().int().refine(h => (WAIT_OPTIONS as readonly number[]).includes(h), 'Ungültige Wartezeit') })
export const acceptEmergencySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) })
export const confirmEmergencySchema = z.object({
  wrapped: z.object({ epk: jwk, iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/), ct: z.string().regex(/^[A-Za-z0-9_-]{40,80}$/) })
})

type Status = 'invited' | 'accepted' | 'confirmed' | 'requested'

interface Row {
  id: string
  grantor: string
  grantee: string | null
  wait_hours: number
  status: Status
  wrapped: unknown | null
  requested_at: string | null
  approved_at: string | null
  invite_expires: string | null
  created_at: string
}

export interface EmergencyContact {
  id: string
  /** die andere Seite */
  label: string | null
  status: Status
  waitHours: number
  requestedAt: string | null
  /** ab wann der Zugriff besteht (bei laufender Anforderung) */
  availableAt: string | null
  access: boolean
  inviteExpiresAt: string | null
  createdAt: string
}

export interface EmergencyOverview {
  canGrant: boolean
  asGrantor: Array<EmergencyContact & { granteeId: string | null; granteePublicKey: unknown | null }>
  asGrantee: Array<EmergencyContact & { grantorId: string; wrapped: unknown | null }>
  myPublicKey: unknown | null
}

const hash = (t: string) => createHash('sha256').update(t).digest()

function availableAt(r: Row): Date | null {
  if (r.status !== 'requested' || !r.requested_at) return null
  if (r.approved_at) return new Date(r.approved_at)
  return new Date(new Date(r.requested_at).getTime() + r.wait_hours * 3_600_000)
}

function hasAccess(r: Row, now = Date.now()): boolean {
  const at = availableAt(r)
  return !!at && at.getTime() <= now && !!r.wrapped
}

function base(r: Row, label: string | null): EmergencyContact {
  const at = availableAt(r)
  return {
    id: r.id,
    label,
    status: r.status,
    waitHours: Number(r.wait_hours),
    requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : null,
    availableAt: at ? at.toISOString() : null,
    access: hasAccess(r),
    inviteExpiresAt: r.invite_expires ? new Date(r.invite_expires).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString()
  }
}

async function labelOf(db: Db, id: string | null): Promise<string | null> {
  if (!id) return null
  const r = await db.query<{ email: string | null; label: string | null }>('SELECT email, label FROM accounts WHERE id = $1', [id])
  return r[0]?.email ?? r[0]?.label ?? null
}

async function pubkey(db: Db, id: string | null): Promise<unknown | null> {
  if (!id) return null
  const r = await db.query<{ public_key: unknown }>('SELECT public_key FROM account_pubkeys WHERE account_id = $1', [id])
  return r[0]?.public_key ?? null
}

async function plan(db: Db, id: string): Promise<string> {
  const r = await db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [id])
  return r[0]?.plan ?? 'free'
}

export async function emergencyOverview(deps: Deps, session: SessionInfo): Promise<EmergencyOverview> {
  const rows = await deps.db.query<Row>(
    `SELECT * FROM emergency_contacts WHERE grantor = $1 OR grantee = $1 ORDER BY created_at`,
    [session.accountId]
  )
  const asGrantor = []
  const asGrantee = []
  for (const r of rows) {
    if (r.grantor === session.accountId) {
      if (r.status === 'invited' && r.invite_expires && new Date(r.invite_expires).getTime() < Date.now()) continue
      asGrantor.push({ ...base(r, await labelOf(deps.db, r.grantee)), granteeId: r.grantee, granteePublicKey: r.status === 'accepted' ? await pubkey(deps.db, r.grantee) : null })
    } else {
      asGrantee.push({ ...base(r, await labelOf(deps.db, r.grantor)), grantorId: r.grantor, wrapped: hasAccess(r) ? r.wrapped : null })
    }
  }
  return { canGrant: PAID.has(await plan(deps.db, session.accountId)), asGrantor, asGrantee, myPublicKey: await pubkey(deps.db, session.accountId) }
}

export async function createEmergencyInvite(deps: Deps, session: SessionInfo, input: z.output<typeof createEmergencySchema>): Promise<{ id: string; token: string }> {
  if (!PAID.has(await plan(deps.db, session.accountId))) throw new ApiError('PLAN_REQUIRED', 'Notfallzugang gibt es mit Pro, Family und Business.')
  const n = await deps.db.query<{ n: number }>(
    `SELECT count(*)::float8 AS n FROM emergency_contacts WHERE grantor = $1 AND (status <> 'invited' OR invite_expires > now())`,
    [session.accountId]
  )
  if (Number(n[0]?.n ?? 0) >= MAX_CONTACTS) throw new ApiError('BAD_REQUEST', `Höchstens ${MAX_CONTACTS} Notfallkontakte.`)
  const id = uuidv7()
  const token = randomBytes(24).toString('base64url')
  await deps.db.query(
    `INSERT INTO emergency_contacts (id, grantor, invite_hash, invite_expires, wait_hours, status)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5, 'invited')`,
    [id, session.accountId, hash(token), INVITE_TTL_DAYS, input.waitHours]
  )
  await audit(deps.db, session.accountId, 'user', 'emergency.invited', { contactId: id, waitHours: input.waitHours })
  return { id, token }
}

async function loadInvite(db: Db, token: string): Promise<Row> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new ApiError('NOT_FOUND', 'Einladung nicht gefunden.')
  const r = await db.query<Row>(`SELECT * FROM emergency_contacts WHERE invite_hash = $1 AND status = 'invited' AND invite_expires > now()`, [hash(token)])
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Diese Einladung ist abgelaufen oder wurde schon verwendet.')
  return r[0]
}

export async function emergencyInviteInfo(deps: Deps, token: string): Promise<{ grantorLabel: string | null; waitHours: number }> {
  const r = await loadInvite(deps.db, token)
  return { grantorLabel: await labelOf(deps.db, r.grantor), waitHours: Number(r.wait_hours) }
}

export async function acceptEmergencyInvite(deps: Deps, session: SessionInfo, token: string): Promise<void> {
  const r = await loadInvite(deps.db, token)
  if (r.grantor === session.accountId) throw new ApiError('BAD_REQUEST', 'Du kannst nicht dein eigener Notfallkontakt sein.')
  const dup = await deps.db.query('SELECT 1 FROM emergency_contacts WHERE grantor = $1 AND grantee = $2', [r.grantor, session.accountId])
  if (dup.length) throw new ApiError('BAD_REQUEST', 'Du bist bereits Notfallkontakt für dieses Konto.')
  const upd = await deps.db.query(
    `UPDATE emergency_contacts SET grantee = $2, status = 'accepted', invite_hash = NULL, invite_expires = NULL, updated_at = now()
      WHERE id = $1 AND status = 'invited' AND invite_expires > now() RETURNING id`,
    [r.id, session.accountId]
  )
  if (!upd.length) throw new ApiError('NOT_FOUND', 'Diese Einladung ist abgelaufen oder wurde schon verwendet.')
  await audit(deps.db, r.grantor, 'user', 'emergency.accepted', { contactId: r.id, grantee: session.accountId })
}

async function own(db: Db, session: SessionInfo, id: string, side: 'grantor' | 'grantee'): Promise<Row> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Notfallkontakt nicht gefunden.')
  const r = await db.query<Row>(`SELECT * FROM emergency_contacts WHERE id = $1 AND ${side} = $2`, [id, session.accountId])
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Notfallkontakt nicht gefunden.')
  return r[0]
}

/** Inhaber hinterlegt den für die Vertrauensperson verpackten Master-Key. */
export async function confirmEmergency(deps: Deps, session: SessionInfo, id: string, input: z.output<typeof confirmEmergencySchema>): Promise<void> {
  const r = await own(deps.db, session, id, 'grantor')
  if (r.status !== 'accepted') throw new ApiError('BAD_REQUEST', 'Dieser Kontakt ist bereits bestätigt oder hat noch nicht angenommen.')
  if (!(await pubkey(deps.db, r.grantee))) throw new ApiError('BAD_REQUEST', 'Die Vertrauensperson muss FocVault zuerst einmal öffnen.')
  const upd = await deps.db.query(`UPDATE emergency_contacts SET wrapped = $2, status = 'confirmed', updated_at = now() WHERE id = $1 AND status = 'accepted' RETURNING id`, [id, JSON.stringify(input.wrapped)])
  if (!upd.length) throw new ApiError('BAD_REQUEST', 'Dieser Kontakt ist bereits bestätigt.')
  await audit(deps.db, session.accountId, 'user', 'emergency.confirmed', { contactId: id })
}

export async function requestEmergency(deps: Deps, session: SessionInfo, id: string): Promise<void> {
  const r = await own(deps.db, session, id, 'grantee')
  if (r.status !== 'confirmed') throw new ApiError('BAD_REQUEST', r.status === 'requested' ? 'Zugriff ist bereits angefordert.' : 'Der Inhaber hat den Notfallzugang noch nicht bestätigt.')
  const upd = await deps.db.query(`UPDATE emergency_contacts SET status = 'requested', requested_at = now(), approved_at = NULL, updated_at = now() WHERE id = $1 AND status = 'confirmed' RETURNING id`, [id])
  if (!upd.length) throw new ApiError('BAD_REQUEST', 'Zugriff ist bereits angefordert.')
  await audit(deps.db, r.grantor, 'user', 'emergency.requested', { contactId: id, grantee: session.accountId, waitHours: Number(r.wait_hours) })
}

export async function approveEmergency(deps: Deps, session: SessionInfo, id: string): Promise<void> {
  const r = await own(deps.db, session, id, 'grantor')
  if (r.status !== 'requested') throw new ApiError('BAD_REQUEST', 'Es liegt keine Anforderung vor.')
  const upd = await deps.db.query(`UPDATE emergency_contacts SET approved_at = now(), updated_at = now() WHERE id = $1 AND status = 'requested' RETURNING id`, [id])
  if (!upd.length) throw new ApiError('BAD_REQUEST', 'Es liegt keine Anforderung vor.')
  await audit(deps.db, session.accountId, 'user', 'emergency.approved', { contactId: id })
}

export async function rejectEmergency(deps: Deps, session: SessionInfo, id: string): Promise<void> {
  const r = await own(deps.db, session, id, 'grantor')
  if (r.status !== 'requested') throw new ApiError('BAD_REQUEST', 'Es liegt keine Anforderung vor.')
  const upd = await deps.db.query(`UPDATE emergency_contacts SET status = 'confirmed', requested_at = NULL, approved_at = NULL, updated_at = now() WHERE id = $1 AND status = 'requested' RETURNING id`, [id])
  if (!upd.length) throw new ApiError('BAD_REQUEST', 'Es liegt keine Anforderung vor.')
  await audit(deps.db, session.accountId, 'user', 'emergency.rejected', { contactId: id })
}

/** Entfernen – durch den Inhaber oder die Vertrauensperson selbst. */
export async function removeEmergency(deps: Deps, session: SessionInfo, id: string): Promise<void> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Notfallkontakt nicht gefunden.')
  const r = await deps.db.query<{ grantor: string }>('DELETE FROM emergency_contacts WHERE id = $1 AND (grantor = $2 OR grantee = $2) RETURNING grantor', [id, session.accountId])
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Notfallkontakt nicht gefunden.')
  await audit(deps.db, r[0].grantor, 'user', 'emergency.removed', { contactId: id, by: session.accountId })
}

async function granted(db: Db, session: SessionInfo, id: string): Promise<Row> {
  const r = await own(db, session, id, 'grantee')
  if (!hasAccess(r)) throw new ApiError('FORBIDDEN', 'Der Notfallzugang ist (noch) nicht freigegeben.')
  return r
}

/** Tresor-Index des Inhabers (mit dessen Master-Key verschlüsselt). */
export async function emergencyVault(deps: Deps, session: SessionInfo, id: string): Promise<{ grantorId: string; body: string | null }> {
  const r = await granted(deps.db, session, id)
  const idx = await getIndex(deps, r.grantor)
  await audit(deps.db, r.grantor, 'user', 'emergency.vault_opened', { contactId: id, grantee: session.accountId })
  return { grantorId: r.grantor, body: idx ? Buffer.from(idx.body).toString('base64') : null }
}

export async function emergencyDownload(deps: Deps, session: SessionInfo, id: string, objectId: string): Promise<DownloadResult> {
  const r = await granted(deps.db, session, id)
  if (!isUuid(objectId)) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const pieces = await deps.db.query<{ piece_index: number; storage_key: string; cipher_bytes: number }>(
    `SELECT op.piece_index, op.storage_key, op.cipher_bytes::float8 AS cipher_bytes
       FROM object_pieces op JOIN objects o ON o.id = op.object_id
      WHERE o.id = $1 AND o.owner_account_id = $2 AND o.state = 'stored' ORDER BY op.piece_index`,
    [objectId, r.grantor]
  )
  if (!pieces.length) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  return {
    pieces: await Promise.all(
      pieces.map(async p => ({ index: Number(p.piece_index), cipherBytes: Number(p.cipher_bytes), ...(await deps.storage.presignGet(p.storage_key, DOWNLOAD_URL_TTL_SEC)) }))
    )
  }
}
