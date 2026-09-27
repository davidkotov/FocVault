import { z } from 'zod'
import type { DownloadResult, TeamInfo, TeamPolicy, TeamRole } from '../../lib/api-types'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'
import { spaceOwnerOf, memberIds } from '../family/space'
import { getIndex } from '../vault/service'

/**
 * Business-Admin-Konsole: Rollen (Inhaber, Admin, Mitglied), Richtlinien, Team-Protokoll und
 * Firmen-Notfallzugriff nach dem Vier-Augen-Prinzip.
 *
 * Firmen-Notfallzugriff: Der Inhaber erzeugt im Browser ein Team-Schlüsselpaar (ECDH). Der private
 * Teil liegt nur verpackt je Admin vor. Mitglieder hinterlegen ihren Master-Key verpackt für den
 * öffentlichen Teil. Eine Hinterlegung wird erst ausgeliefert, wenn ein Admin den Zugriff beantragt
 * und ein **zweiter** Admin ihn freigibt; alles wird protokolliert und dem Mitglied angezeigt.
 */
export const DEFAULT_POLICY: TeamPolicy = {
  passkeyRequired: false,
  minPassphraseChars: 12,
  autoLockMinutes: 30,
  allowShareLinks: true,
  maxShareDays: null,
  recoveryRequired: false
}

export const policySchema = z.object({
  passkeyRequired: z.boolean(),
  minPassphraseChars: z.number().int().min(12).max(64),
  autoLockMinutes: z.number().int().min(1).max(480),
  allowShareLinks: z.boolean(),
  maxShareDays: z.number().int().min(1).max(365).nullable(),
  recoveryRequired: z.boolean()
})
export const roleSchema = z.object({ role: z.enum(['admin', 'member']) })
export const attestSchema = z.object({ passphraseChars: z.number().int().min(1).max(1024) })

const jwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
})
const wrapped = z.object({ epk: jwk, iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/), ct: z.string().regex(/^[A-Za-z0-9_-]{40,80}$/) })
export const recoveryKeySchema = z.object({ publicKey: jwk, wrapped })
export const recoveryGrantSchema = z.object({ generation: z.number().int().min(1), grants: z.array(z.object({ accountId: z.string().uuid(), wrapped })).min(1).max(100) })
export const escrowSchema = z.object({ generation: z.number().int().min(1), wrapped })
export const recoveryRequestSchema = z.object({ target: z.string().uuid(), reason: z.string().trim().min(10).max(500) })

const ACCESS_WINDOW_HOURS = 24
const REQUEST_TTL_DAYS = 7

export interface TeamContext {
  owner: string
  role: TeamRole
  tier: 'starter' | 'business' | 'enterprise' | null
}

/** Business-Team des Kontos oder null. */
export async function teamContext(db: Db, accountId: string): Promise<TeamContext | null> {
  let owner = await spaceOwnerOf(db, accountId)
  if (!owner) {
    const me = await db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [accountId])
    if (me[0]?.plan === 'business') owner = accountId
  }
  if (!owner) return null
  const o = await db.query<{ plan: string; business_tier: TeamContext['tier'] }>('SELECT plan, business_tier FROM accounts WHERE id = $1', [owner])
  if (o[0]?.plan !== 'business') return null
  if (owner === accountId) return { owner, role: 'owner', tier: o[0].business_tier ?? 'starter' }
  const m = await db.query<{ role: 'admin' | 'member' }>('SELECT role FROM family_members WHERE account_id = $1', [accountId])
  return { owner, role: m[0]?.role ?? 'member', tier: o[0].business_tier ?? 'starter' }
}

async function requireAdmin(db: Db, accountId: string): Promise<TeamContext> {
  const t = await teamContext(db, accountId)
  if (!t) throw new ApiError('PLAN_REQUIRED', 'Die Admin-Konsole gibt es mit Business.')
  if (t.role === 'member') throw new ApiError('FORBIDDEN', 'Nur Inhaber und Admins dürfen das.')
  return t
}

export async function teamPolicy(db: Db, owner: string): Promise<TeamPolicy> {
  const r = await db.query<{ policy: Partial<TeamPolicy> }>('SELECT policy FROM team_policies WHERE owner_account_id = $1', [owner])
  return { ...DEFAULT_POLICY, ...(r[0]?.policy ?? {}) }
}

/** Richtlinie des Teams, dem das Konto angehört (sonst null). */
export async function policyFor(db: Db, accountId: string): Promise<TeamPolicy | null> {
  const t = await teamContext(db, accountId)
  return t ? teamPolicy(db, t.owner) : null
}

async function labels(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const r = await db.query<{ id: string; email: string | null; label: string | null }>('SELECT id, email, label FROM accounts WHERE id = ANY($1::uuid[])', [ids])
  return new Map(r.map(x => [x.id, x.email ?? x.label ?? 'Konto']))
}

/** Teil der Kontoansicht: Rolle, Richtlinie, Hinterlegung, durchgeführte Zugriffe. */
export async function teamInfo(db: Db, accountId: string): Promise<TeamInfo | null> {
  const t = await teamContext(db, accountId)
  if (!t) return null
  const policy = await teamPolicy(db, t.owner)
  const me = await db.query<{ passphrase_chars: number | null }>('SELECT passphrase_chars FROM accounts WHERE id = $1', [accountId])
  const key = await db.query<{ generation: number; public_key: JsonWebKey }>('SELECT generation, public_key FROM team_recovery_keys WHERE owner_account_id = $1', [t.owner])
  const esc = await db.query<{ generation: number }>('SELECT generation FROM team_escrow WHERE account_id = $1 AND owner_account_id = $2', [accountId, t.owner])
  const acc = await db.query<{ approved_at: string; requested_by: string; approved_by: string; reason: string }>(
    `SELECT approved_at, requested_by, approved_by, reason FROM team_recovery_requests
      WHERE target = $1 AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 20`,
    [accountId]
  )
  const names = await labels(db, [t.owner, ...acc.flatMap(a => [a.requested_by, a.approved_by])])
  return {
    ownerId: t.owner,
    ownerLabel: names.get(t.owner) ?? 'Konto',
    role: t.role,
    tier: t.tier,
    policy,
    passphraseChars: me[0]?.passphrase_chars ?? null,
    recovery: key[0]
      ? { generation: Number(key[0].generation), publicKey: key[0].public_key, escrowed: Number(esc[0]?.generation ?? 0) === Number(key[0].generation) }
      : null,
    accessedBy: acc.map(a => ({
      at: new Date(a.approved_at).toISOString(),
      requestedBy: names.get(a.requested_by) ?? '—',
      approvedBy: names.get(a.approved_by) ?? '—',
      reason: a.reason
    }))
  }
}

export async function attestPassphrase(deps: Deps, session: SessionInfo, chars: number): Promise<void> {
  await deps.db.query('UPDATE accounts SET passphrase_chars = $2 WHERE id = $1', [session.accountId, chars])
}

// ---------- Konsole ----------

export interface TeamMemberAdmin {
  id: string
  label: string
  role: TeamRole
  joinedAt: string | null
  passkeys: number
  passphraseChars: number | null
  escrowed: boolean
  lastActive: string | null
  compliant: boolean
  issues: Array<'passkey' | 'passphrase' | 'escrow'>
}

export interface TeamAdminView {
  owner: string
  me: string
  role: TeamRole
  tier: TeamContext['tier']
  policy: TeamPolicy
  members: TeamMemberAdmin[]
  recovery: {
    generation: number
    publicKey: JsonWebKey
    myWrapped: unknown | null
    admins: Array<{ accountId: string; label: string; publicKey: unknown | null; hasKey: boolean }>
    requests: Array<{
      id: string
      target: string
      targetLabel: string
      requestedBy: string
      requestedByLabel: string
      approvedBy: string | null
      approvedByLabel: string | null
      reason: string
      status: 'pending' | 'approved' | 'rejected' | 'expired'
      createdAt: string
      accessUntil: string | null
    }>
  } | null
}

export async function teamAdminView(deps: Deps, session: SessionInfo): Promise<TeamAdminView> {
  const t = await requireAdmin(deps.db, session.accountId)
  const policy = await teamPolicy(deps.db, t.owner)
  const ids = await memberIds(deps.db, t.owner)
  const rows = await deps.db.query<{
    id: string
    email: string | null
    label: string | null
    role: 'admin' | 'member' | null
    joined_at: string | null
    passphrase_chars: number | null
    passkeys: number
    escrow_gen: number | null
    last_active: string | null
  }>(
    `SELECT a.id, a.email, a.label, m.role, m.joined_at, a.passphrase_chars,
            (SELECT count(*) FROM account_keys k WHERE k.account_id = a.id AND k.kek_type = 'passkey' AND k.revoked_at IS NULL)::float8 AS passkeys,
            (SELECT generation FROM team_escrow e WHERE e.account_id = a.id AND e.owner_account_id = $2) AS escrow_gen,
            (SELECT max(last_seen_at) FROM sessions s WHERE s.account_id = a.id) AS last_active
       FROM accounts a LEFT JOIN family_members m ON m.account_id = a.id
      WHERE a.id = ANY($1::uuid[])`,
    [ids, t.owner]
  )
  const key = await deps.db.query<{ generation: number; public_key: JsonWebKey }>('SELECT generation, public_key FROM team_recovery_keys WHERE owner_account_id = $1', [t.owner])
  const gen = Number(key[0]?.generation ?? 0)
  const members: TeamMemberAdmin[] = ids.map(id => {
    const r = rows.find(x => x.id === id)!
    const role: TeamRole = id === t.owner ? 'owner' : (r.role ?? 'member')
    const escrowed = !!gen && Number(r.escrow_gen ?? 0) === gen
    const issues: TeamMemberAdmin['issues'] = []
    if (policy.passkeyRequired && Number(r.passkeys) === 0) issues.push('passkey')
    if ((r.passphrase_chars ?? 0) < policy.minPassphraseChars) issues.push('passphrase')
    if (policy.recoveryRequired && !escrowed) issues.push('escrow')
    return {
      id,
      label: r.email ?? r.label ?? 'Konto',
      role,
      joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
      passkeys: Number(r.passkeys),
      passphraseChars: r.passphrase_chars,
      escrowed,
      lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
      compliant: issues.length === 0,
      issues
    }
  })
  let recovery: TeamAdminView['recovery'] = null
  if (key[0]) {
    const grants = await deps.db.query<{ account_id: string; wrapped: unknown }>(
      'SELECT account_id, wrapped FROM team_recovery_grants WHERE owner_account_id = $1 AND generation = $2',
      [t.owner, gen]
    )
    const pubs = await deps.db.query<{ account_id: string; public_key: unknown }>('SELECT account_id, public_key FROM account_pubkeys WHERE account_id = ANY($1::uuid[])', [ids])
    const reqs = await deps.db.query<{
      id: string
      target: string
      requested_by: string
      approved_by: string | null
      approved_at: string | null
      rejected_at: string | null
      reason: string
      expires_at: string
      created_at: string
    }>('SELECT * FROM team_recovery_requests WHERE owner_account_id = $1 ORDER BY created_at DESC LIMIT 50', [t.owner])
    const names = new Map(members.map(m => [m.id, m.label]))
    recovery = {
      generation: gen,
      publicKey: key[0].public_key,
      myWrapped: grants.find(g => g.account_id === session.accountId)?.wrapped ?? null,
      admins: members
        .filter(m => m.role !== 'member')
        .map(m => ({ accountId: m.id, label: m.label, publicKey: pubs.find(p => p.account_id === m.id)?.public_key ?? null, hasKey: grants.some(g => g.account_id === m.id) })),
      requests: reqs.map(r => {
        const accessUntil = r.approved_at ? new Date(new Date(r.approved_at).getTime() + ACCESS_WINDOW_HOURS * 3_600_000) : null
        const status = r.rejected_at
          ? 'rejected'
          : r.approved_at
            ? accessUntil!.getTime() > Date.now()
              ? 'approved'
              : 'expired'
            : new Date(r.expires_at).getTime() > Date.now()
              ? 'pending'
              : 'expired'
        return {
          id: r.id,
          target: r.target,
          targetLabel: names.get(r.target) ?? '—',
          requestedBy: r.requested_by,
          requestedByLabel: names.get(r.requested_by) ?? '—',
          approvedBy: r.approved_by,
          approvedByLabel: r.approved_by ? (names.get(r.approved_by) ?? '—') : null,
          reason: r.reason,
          status,
          createdAt: new Date(r.created_at).toISOString(),
          accessUntil: accessUntil && status === 'approved' ? accessUntil.toISOString() : null
        }
      })
    }
  }
  return { owner: t.owner, me: session.accountId, role: t.role, tier: t.tier, policy, members, recovery }
}

export async function setTeamPolicy(deps: Deps, session: SessionInfo, policy: z.output<typeof policySchema>): Promise<TeamPolicy> {
  const t = await requireAdmin(deps.db, session.accountId)
  const before = await teamPolicy(deps.db, t.owner)
  await deps.db.query(
    `INSERT INTO team_policies (owner_account_id, policy, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (owner_account_id) DO UPDATE SET policy = EXCLUDED.policy, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [t.owner, JSON.stringify(policy), session.accountId]
  )
  const changed = (Object.keys(policy) as Array<keyof TeamPolicy>).filter(k => policy[k] !== before[k])
  await audit(deps.db, session.accountId, 'user', 'team.policy_changed', { team: t.owner, changed, policy })
  return policy
}

export async function setMemberRole(deps: Deps, session: SessionInfo, memberId: string, role: 'admin' | 'member'): Promise<void> {
  const t = await requireAdmin(deps.db, session.accountId)
  if (t.role !== 'owner') throw new ApiError('FORBIDDEN', 'Nur der Inhaber vergibt Admin-Rechte.')
  if (!isUuid(memberId)) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  const r = await deps.db.query('UPDATE family_members SET role = $3 WHERE account_id = $1 AND owner_account_id = $2 RETURNING account_id', [memberId, t.owner, role])
  if (!r.length) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  if (role === 'member') await deps.db.query('DELETE FROM team_recovery_grants WHERE owner_account_id = $1 AND account_id = $2', [t.owner, memberId])
  await audit(deps.db, session.accountId, 'user', 'team.role_changed', { team: t.owner, member: memberId, role })
}

// ---------- Protokoll ----------

export interface TeamAuditEvent {
  id: number
  at: string
  kind: string
  actor: string
  actorId: string | null
  meta: Record<string, unknown>
}

export const auditQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  member: z.string().uuid().optional(),
  kind: z.string().regex(/^[a-z_.]+$/).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500)
})

/** Ereignisse aller Teammitglieder (ohne Inhalte – Dateinamen kennt der Server ohnehin nicht). */
export async function teamAudit(deps: Deps, session: SessionInfo, q: z.output<typeof auditQuerySchema>): Promise<TeamAuditEvent[]> {
  const t = await requireAdmin(deps.db, session.accountId)
  const ids = await memberIds(deps.db, t.owner)
  if (q.member && !ids.includes(q.member)) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  const rows = await deps.db.query<{ id: number; at: string; kind: string; account_id: string | null; meta: Record<string, unknown> }>(
    `SELECT id, at, kind, account_id, meta FROM audit_events
      WHERE (account_id = ANY($1::uuid[]) OR meta->>'team' = $2::text)
        AND ($3::timestamptz IS NULL OR at >= $3) AND ($4::timestamptz IS NULL OR at <= $4)
        AND ($5::uuid IS NULL OR account_id = $5) AND ($6::text IS NULL OR kind LIKE $6 || '%')
      ORDER BY at DESC, id DESC LIMIT $7`,
    [ids, t.owner, q.from ?? null, q.to ?? null, q.member ?? null, q.kind ?? null, q.limit]
  )
  const names = await labels(deps.db, [...new Set(rows.map(r => r.account_id).filter((x): x is string => !!x))])
  return rows.map(r => ({
    id: Number(r.id),
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    actor: r.account_id ? (names.get(r.account_id) ?? '—') : 'System',
    actorId: r.account_id,
    meta: r.meta
  }))
}

export interface ComplianceData {
  generatedAt: string
  team: { ownerLabel: string; tier: TeamContext['tier']; seats: number }
  policy: TeamPolicy
  members: TeamMemberAdmin[]
  storage: { files: number; bytes: number; onFilecoin: number; filecoinBytes: number }
  events: { total: number; byKind: Array<{ kind: string; n: number }>; recent: TeamAuditEvent[] }
  recoveryRequests: NonNullable<TeamAdminView['recovery']>['requests']
  periodDays: number
}

/** Daten für den Compliance-Bericht (PDF wird im Browser erzeugt). */
export async function complianceData(deps: Deps, session: SessionInfo, periodDays = 90): Promise<ComplianceData> {
  const view = await teamAdminView(deps, session)
  const ids = view.members.map(m => m.id)
  const st = await deps.db.query<{ files: number; bytes: number }>(
    `SELECT count(*)::float8 AS files, coalesce(sum(cipher_bytes), 0)::float8 AS bytes FROM objects WHERE owner_account_id = ANY($1::uuid[]) AND state = 'stored'`,
    [ids]
  )
  let foc = { n: 0, b: 0 }
  try {
    const f = await deps.db.query<{ n: number; b: number }>(
      `SELECT count(*)::float8 AS n, coalesce(sum(o.cipher_bytes), 0)::float8 AS b FROM objects o
        WHERE o.owner_account_id = ANY($1::uuid[]) AND o.state = 'stored'
          AND NOT EXISTS (SELECT 1 FROM object_pieces op WHERE op.object_id = o.id AND NOT EXISTS (
                SELECT 1 FROM foc_members fm JOIN foc_packs fp ON fp.id = fm.pack_id
                 WHERE fm.storage_key = op.storage_key AND fm.deleted_at IS NULL AND fm.evicted_at IS NULL AND fp.state = 'stored'))`,
      [ids]
    )
    foc = { n: Number(f[0]?.n ?? 0), b: Number(f[0]?.b ?? 0) }
  } catch {
    // FOC-Tabellen je nach Stand nicht vorhanden
  }
  const from = new Date(Date.now() - periodDays * 86_400_000).toISOString()
  const events = await teamAudit(deps, session, { from, limit: 5000 })
  const byKind = new Map<string, number>()
  for (const e of events) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)
  const seats = await deps.db.query<{ seats: number | null }>('SELECT seats FROM accounts WHERE id = $1', [view.owner])
  await audit(deps.db, session.accountId, 'user', 'team.report_generated', { team: view.owner, periodDays })
  return {
    generatedAt: new Date().toISOString(),
    team: { ownerLabel: view.members.find(m => m.role === 'owner')?.label ?? '—', tier: view.tier, seats: Number(seats[0]?.seats ?? view.members.length) },
    policy: view.policy,
    members: view.members,
    storage: { files: Number(st[0]?.files ?? 0), bytes: Number(st[0]?.bytes ?? 0), onFilecoin: foc.n, filecoinBytes: foc.b },
    events: { total: events.length, byKind: [...byKind].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n), recent: events.slice(0, 60) },
    recoveryRequests: view.recovery?.requests ?? [],
    periodDays
  }
}

// ---------- Firmen-Notfallzugriff ----------

/** Inhaber legt (neuen) Team-Wiederherstellungsschlüssel an; alte Hinterlegungen verfallen. */
export async function setRecoveryKey(deps: Deps, session: SessionInfo, input: z.output<typeof recoveryKeySchema>): Promise<{ generation: number }> {
  const t = await requireAdmin(deps.db, session.accountId)
  if (t.role !== 'owner') throw new ApiError('FORBIDDEN', 'Nur der Inhaber legt den Team-Schlüssel an.')
  const cur = await deps.db.query<{ generation: number }>('SELECT generation FROM team_recovery_keys WHERE owner_account_id = $1', [t.owner])
  const generation = Number(cur[0]?.generation ?? 0) + 1
  await deps.db.tx(async tx => {
    await tx.query(
      `INSERT INTO team_recovery_keys (owner_account_id, generation, public_key) VALUES ($1, $2, $3)
       ON CONFLICT (owner_account_id) DO UPDATE SET generation = EXCLUDED.generation, public_key = EXCLUDED.public_key, created_at = now()`,
      [t.owner, generation, JSON.stringify(input.publicKey)]
    )
    await tx.query('DELETE FROM team_recovery_grants WHERE owner_account_id = $1', [t.owner])
    await tx.query('DELETE FROM team_escrow WHERE owner_account_id = $1', [t.owner])
    await tx.query('INSERT INTO team_recovery_grants (owner_account_id, generation, account_id, wrapped) VALUES ($1, $2, $3, $4)', [
      t.owner,
      generation,
      session.accountId,
      JSON.stringify(input.wrapped)
    ])
  })
  await audit(deps.db, session.accountId, 'user', 'team.recovery_key_created', { team: t.owner, generation })
  return { generation }
}

/** Admins, die den Team-Schlüssel besitzen, geben ihn an andere Admins weiter. */
export async function grantRecoveryKey(deps: Deps, session: SessionInfo, input: z.output<typeof recoveryGrantSchema>): Promise<void> {
  const t = await requireAdmin(deps.db, session.accountId)
  const mine = await deps.db.query('SELECT 1 FROM team_recovery_grants WHERE owner_account_id = $1 AND generation = $2 AND account_id = $3', [
    t.owner,
    input.generation,
    session.accountId
  ])
  if (!mine.length) throw new ApiError('FORBIDDEN', 'Du besitzt den Team-Schlüssel nicht.')
  const admins = new Set([t.owner, ...(await deps.db.query<{ account_id: string }>(`SELECT account_id FROM family_members WHERE owner_account_id = $1 AND role = 'admin'`, [t.owner])).map(r => r.account_id)])
  if (input.grants.some(g => !admins.has(g.accountId))) throw new ApiError('BAD_REQUEST', 'Nur Admins erhalten den Team-Schlüssel.')
  for (const g of input.grants) {
    await deps.db.query(
      `INSERT INTO team_recovery_grants (owner_account_id, generation, account_id, wrapped) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [t.owner, input.generation, g.accountId, JSON.stringify(g.wrapped)]
    )
  }
}

/** Mitglied hinterlegt seinen Master-Key (verpackt für den Team-Schlüssel). */
export async function escrowMasterKey(deps: Deps, session: SessionInfo, input: z.output<typeof escrowSchema>): Promise<void> {
  const t = await teamContext(deps.db, session.accountId)
  if (!t) throw new ApiError('PLAN_REQUIRED', 'Firmen-Notfallzugriff gibt es mit Business.')
  const key = await deps.db.query<{ generation: number }>('SELECT generation FROM team_recovery_keys WHERE owner_account_id = $1', [t.owner])
  if (Number(key[0]?.generation ?? 0) !== input.generation) throw new ApiError('VERSION_CONFLICT', 'Der Team-Schlüssel wurde erneuert – bitte neu laden.')
  await deps.db.query(
    `INSERT INTO team_escrow (account_id, owner_account_id, generation, wrapped) VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id) DO UPDATE SET owner_account_id = EXCLUDED.owner_account_id, generation = EXCLUDED.generation, wrapped = EXCLUDED.wrapped, created_at = now()`,
    [session.accountId, t.owner, input.generation, JSON.stringify(input.wrapped)]
  )
  await audit(deps.db, session.accountId, 'user', 'team.escrow_created', { team: t.owner, generation: input.generation })
}

export async function createRecoveryRequest(deps: Deps, session: SessionInfo, input: z.output<typeof recoveryRequestSchema>): Promise<{ id: string }> {
  const t = await requireAdmin(deps.db, session.accountId)
  const ids = await memberIds(deps.db, t.owner)
  if (!ids.includes(input.target)) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  if (input.target === session.accountId) throw new ApiError('BAD_REQUEST', 'Für das eigene Konto nicht möglich.')
  const esc = await deps.db.query('SELECT 1 FROM team_escrow WHERE account_id = $1 AND owner_account_id = $2', [input.target, t.owner])
  if (!esc.length) throw new ApiError('BAD_REQUEST', 'Dieses Mitglied hat keinen Schlüssel für den Firmen-Notfallzugriff hinterlegt.')
  const id = uuidv7()
  await deps.db.query(
    `INSERT INTO team_recovery_requests (id, owner_account_id, target, requested_by, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [id, t.owner, input.target, session.accountId, input.reason, REQUEST_TTL_DAYS]
  )
  await audit(deps.db, session.accountId, 'user', 'team.recovery_requested', { team: t.owner, member: input.target, requestId: id })
  return { id }
}

async function loadRequest(db: Db, owner: string, id: string) {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Antrag nicht gefunden.')
  const r = await db.query<{ id: string; target: string; requested_by: string; approved_by: string | null; approved_at: string | null; rejected_at: string | null; expires_at: string }>(
    'SELECT * FROM team_recovery_requests WHERE id = $1 AND owner_account_id = $2',
    [id, owner]
  )
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Antrag nicht gefunden.')
  return r[0]
}

/** Zweiter Admin gibt frei (Vier-Augen-Prinzip) oder lehnt ab. */
export async function decideRecoveryRequest(deps: Deps, session: SessionInfo, id: string, approve: boolean): Promise<void> {
  const t = await requireAdmin(deps.db, session.accountId)
  const r = await loadRequest(deps.db, t.owner, id)
  if (r.approved_at || r.rejected_at || new Date(r.expires_at).getTime() < Date.now()) throw new ApiError('BAD_REQUEST', 'Dieser Antrag ist bereits entschieden oder abgelaufen.')
  if (approve && r.requested_by === session.accountId) throw new ApiError('FORBIDDEN', 'Vier-Augen-Prinzip: Ein anderer Admin muss freigeben.')
  if (approve && r.target === session.accountId) throw new ApiError('FORBIDDEN', 'Für das eigene Konto nicht möglich.')
  await deps.db.query(
    approve ? 'UPDATE team_recovery_requests SET approved_by = $2, approved_at = now() WHERE id = $1' : 'UPDATE team_recovery_requests SET rejected_at = now(), approved_by = NULL WHERE id = $1',
    approve ? [id, session.accountId] : [id]
  )
  await audit(deps.db, session.accountId, 'user', approve ? 'team.recovery_approved' : 'team.recovery_rejected', { team: t.owner, member: r.target, requestId: id })
}

async function openRequest(db: Db, session: SessionInfo, id: string) {
  const t = await requireAdmin(db, session.accountId)
  const r = await loadRequest(db, t.owner, id)
  if (r.requested_by !== session.accountId && r.approved_by !== session.accountId) throw new ApiError('FORBIDDEN', 'Nur die beteiligten Admins haben Zugriff.')
  if (!r.approved_at || new Date(r.approved_at).getTime() + ACCESS_WINDOW_HOURS * 3_600_000 < Date.now()) throw new ApiError('FORBIDDEN', 'Kein freigegebener Zugriff (oder abgelaufen).')
  return { t, r }
}

/** Nach Freigabe: Hinterlegung, Team-Schlüssel-Hülle und Tresor-Index des Mitglieds (24 h, nur lesend). */
export async function recoveryVault(deps: Deps, session: SessionInfo, id: string) {
  const { t, r } = await openRequest(deps.db, session, id)
  const esc = await deps.db.query<{ generation: number; wrapped: unknown }>('SELECT generation, wrapped FROM team_escrow WHERE account_id = $1 AND owner_account_id = $2', [r.target, t.owner])
  if (!esc[0]) throw new ApiError('NOT_FOUND', 'Keine Hinterlegung vorhanden.')
  const grant = await deps.db.query<{ wrapped: unknown }>('SELECT wrapped FROM team_recovery_grants WHERE owner_account_id = $1 AND generation = $2 AND account_id = $3', [
    t.owner,
    esc[0].generation,
    session.accountId
  ])
  if (!grant[0]) throw new ApiError('FORBIDDEN', 'Du besitzt den Team-Schlüssel nicht – ein anderer Admin muss ihn dir zuerst weitergeben.')
  const key = await deps.db.query<{ public_key: JsonWebKey }>('SELECT public_key FROM team_recovery_keys WHERE owner_account_id = $1', [t.owner])
  const idx = await getIndex(deps, r.target)
  await audit(deps.db, session.accountId, 'user', 'team.recovery_opened', { team: t.owner, member: r.target, requestId: id })
  return {
    targetId: r.target,
    generation: Number(esc[0].generation),
    escrow: esc[0].wrapped,
    teamKey: grant[0].wrapped,
    teamPublicKey: key[0].public_key,
    body: idx ? Buffer.from(idx.body).toString('base64') : null
  }
}

export async function recoveryDownload(deps: Deps, session: SessionInfo, id: string, objectId: string): Promise<DownloadResult> {
  const { r } = await openRequest(deps.db, session, id)
  if (!isUuid(objectId)) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const pieces = await deps.db.query<{ piece_index: number; storage_key: string; cipher_bytes: number }>(
    `SELECT op.piece_index, op.storage_key, op.cipher_bytes::float8 AS cipher_bytes FROM object_pieces op JOIN objects o ON o.id = op.object_id
      WHERE o.id = $1 AND o.owner_account_id = $2 AND o.state = 'stored' ORDER BY op.piece_index`,
    [objectId, r.target]
  )
  if (!pieces.length) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  return {
    pieces: await Promise.all(pieces.map(async p => ({ index: Number(p.piece_index), cipherBytes: Number(p.cipher_bytes), ...(await deps.storage.presignGet(p.storage_key, 15 * 60)) })))
  }
}
