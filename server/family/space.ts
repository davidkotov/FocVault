import { z } from 'zod'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid } from '../shared/ids'

/**
 * Familienordner (Server-Seite). Der Server verwaltet nur verpackte Schlüssel und einen
 * verschlüsselten Index – Ordner-Schlüssel, Dateinamen und Inhalte sieht er nie.
 *
 * - Jedes Konto veröffentlicht einen ECDH-P-256-Schlüssel (JWK, nur öffentlicher Teil).
 * - Ordner-Schlüssel haben Generationen. Für jedes Mitglied gibt es je Generation eine Hülle
 *   (vom Client mit ECDH-ES + HKDF + AES-GCM für dessen öffentlichen Schlüssel erzeugt).
 * - Nach dem Entfernen eines Mitglieds erzeugt der Inhaber eine neue Generation; neue Dateien
 *   sind damit für Ehemalige unlesbar, und der Server liefert ihnen ohnehin keine Dateien mehr.
 */
const jwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
})
export const pubkeySchema = z.object({ publicKey: jwk })

const wrapped = z.object({
  epk: jwk,
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ct: z.string().regex(/^[A-Za-z0-9_-]{40,80}$/)
})
export const grantSchema = z.object({
  generation: z.number().int().min(1),
  grants: z.array(z.object({ accountId: z.string().uuid(), wrapped })).min(1).max(12)
})

/** Familie des Kontos (als Inhaber oder Mitglied) – sonst null. */
export async function spaceOwnerOf(db: Db, accountId: string): Promise<string | null> {
  const m = await db.query<{ owner_account_id: string }>('SELECT owner_account_id FROM family_members WHERE account_id = $1', [accountId])
  if (m[0]) return m[0].owner_account_id
  const own = await db.query('SELECT 1 FROM families WHERE owner_account_id = $1', [accountId])
  return own.length ? accountId : null
}

async function requireSpace(db: Db, accountId: string): Promise<string> {
  const owner = await spaceOwnerOf(db, accountId)
  if (!owner) throw new ApiError('PLAN_REQUIRED', 'Den Familienordner gibt es mit Family.')
  return owner
}

async function memberIds(db: Db, owner: string): Promise<string[]> {
  const rows = await db.query<{ account_id: string }>('SELECT account_id FROM family_members WHERE owner_account_id = $1', [owner])
  return [owner, ...rows.map(r => r.account_id)]
}

export async function setPublicKey(deps: Deps, session: SessionInfo, publicKey: z.output<typeof jwk>): Promise<void> {
  await deps.db.query(
    `INSERT INTO account_pubkeys (account_id, public_key) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = now()`,
    [session.accountId, JSON.stringify(publicKey)]
  )
  // Alte Hüllen passen nicht mehr zum neuen Schlüssel → andere Mitglieder verteilen neu
  await deps.db.query('DELETE FROM family_space_keys WHERE account_id = $1', [session.accountId])
}

export interface SpaceState {
  ownerId: string
  isOwner: boolean
  generation: number
  rotateNeeded: boolean
  myKeys: Array<{ generation: number; wrapped: unknown }>
  members: Array<{ accountId: string; label: string; publicKey: unknown | null; generations: number[] }>
  indexVersion: number
}

export async function spaceState(deps: Deps, session: SessionInfo): Promise<SpaceState> {
  const owner = await requireSpace(deps.db, session.accountId)
  const ids = await memberIds(deps.db, owner)
  const people = await deps.db.query<{ id: string; email: string | null; label: string | null; public_key: unknown | null }>(
    `SELECT a.id, a.email, a.label, p.public_key FROM accounts a LEFT JOIN account_pubkeys p ON p.account_id = a.id WHERE a.id = ANY($1::uuid[])`,
    [ids]
  )
  const keys = await deps.db.query<{ generation: number; account_id: string; wrapped: unknown }>(
    'SELECT generation, account_id, wrapped FROM family_space_keys WHERE owner_account_id = $1',
    [owner]
  )
  const idx = await deps.db.query<{ version: number; rotate_needed: boolean }>(
    'SELECT version::float8 AS version, rotate_needed FROM family_space_index WHERE owner_account_id = $1',
    [owner]
  )
  const generation = keys.reduce((g, k) => Math.max(g, Number(k.generation)), 0)
  return {
    ownerId: owner,
    isOwner: owner === session.accountId,
    generation,
    rotateNeeded: !!idx[0]?.rotate_needed,
    myKeys: keys.filter(k => k.account_id === session.accountId).map(k => ({ generation: Number(k.generation), wrapped: k.wrapped })),
    members: ids.map(id => {
      const p = people.find(x => x.id === id)
      return {
        accountId: id,
        label: p?.email ?? p?.label ?? 'Konto',
        publicKey: p?.public_key ?? null,
        generations: keys.filter(k => k.account_id === id).map(k => Number(k.generation))
      }
    }),
    indexVersion: Number(idx[0]?.version ?? 0)
  }
}

/**
 * Hüllen ablegen. Eine neue Generation (aktuelle + 1) darf nur der Inhaber anlegen und muss dabei
 * sich selbst einschließen; für bestehende Generationen darf jedes Mitglied verteilen, das sie besitzt.
 */
export async function grantSpaceKeys(deps: Deps, session: SessionInfo, input: z.output<typeof grantSchema>): Promise<void> {
  const owner = await requireSpace(deps.db, session.accountId)
  const ids = new Set(await memberIds(deps.db, owner))
  if (input.grants.some(g => !ids.has(g.accountId))) throw new ApiError('BAD_REQUEST', 'Empfänger gehört nicht zur Familie.')
  const cur = await deps.db.query<{ g: number | null }>('SELECT max(generation) AS g FROM family_space_keys WHERE owner_account_id = $1', [owner])
  const current = Number(cur[0]?.g ?? 0)
  if (input.generation === current + 1) {
    if (owner !== session.accountId) throw new ApiError('FORBIDDEN', 'Nur der Inhaber kann einen neuen Ordner-Schlüssel anlegen.')
    if (!input.grants.some(g => g.accountId === session.accountId)) throw new ApiError('BAD_REQUEST', 'Neue Generation ohne eigene Hülle.')
  } else {
    if (input.generation > current) throw new ApiError('BAD_REQUEST', 'Unbekannte Generation.')
    const mine = await deps.db.query('SELECT 1 FROM family_space_keys WHERE owner_account_id = $1 AND generation = $2 AND account_id = $3', [
      owner,
      input.generation,
      session.accountId
    ])
    if (!mine.length) throw new ApiError('FORBIDDEN', 'Du besitzt diesen Ordner-Schlüssel nicht.')
  }
  await deps.db.tx(async tx => {
    for (const g of input.grants) {
      await tx.query(
        `INSERT INTO family_space_keys (owner_account_id, generation, account_id, wrapped) VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_account_id, generation, account_id) DO NOTHING`,
        [owner, input.generation, g.accountId, JSON.stringify(g.wrapped)]
      )
    }
    if (input.generation === current + 1) {
      await tx.query(
        `INSERT INTO family_space_index (owner_account_id, version, body, rotate_needed) VALUES ($1, 0, '\\x', false)
         ON CONFLICT (owner_account_id) DO UPDATE SET rotate_needed = false`,
        [owner]
      )
    }
  })
  if (input.generation === current + 1) await audit(deps.db, owner, 'user', 'family.space_key_created', { generation: input.generation })
}

export async function getSpaceIndex(deps: Deps, session: SessionInfo): Promise<{ version: number; body: Uint8Array } | null> {
  const owner = await requireSpace(deps.db, session.accountId)
  const r = await deps.db.query<{ version: number; body: Uint8Array }>(
    'SELECT version::float8 AS version, body FROM family_space_index WHERE owner_account_id = $1',
    [owner]
  )
  if (!r[0] || Number(r[0].version) === 0) return null
  return { version: Number(r[0].version), body: r[0].body }
}

export async function putSpaceIndex(deps: Deps, session: SessionInfo, baseVersion: number, body: Uint8Array): Promise<{ version: number }> {
  const owner = await requireSpace(deps.db, session.accountId)
  if (body.byteLength < 28 || body.byteLength > 8 * 1024 * 1024) throw new ApiError('BAD_REQUEST', 'Ungültige Indexgröße.')
  const r = await deps.db.query<{ version: number }>(
    `UPDATE family_space_index SET version = version + 1, body = $3, updated_at = now()
      WHERE owner_account_id = $1 AND version = $2 RETURNING version::float8 AS version`,
    [owner, baseVersion, body]
  )
  if (!r[0]) {
    const cur = await deps.db.query<{ version: number }>('SELECT version::float8 AS version FROM family_space_index WHERE owner_account_id = $1', [owner])
    if (!cur[0]) throw new ApiError('BAD_REQUEST', 'Der Familienordner ist noch nicht eingerichtet.')
    throw new ApiError('VERSION_CONFLICT', 'Der Familienordner wurde inzwischen geändert.', { currentVersion: Number(cur[0].version) })
  }
  return { version: Number(r[0].version) }
}

/** Darf `accountId` dieses (Familien-)Objekt lesen bzw. löschen? */
export async function canAccessSpaceObject(db: Db, accountId: string, objectId: string): Promise<boolean> {
  if (!isUuid(objectId)) return false
  const owner = await spaceOwnerOf(db, accountId)
  if (!owner) return false
  const r = await db.query('SELECT 1 FROM objects WHERE id = $1 AND space_owner = $2', [objectId, owner])
  return r.length > 0
}

/** Mitglied verlässt die Familie: seine Familienordner-Dateien gehen an den Inhaber (Quota), Rotation vormerken. */
export async function detachFromSpace(db: Db, memberId: string, owner: string): Promise<void> {
  await db.query(`UPDATE objects SET owner_account_id = $2 WHERE owner_account_id = $1 AND space_owner = $2`, [memberId, owner])
  await db.query('DELETE FROM family_space_keys WHERE owner_account_id = $1 AND account_id = $2', [owner, memberId])
  await db.query('UPDATE family_space_index SET rotate_needed = true WHERE owner_account_id = $1', [owner])
}
