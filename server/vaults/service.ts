import { z } from 'zod'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid } from '../shared/ids'
import { memberIds, spaceOwnerOf } from '../family/space'

/**
 * Geteilte Tresore (Business). Wie beim Teamordner verwaltet der Server nur verpackte Schlüssel
 * (je Mitglied und Generation) und einen verschlüsselten Index mit Name und Einträgen.
 *
 * Rollen: view = lesen, edit = hinzufügen/ändern, manage = zusätzlich Personen verwalten und
 * neue Schlüssel-Generationen anlegen. Wer entfernt wird, bekommt sofort nichts mehr vom Server;
 * der nächste Verwalter-Client legt eine neue Generation an und verschlüsselt den Index neu.
 */
export type VaultRole = 'view' | 'edit' | 'manage'
const ROLES = ['view', 'edit', 'manage'] as const
const RANK: Record<VaultRole, number> = { view: 0, edit: 1, manage: 2 }
const MAX_VAULTS_PER_TEAM = 200
const MAX_BODY = 4 * 1024 * 1024

const jwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
})
const wrapped = z.object({
  epk: jwk,
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ct: z.string().regex(/^[A-Za-z0-9_-]{40,80}$/)
})
const b64 = z.string().min(24).max(Math.ceil((MAX_BODY * 4) / 3) + 8).regex(/^[A-Za-z0-9+/=]+$/)

export const createVaultSchema = z.object({ id: z.string().uuid(), wrapped, body: b64 })
export const vaultGrantSchema = z.object({
  generation: z.number().int().min(1),
  grants: z.array(z.object({ accountId: z.string().uuid(), wrapped })).min(1).max(100),
  /** neue Generation anlegen (Schlüsselwechsel) – sonst nur vorhandene Generation weitergeben */
  rotate: z.boolean().optional()
})
export const vaultIndexSchema = z.object({ baseVersion: z.number().int().min(1), body: b64 })
export const vaultMemberSchema = z.object({ accountId: z.string().uuid(), role: z.enum(ROLES) })
export const vaultRoleSchema = z.object({ role: z.enum(ROLES) })

export interface VaultMemberView {
  accountId: string
  label: string
  role: VaultRole
  publicKey: unknown | null
  generations: number[]
}

export interface SharedVaultState {
  id: string
  role: VaultRole
  generation: number
  rotateNeeded: boolean
  version: number
  body: string
  myKeys: Array<{ generation: number; wrapped: unknown }>
  members: VaultMemberView[]
  createdAt: string
  updatedAt: string
}

export interface VaultsOverview {
  teamOwner: string
  me: string
  /** Teammitglieder, die man hinzufügen kann */
  team: Array<{ accountId: string; label: string; publicKey: unknown | null }>
  vaults: SharedVaultState[]
}

/** Business-Team des Kontos (Inhaber oder Mitglied) – sonst PLAN_REQUIRED. */
export async function requireTeam(db: Db, accountId: string): Promise<string> {
  let owner = await spaceOwnerOf(db, accountId)
  if (!owner) {
    const me = await db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [accountId])
    if (me[0]?.plan === 'business') owner = accountId
  }
  if (owner) {
    const p = await db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [owner])
    if (p[0]?.plan === 'business') return owner
  }
  throw new ApiError('PLAN_REQUIRED', 'Geteilte Tresore gibt es ab Business Starter.')
}

async function labels(db: Db, ids: string[]) {
  return db.query<{ id: string; email: string | null; label: string | null; public_key: unknown | null }>(
    `SELECT a.id, a.email, a.label, p.public_key FROM accounts a LEFT JOIN account_pubkeys p ON p.account_id = a.id WHERE a.id = ANY($1::uuid[])`,
    [ids]
  )
}

/** Mitgliedschaft prüfen (und Mindestrolle). Unbekannt/kein Mitglied → NOT_FOUND (verrät nichts). */
async function requireRole(db: Db, accountId: string, vaultId: string, min: VaultRole): Promise<{ owner: string; role: VaultRole }> {
  const owner = await requireTeam(db, accountId)
  if (!isUuid(vaultId)) throw new ApiError('NOT_FOUND', 'Tresor nicht gefunden.')
  const r = await db.query<{ role: VaultRole }>(
    `SELECT m.role FROM shared_vault_members m JOIN shared_vaults v ON v.id = m.vault_id
      WHERE m.vault_id = $1 AND m.account_id = $2 AND v.team_owner = $3`,
    [vaultId, accountId, owner]
  )
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Tresor nicht gefunden.')
  if (RANK[r[0].role] < RANK[min]) {
    throw new ApiError('FORBIDDEN', min === 'manage' ? 'Nur Verwalter dürfen das.' : 'Du darfst diesen Tresor nur ansehen.')
  }
  return { owner, role: r[0].role }
}

function bodyGeneration(body: Uint8Array): number {
  if (body[0] !== 1 || body.byteLength < 28) throw new ApiError('BAD_REQUEST', 'Ungültiges Tresor-Format.')
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1)
}

async function currentGeneration(db: Db, vaultId: string): Promise<number> {
  const r = await db.query<{ g: number | null }>('SELECT max(generation) AS g FROM shared_vault_keys WHERE vault_id = $1', [vaultId])
  return Number(r[0]?.g ?? 0)
}

export async function listVaults(deps: Deps, session: SessionInfo): Promise<VaultsOverview> {
  const owner = await requireTeam(deps.db, session.accountId)
  const teamIds = await memberIds(deps.db, owner)
  const people = await labels(deps.db, teamIds)
  const nameOf = (id: string) => {
    const p = people.find(x => x.id === id)
    return p?.email ?? p?.label ?? 'Konto'
  }
  const vaults = await deps.db.query<{ id: string; version: number; body: Uint8Array; rotate_needed: boolean; created_at: string; updated_at: string; role: VaultRole }>(
    `SELECT v.id, v.version::float8 AS version, v.body, v.rotate_needed, v.created_at, v.updated_at, m.role
       FROM shared_vaults v JOIN shared_vault_members m ON m.vault_id = v.id AND m.account_id = $1
      WHERE v.team_owner = $2 ORDER BY v.created_at`,
    [session.accountId, owner]
  )
  const ids = vaults.map(v => v.id)
  const members = ids.length
    ? await deps.db.query<{ vault_id: string; account_id: string; role: VaultRole }>(
        'SELECT vault_id, account_id, role FROM shared_vault_members WHERE vault_id = ANY($1::uuid[]) ORDER BY added_at',
        [ids]
      )
    : []
  const keys = ids.length
    ? await deps.db.query<{ vault_id: string; generation: number; account_id: string; wrapped: unknown }>(
        'SELECT vault_id, generation, account_id, wrapped FROM shared_vault_keys WHERE vault_id = ANY($1::uuid[])',
        [ids]
      )
    : []
  return {
    teamOwner: owner,
    me: session.accountId,
    team: teamIds.map(id => ({ accountId: id, label: nameOf(id), publicKey: people.find(p => p.id === id)?.public_key ?? null })),
    vaults: vaults.map(v => {
      const vk = keys.filter(k => k.vault_id === v.id)
      return {
        id: v.id,
        role: v.role,
        generation: vk.reduce((g, k) => Math.max(g, Number(k.generation)), 0),
        rotateNeeded: !!v.rotate_needed,
        version: Number(v.version),
        body: Buffer.from(v.body).toString('base64'),
        myKeys: vk.filter(k => k.account_id === session.accountId).map(k => ({ generation: Number(k.generation), wrapped: k.wrapped })),
        members: members
          .filter(m => m.vault_id === v.id)
          .map(m => ({
            accountId: m.account_id,
            label: nameOf(m.account_id),
            role: m.role,
            publicKey: people.find(p => p.id === m.account_id)?.public_key ?? null,
            generations: vk.filter(k => k.account_id === m.account_id).map(k => Number(k.generation))
          })),
        createdAt: new Date(v.created_at).toISOString(),
        updatedAt: new Date(v.updated_at).toISOString()
      }
    })
  }
}

/** Neuer Tresor: Ersteller wird Verwalter, bringt Generation 1 (eigene Hülle) und den ersten Index mit. */
export async function createVault(deps: Deps, session: SessionInfo, input: z.output<typeof createVaultSchema>): Promise<void> {
  const owner = await requireTeam(deps.db, session.accountId)
  const body = Buffer.from(input.body, 'base64')
  if (body.byteLength > MAX_BODY || bodyGeneration(body) !== 1) throw new ApiError('BAD_REQUEST', 'Ungültiger Tresor-Index.')
  const n = await deps.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM shared_vaults WHERE team_owner = $1', [owner])
  if (Number(n[0]?.n ?? 0) >= MAX_VAULTS_PER_TEAM) throw new ApiError('BAD_REQUEST', 'Zu viele Tresore in diesem Team.')
  try {
    await deps.db.tx(async tx => {
      await tx.query('INSERT INTO shared_vaults (id, team_owner, created_by, body) VALUES ($1, $2, $3, $4)', [input.id, owner, session.accountId, body])
      await tx.query(`INSERT INTO shared_vault_members (vault_id, account_id, role, added_by) VALUES ($1, $2, 'manage', $2)`, [input.id, session.accountId])
      await tx.query('INSERT INTO shared_vault_keys (vault_id, generation, account_id, wrapped) VALUES ($1, 1, $2, $3)', [
        input.id,
        session.accountId,
        JSON.stringify(input.wrapped)
      ])
    })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('BAD_REQUEST', 'Tresor existiert bereits.')
    throw e
  }
  await audit(deps.db, session.accountId, 'user', 'vault.created', { vaultId: input.id, team: owner })
}

export async function deleteVault(deps: Deps, session: SessionInfo, vaultId: string): Promise<void> {
  await requireRole(deps.db, session.accountId, vaultId, 'manage')
  await deps.db.query('DELETE FROM shared_vaults WHERE id = $1', [vaultId])
  await audit(deps.db, session.accountId, 'user', 'vault.deleted', { vaultId })
}

/**
 * Hüllen ablegen. Neue Generation (aktuelle + 1): nur Verwalter, mit eigener Hülle. Bestehende
 * Generation: jedes Mitglied, das sie besitzt, darf sie an andere Mitglieder weitergeben.
 */
export async function grantVaultKeys(deps: Deps, session: SessionInfo, vaultId: string, input: z.output<typeof vaultGrantSchema>): Promise<void> {
  const { role } = await requireRole(deps.db, session.accountId, vaultId, 'view')
  const members = await deps.db.query<{ account_id: string }>('SELECT account_id FROM shared_vault_members WHERE vault_id = $1', [vaultId])
  const ids = new Set(members.map(m => m.account_id))
  if (input.grants.some(g => !ids.has(g.accountId))) throw new ApiError('BAD_REQUEST', 'Empfänger ist kein Mitglied dieses Tresors.')
  const fresh = !!input.rotate
  if (fresh) {
    if (role !== 'manage') throw new ApiError('FORBIDDEN', 'Nur Verwalter legen neue Schlüssel an.')
    if (!input.grants.some(g => g.accountId === session.accountId)) throw new ApiError('BAD_REQUEST', 'Neue Generation ohne eigene Hülle.')
  }
  await deps.db.tx(async tx => {
    // Tresor sperren: gleichzeitige Schlüsselwechsel (zwei Verwalter/Tabs) werden serialisiert
    await tx.query('SELECT id FROM shared_vaults WHERE id = $1 FOR UPDATE', [vaultId])
    const cur = await tx.query<{ g: number | null }>('SELECT max(generation) AS g FROM shared_vault_keys WHERE vault_id = $1', [vaultId])
    const current = Number(cur[0]?.g ?? 0)
    if (fresh) {
      // Generation existiert schon (anderer Verwalter war schneller) → neu laden statt fremden Schlüssel zu überschreiben
      if (input.generation !== current + 1) throw new ApiError('VERSION_CONFLICT', 'Der Tresor hat bereits einen neuen Schlüssel – bitte neu laden.', { generation: current })
    } else {
      if (input.generation > current) throw new ApiError('BAD_REQUEST', 'Unbekannte Generation.')
      const mine = await tx.query('SELECT 1 FROM shared_vault_keys WHERE vault_id = $1 AND generation = $2 AND account_id = $3', [vaultId, input.generation, session.accountId])
      if (!mine.length) throw new ApiError('FORBIDDEN', 'Du besitzt diesen Tresor-Schlüssel nicht.')
    }
    for (const g of input.grants) {
      await tx.query(
        `INSERT INTO shared_vault_keys (vault_id, generation, account_id, wrapped) VALUES ($1, $2, $3, $4)
         ON CONFLICT (vault_id, generation, account_id) DO NOTHING`,
        [vaultId, input.generation, g.accountId, JSON.stringify(g.wrapped)]
      )
    }
    // neue Generation nach dem Entfernen: Ehemalige besitzen den neuen Schlüssel nicht
    if (fresh) await tx.query('UPDATE shared_vaults SET rotate_needed = false WHERE id = $1', [vaultId])
  })
  if (fresh) await audit(deps.db, session.accountId, 'user', 'vault.key_rotated', { vaultId, generation: input.generation })
}

/** Index speichern (optimistisch, Recht „Bearbeiten“). Muss mit der neuesten Generation verschlüsselt sein. */
export async function putVaultIndex(deps: Deps, session: SessionInfo, vaultId: string, input: z.output<typeof vaultIndexSchema>): Promise<{ version: number }> {
  const { role } = await requireRole(deps.db, session.accountId, vaultId, 'view')
  const body = Buffer.from(input.body, 'base64')
  if (body.byteLength > MAX_BODY) throw new ApiError('BAD_REQUEST', 'Tresor ist zu groß.')
  const gen = bodyGeneration(body)
  const current = await currentGeneration(deps.db, vaultId)
  if (gen !== current) throw new ApiError('VERSION_CONFLICT', 'Der Tresor hat einen neuen Schlüssel – bitte neu laden.', { generation: current })
  if (RANK[role] < RANK.edit) throw new ApiError('FORBIDDEN', 'Du darfst diesen Tresor nur ansehen.')
  // Nach dem Entfernen einer Person: erst nach dem Schlüsselwechsel wieder schreiben (sonst mit altem Schlüssel)
  const rot = await deps.db.query<{ rotate_needed: boolean }>('SELECT rotate_needed FROM shared_vaults WHERE id = $1', [vaultId])
  if (rot[0]?.rotate_needed) throw new ApiError('VERSION_CONFLICT', 'Der Tresor erhält gerade einen neuen Schlüssel – ein Verwalter muss ihn einmal öffnen.', { rotateNeeded: true })
  const r = await deps.db.query<{ version: number }>(
    `UPDATE shared_vaults SET version = version + 1, body = $3, updated_at = now()
      WHERE id = $1 AND version = $2 RETURNING version::float8 AS version`,
    [vaultId, input.baseVersion, body]
  )
  if (!r[0]) {
    const cur = await deps.db.query<{ version: number }>('SELECT version::float8 AS version FROM shared_vaults WHERE id = $1', [vaultId])
    throw new ApiError('VERSION_CONFLICT', 'Der Tresor wurde inzwischen geändert.', { currentVersion: Number(cur[0]?.version ?? 0) })
  }
  await audit(deps.db, session.accountId, 'user', 'vault.updated', { vaultId, version: Number(r[0].version) })
  return { version: Number(r[0].version) }
}

export async function addVaultMember(deps: Deps, session: SessionInfo, vaultId: string, input: z.output<typeof vaultMemberSchema>): Promise<void> {
  const { owner } = await requireRole(deps.db, session.accountId, vaultId, 'manage')
  const team = new Set(await memberIds(deps.db, owner))
  if (!team.has(input.accountId)) throw new ApiError('BAD_REQUEST', 'Nur Mitglieder deines Teams können hinzugefügt werden.')
  const r = await deps.db.query(
    `INSERT INTO shared_vault_members (vault_id, account_id, role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (vault_id, account_id) DO NOTHING RETURNING account_id`,
    [vaultId, input.accountId, input.role, session.accountId]
  )
  if (!r.length) throw new ApiError('BAD_REQUEST', 'Diese Person hat bereits Zugriff.')
  await audit(deps.db, session.accountId, 'user', 'vault.member_added', { vaultId, member: input.accountId, role: input.role })
}

async function managerCount(db: Db, vaultId: string): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::float8 AS n FROM shared_vault_members WHERE vault_id = $1 AND role = 'manage'`, [vaultId])
  return Number(r[0]?.n ?? 0)
}

export async function setVaultRole(deps: Deps, session: SessionInfo, vaultId: string, memberId: string, role: VaultRole): Promise<void> {
  await requireRole(deps.db, session.accountId, vaultId, 'manage')
  const cur = await deps.db.query<{ role: VaultRole }>('SELECT role FROM shared_vault_members WHERE vault_id = $1 AND account_id = $2', [vaultId, memberId])
  if (!cur[0]) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  if (cur[0].role === 'manage' && role !== 'manage' && (await managerCount(deps.db, vaultId)) <= 1) {
    throw new ApiError('BAD_REQUEST', 'Ein Tresor braucht mindestens einen Verwalter.')
  }
  await deps.db.query('UPDATE shared_vault_members SET role = $3 WHERE vault_id = $1 AND account_id = $2', [vaultId, memberId, role])
  await audit(deps.db, session.accountId, 'user', 'vault.role_changed', { vaultId, member: memberId, from: cur[0].role, role })
}

/** Mitglied entfernen (Verwalter) oder selbst austreten. Danach neue Schlüssel-Generation vormerken. */
export async function removeVaultMember(deps: Deps, session: SessionInfo, vaultId: string, memberId: string): Promise<void> {
  const self = memberId === session.accountId
  await requireRole(deps.db, session.accountId, vaultId, self ? 'view' : 'manage')
  const cur = await deps.db.query<{ role: VaultRole }>('SELECT role FROM shared_vault_members WHERE vault_id = $1 AND account_id = $2', [vaultId, memberId])
  if (!cur[0]) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  if (cur[0].role === 'manage' && (await managerCount(deps.db, vaultId)) <= 1) {
    throw new ApiError('BAD_REQUEST', 'Der letzte Verwalter kann nicht entfernt werden – zuerst einen anderen Verwalter bestimmen oder den Tresor löschen.')
  }
  await deps.db.tx(async tx => {
    await tx.query('DELETE FROM shared_vault_members WHERE vault_id = $1 AND account_id = $2', [vaultId, memberId])
    await tx.query('DELETE FROM shared_vault_keys WHERE vault_id = $1 AND account_id = $2', [vaultId, memberId])
    await tx.query('UPDATE shared_vaults SET rotate_needed = true WHERE id = $1', [vaultId])
  })
  await audit(deps.db, session.accountId, 'user', self ? 'vault.left' : 'vault.member_removed', { vaultId, member: memberId })
}

export interface VaultAuditEvent {
  at: string
  kind: string
  actor: string
  member?: string
  role?: string
  from?: string
}

/** Protokoll eines Tresors (nur Verwalter). */
export async function vaultAudit(deps: Deps, session: SessionInfo, vaultId: string): Promise<VaultAuditEvent[]> {
  await requireRole(deps.db, session.accountId, vaultId, 'manage')
  const rows = await deps.db.query<{ at: string; kind: string; account_id: string | null; meta: Record<string, unknown> }>(
    `SELECT at, kind, account_id, meta FROM audit_events WHERE meta ? 'vaultId' AND meta->>'vaultId' = $1 ORDER BY at DESC, id DESC LIMIT 200`,
    [vaultId]
  )
  const ids = [...new Set(rows.flatMap(r => [r.account_id, r.meta.member as string | undefined]).filter((x): x is string => !!x))]
  const people = ids.length ? await labels(deps.db, ids) : []
  const name = (id: string | null | undefined) => {
    const p = people.find(x => x.id === id)
    return p?.email ?? p?.label ?? '—'
  }
  return rows.map(r => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    actor: name(r.account_id),
    ...(r.meta.member ? { member: name(r.meta.member as string) } : {}),
    ...(r.meta.role ? { role: String(r.meta.role) } : {}),
    ...(r.meta.from ? { from: String(r.meta.from) } : {})
  }))
}
