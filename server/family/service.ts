import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { getPricing } from '../billing/settings'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'
import { detachFromSpace } from './space'

/**
 * Family: Das Konto mit dem Family-Abo ist Eigentümer; bis zu (Plätze − 1) weitere Konten treten per
 * Einladungslink bei. Alle teilen die Speicher-Quota des Eigentümers und erhalten die Pro-Module.
 * Jedes Mitglied behält sein eigenes Konto, seine eigene Passphrase und seinen eigenen Tresor –
 * niemand in der Familie (auch nicht der Eigentümer) kann die Dateien der anderen lesen.
 */
const INVITE_DAYS = 7
/** Pläne mit Mitgliedern: Family (privat) und Business (Team) */
export const GROUP_PLANS = new Set(['family', 'business'])

/** Plätze inklusive Inhaber: Family laut Preisbuch, Business laut gebuchten Nutzern. */
export async function groupSeats(db: Db, ownerId: string): Promise<number> {
  const pricing = await getPricing(db)
  const r = await db.query<{ plan: string; seats: number | null; business_tier: 'starter' | 'business' | 'enterprise' | null }>(
    'SELECT plan, seats, business_tier FROM accounts WHERE id = $1',
    [ownerId]
  )
  const a = r[0]
  if (a?.plan !== 'business') return pricing.plans.family.seats
  const tier = a.business_tier ?? 'business'
  return a.seats ?? (tier === 'enterprise' ? pricing.business.enterprise.seats : pricing.business[tier].seats)
}
const hash = (token: string) => createHash('sha256').update(token).digest()

/** Freier Platz für ein weiteres Mitglied? (Plätze zählen inklusive Inhaber; offene Einladungen zählen hier nicht.) */
export async function assertFreeSeat(db: Db, ownerId: string): Promise<void> {
  const seats = await groupSeats(db, ownerId)
  const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM family_members WHERE owner_account_id = $1', [ownerId])
  if (Number(n[0]?.n ?? 0) >= seats - 1) throw new ApiError('BAD_REQUEST', `Alle ${seats} Plätze sind belegt. Bitte beim Inhaber weitere Plätze anfragen.`)
}

export interface FamilyPool {
  ownerId: string
  memberIds: string[]
}

/** Speicher-Pool eines Kontos (Eigentümer + Mitglieder) oder null, wenn es keiner Familie angehört. */
export async function familyPool(db: Db, accountId: string): Promise<FamilyPool | null> {
  const m = await db.query<{ owner_account_id: string }>('SELECT owner_account_id FROM family_members WHERE account_id = $1', [accountId])
  const ownerId = m[0]?.owner_account_id ?? accountId
  const fam = await db.query('SELECT 1 FROM families WHERE owner_account_id = $1', [ownerId])
  if (!fam.length) return null
  const members = await db.query<{ account_id: string }>('SELECT account_id FROM family_members WHERE owner_account_id = $1', [ownerId])
  return { ownerId, memberIds: members.map(r => r.account_id) }
}

/** Belegter Speicher: bei Familien der ganze Pool, sonst das eigene Konto. */
export async function pooledUsedBytes(db: Db, accountId: string): Promise<number> {
  const pool = await familyPool(db, accountId)
  const ids = pool ? [pool.ownerId, ...pool.memberIds] : [accountId]
  const rows = await db.query<{ used: number }>(
    `SELECT COALESCE(SUM(cipher_bytes), 0)::float8 AS used FROM objects
      WHERE owner_account_id = ANY($1::uuid[]) AND state IN ('uploading', 'stored', 'version', 'trashed')`,
    [ids]
  )
  return Number(rows[0]?.used ?? 0)
}

export async function isFamilyMember(db: Db, accountId: string): Promise<boolean> {
  return (await db.query('SELECT 1 FROM family_members WHERE account_id = $1', [accountId])).length > 0
}

/** Konto, dessen Quota gilt (Mitglieder rechnen mit der Quota des Eigentümers). */
export async function quotaAccountId(db: Db, accountId: string): Promise<string> {
  const m = await db.query<{ owner_account_id: string }>('SELECT owner_account_id FROM family_members WHERE account_id = $1', [accountId])
  return m[0]?.owner_account_id ?? accountId
}

/**
 * Nach jeder Planänderung aufrufen: Verliert der Eigentümer Family, werden alle Mitglieder auf Free
 * gesetzt (ihre Daten bleiben; über der Free-Quota sind nur Uploads gesperrt).
 */
export async function syncFamilyAfterPlanChange(db: Db, accountId: string): Promise<void> {
  const acc = await db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [accountId])
  const plan = acc[0]?.plan
  if (plan && GROUP_PLANS.has(plan)) {
    // Mitglieder folgen dem Plan des Inhabers (z. B. Wechsel Family → Business)
    await db.query(
      `UPDATE accounts SET plan = $2 WHERE id IN (SELECT account_id FROM family_members WHERE owner_account_id = $1) AND plan IN ('family', 'business')`,
      [accountId, plan]
    )
    return
  }
  // Mitglied bekommt einen anderen Plan (z. B. vom Admin) → verlässt die Familie
  await db.tx(async tx => {
    const left = await tx.query<{ owner_account_id: string }>('DELETE FROM family_members WHERE account_id = $1 RETURNING owner_account_id', [accountId])
    if (left[0]) await dropTeamRecovery(tx, accountId, left[0].owner_account_id)
  })
  const members = await db.query<{ account_id: string }>('SELECT account_id FROM family_members WHERE owner_account_id = $1', [accountId])
  if (!members.length && !(await db.query('SELECT 1 FROM families WHERE owner_account_id = $1', [accountId])).length) return
  // Die Familie selbst bleibt bestehen (Familienordner liest der Inhaber weiter); Mitglieder und
  // offene Einladungen enden, deren Familienordner-Dateien gehen an den Inhaber.
  for (const m of members) {
    await db.tx(async tx => {
      await detachFromSpace(tx, m.account_id, accountId)
      await dropTeamRecovery(tx, m.account_id, accountId)
      await tx.query('DELETE FROM family_members WHERE account_id = $1', [m.account_id])
      await tx.query(`UPDATE accounts SET plan = 'free', payg_enabled = false WHERE id = $1 AND plan IN ('family', 'business')`, [m.account_id])
      await audit(tx, m.account_id, 'system', 'family.ended', {})
    })
  }
  await db.query('UPDATE family_invites SET revoked_at = now() WHERE owner_account_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [accountId])
}

export interface FamilyView {
  role: 'owner' | 'member' | null
  /** Family (privat) oder Business-Team */
  kind: 'family' | 'business'
  ownerLabel: string | null
  seats: number
  members: Array<{ id: string; label: string; usedBytes: number; joinedAt: string | null; owner: boolean; you: boolean }>
  invites: Array<{ id: string; expiresAt: string }>
}

async function label(db: Db, id: string): Promise<string> {
  const r = await db.query<{ email: string | null; label: string | null }>('SELECT email, label FROM accounts WHERE id = $1', [id])
  return r[0]?.email ?? r[0]?.label ?? 'Konto'
}

export async function familyView(deps: Deps, session: SessionInfo): Promise<FamilyView> {
  const acc = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  const member = await isFamilyMember(deps.db, session.accountId)
  const kind = acc[0]?.plan === 'business' ? 'business' : 'family'
  if (!member && !GROUP_PLANS.has(acc[0]?.plan ?? '')) {
    return { role: null, kind, ownerLabel: null, seats: (await getPricing(deps.db)).plans.family.seats, members: [], invites: [] }
  }
  const ownerId = await quotaAccountId(deps.db, session.accountId)
  const seats = await groupSeats(deps.db, ownerId)
  const rows = await deps.db.query<{ id: string; email: string | null; label: string | null; joined_at: string | null; used: number }>(
    `SELECT a.id, a.email, a.label, m.joined_at,
            COALESCE((SELECT SUM(o.cipher_bytes) FROM objects o WHERE o.owner_account_id = a.id
                       AND o.state IN ('uploading', 'stored', 'version', 'trashed')), 0)::float8 AS used
       FROM accounts a LEFT JOIN family_members m ON m.account_id = a.id
      WHERE a.id = $1 OR m.owner_account_id = $1
      ORDER BY (a.id = $1) DESC, m.joined_at`,
    [ownerId]
  )
  const invites =
    ownerId === session.accountId
      ? await deps.db.query<{ id: string; expires_at: string }>(
          `SELECT id, expires_at FROM family_invites
            WHERE owner_account_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
          [ownerId]
        )
      : []
  return {
    role: ownerId === session.accountId ? 'owner' : 'member',
    kind,
    ownerLabel: await label(deps.db, ownerId),
    seats,
    members: rows.map(r => ({
      id: r.id,
      label: r.email ?? r.label ?? 'Konto',
      usedBytes: Number(r.used),
      joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
      owner: r.id === ownerId,
      you: r.id === session.accountId
    })),
    invites: invites.map(i => ({ id: i.id, expiresAt: new Date(i.expires_at).toISOString() }))
  }
}

async function assertOwner(deps: Deps, session: SessionInfo): Promise<void> {
  const acc = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  if (!GROUP_PLANS.has(acc[0]?.plan ?? '') || (await isFamilyMember(deps.db, session.accountId))) {
    throw new ApiError('PLAN_REQUIRED', 'Einladen können Inhaber eines Family- oder Business-Abos.')
  }
  await deps.db.query('INSERT INTO families (owner_account_id) VALUES ($1) ON CONFLICT DO NOTHING', [session.accountId])
}

/** Einladungslink (einmalig, 7 Tage gültig). Der Token wird nur gehasht gespeichert. */
export async function createInvite(deps: Deps, session: SessionInfo): Promise<{ token: string; expiresAt: string }> {
  await assertOwner(deps, session)
  const seats = await groupSeats(deps.db, session.accountId)
  const used = await deps.db.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM family_members WHERE owner_account_id = $1)
          + (SELECT count(*) FROM family_invites WHERE owner_account_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now())
            AS n`,
    [session.accountId]
  )
  if (Number(used[0]?.n ?? 0) >= seats - 1) {
    throw new ApiError('BAD_REQUEST', `Alle ${seats} Plätze sind belegt oder eingeladen. Offene Einladungen lassen sich zurückziehen.`)
  }
  const token = randomBytes(24).toString('base64url')
  const rows = await deps.db.query<{ expires_at: string }>(
    `INSERT INTO family_invites (id, owner_account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING expires_at`,
    [uuidv7(), session.accountId, hash(token), INVITE_DAYS]
  )
  await audit(deps.db, session.accountId, 'user', 'family.invited', {})
  return { token, expiresAt: new Date(rows[0].expires_at).toISOString() }
}

export async function revokeInvite(deps: Deps, session: SessionInfo, inviteId: string): Promise<void> {
  if (!isUuid(inviteId)) throw new ApiError('NOT_FOUND', 'Einladung nicht gefunden.')
  const r = await deps.db.query(
    `UPDATE family_invites SET revoked_at = now() WHERE id = $1 AND owner_account_id = $2 AND used_at IS NULL RETURNING id`,
    [inviteId, session.accountId]
  )
  if (!r.length) throw new ApiError('NOT_FOUND', 'Einladung nicht gefunden.')
}

/** Vorschau für den Beitritt: von wem ist die Einladung? */
export async function inviteInfo(deps: Deps, token: string): Promise<{ ownerLabel: string; expiresAt: string; kind: 'family' | 'business' }> {
  const r = await deps.db.query<{ owner_account_id: string; expires_at: string }>(
    `SELECT owner_account_id, expires_at FROM family_invites
      WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [hash(token)]
  )
  if (!r[0]) throw new ApiError('GONE', 'Diese Einladung ist abgelaufen, wurde schon benutzt oder zurückgezogen.')
  const plan = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [r[0].owner_account_id])
  return { ownerLabel: await label(deps.db, r[0].owner_account_id), expiresAt: new Date(r[0].expires_at).toISOString(), kind: plan[0]?.plan === 'business' ? 'business' : 'family' }
}

/**
 * Beitreten: nur ohne eigenes laufendes Abo. Der eigene Speicher zählt ab dann zum Pool – passt er
 * nicht mehr hinein, wird der Beitritt abgelehnt.
 */
export async function joinFamily(deps: Deps, session: SessionInfo, token: string): Promise<void> {
  await deps.db.tx(async tx => {
    const inv = await tx.query<{ id: string; owner_account_id: string }>(
      `SELECT id, owner_account_id FROM family_invites
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hash(token)]
    )
    if (!inv[0]) throw new ApiError('GONE', 'Diese Einladung ist abgelaufen, wurde schon benutzt oder zurückgezogen.')
    const ownerId = inv[0].owner_account_id
    if (ownerId === session.accountId) throw new ApiError('BAD_REQUEST', 'Das ist deine eigene Einladung.')
    const me = await tx.query<{ plan: string; stripe_subscription_id: string | null }>(
      'SELECT plan, stripe_subscription_id FROM accounts WHERE id = $1 FOR UPDATE',
      [session.accountId]
    )
    if (await isFamilyMember(tx, session.accountId)) throw new ApiError('BAD_REQUEST', 'Du bist bereits Mitglied einer Familie.')
    if (me[0]?.plan !== 'free' || me[0]?.stripe_subscription_id) {
      throw new ApiError('BAD_REQUEST', 'Bitte zuerst dein eigenes Abo kündigen – danach kannst du beitreten.')
    }
    // Zeile des Inhabers sperren: gleichzeitige Beitritte zählen die Plätze nacheinander
    const owner = await tx.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1 FOR UPDATE', [ownerId])
    if (!GROUP_PLANS.has(owner[0]?.plan ?? '')) throw new ApiError('GONE', 'Diese Einladung gehört zu keinem aktiven Abo mehr.')
    await assertFreeSeat(tx, ownerId)
    await tx.query(`INSERT INTO family_members (account_id, owner_account_id) VALUES ($1, $2)`, [session.accountId, ownerId])
    await tx.query(`UPDATE accounts SET plan = $2, payg_enabled = false WHERE id = $1`, [session.accountId, owner[0].plan])
    await tx.query(`UPDATE family_invites SET used_at = now(), used_by = $2 WHERE id = $1`, [inv[0].id, session.accountId])
    await audit(tx, session.accountId, 'user', 'family.joined', {})
    await audit(tx, ownerId, 'system', 'family.member_joined', {})
  })
}

/**
 * Firmen-Notfallzugriff beim Austritt beenden: hinterlegten Master-Key und die für das Konto verpackten
 * Team-Schlüssel (falls es Admin war) löschen. Innerhalb der Transaktion des Austritts aufrufen.
 */
async function dropTeamRecovery(db: Db, memberId: string, owner: string): Promise<void> {
  await db.query('DELETE FROM team_escrow WHERE account_id = $1 AND owner_account_id = $2', [memberId, owner])
  await db.query('DELETE FROM team_recovery_grants WHERE account_id = $1 AND owner_account_id = $2', [memberId, owner])
}

/** Mitglied entfernen (Inhaber) oder selbst austreten. Das Konto fällt auf Free zurück, Daten bleiben. */
export async function removeMember(deps: Deps, session: SessionInfo, memberId: string): Promise<void> {
  if (!isUuid(memberId)) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
  const self = memberId === session.accountId
  await deps.db.tx(async tx => {
    const r = await tx.query<{ owner_account_id: string }>(
      `DELETE FROM family_members WHERE account_id = $1 AND ${self ? 'TRUE' : 'owner_account_id = $2'} RETURNING owner_account_id`,
      self ? [memberId] : [memberId, session.accountId]
    )
    if (!r.length) throw new ApiError('NOT_FOUND', 'Mitglied nicht gefunden.')
    await detachFromSpace(tx, memberId, r[0].owner_account_id)
    await dropTeamRecovery(tx, memberId, r[0].owner_account_id)
    await tx.query(`UPDATE accounts SET plan = 'free', payg_enabled = false WHERE id = $1 AND plan IN ('family', 'business')`, [memberId])
    await audit(tx, memberId, self ? 'user' : 'system', self ? 'family.left' : 'family.removed', {})
  })
}
