import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { openSecret, sealSecret } from '../foc/config'
import { ApiError } from '../shared/errors'
import { BUCKET_RE, type LockMode, type Tenant } from './protocol'
import { AccountS3Store } from './store'

/**
 * Speicher-API (Business): Zugangsschlüssel, Buckets mit Object Lock und Aufbewahrungsregeln.
 * Das Secret wird nur einmal angezeigt und verschlüsselt gespeichert (für die SigV4-Prüfung nötig).
 */
const PLAN = 'business'
const MAX_KEYS = 20

async function assertBusiness(deps: Deps, session: SessionInfo) {
  const r = await deps.db.query<{ plan: string }>('SELECT plan FROM accounts WHERE id = $1', [session.accountId])
  if (r[0]?.plan !== PLAN) throw new ApiError('PLAN_REQUIRED', 'Die Speicher-API gibt es mit Business.')
}

export function s3PublicUrl(): string {
  return process.env.S3_PUBLIC_URL || `http://127.0.0.1:${process.env.S3_API_PORT || 9000}`
}

export async function createAccessKey(deps: Deps, session: SessionInfo, label: string): Promise<{ accessKey: string; secretKey: string }> {
  await assertBusiness(deps, session)
  const n = await deps.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM s3_keys WHERE account_id = $1 AND revoked_at IS NULL', [session.accountId])
  if (Number(n[0]?.n ?? 0) >= MAX_KEYS) throw new ApiError('BAD_REQUEST', `Höchstens ${MAX_KEYS} aktive Schlüssel.`)
  const accessKey = `FVB${randomBytes(10).toString('hex').toUpperCase()}`
  const secretKey = randomBytes(30).toString('base64url')
  await deps.db.query('INSERT INTO s3_keys (access_key, account_id, secret_enc, label) VALUES ($1, $2, $3, $4)', [
    accessKey,
    session.accountId,
    sealSecret(secretKey),
    label.trim().slice(0, 60) || 'Schlüssel'
  ])
  await audit(deps.db, session.accountId, 'user', 's3.key_created', { accessKey })
  return { accessKey, secretKey }
}

export async function revokeAccessKey(deps: Deps, session: SessionInfo, accessKey: string): Promise<void> {
  const r = await deps.db.query(`UPDATE s3_keys SET revoked_at = now() WHERE access_key = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING access_key`, [
    accessKey,
    session.accountId
  ])
  if (!r.length) throw new ApiError('NOT_FOUND', 'Schlüssel nicht gefunden.')
  await audit(deps.db, session.accountId, 'user', 's3.key_revoked', { accessKey })
}

/** Für den S3-Server: Access Key → Secret + Speicher des Kontos (nur aktive Business-Konten). */
export async function resolveTenant(deps: Deps, accessKey: string): Promise<Tenant | null> {
  if (!/^FVB[0-9A-F]{20}$/.test(accessKey)) return null
  const r = await deps.db.query<{ account_id: string; secret_enc: string; plan: string; status: string; last_used_at: string | null }>(
    `SELECT k.account_id, k.secret_enc, a.plan, a.status, k.last_used_at FROM s3_keys k JOIN accounts a ON a.id = k.account_id
      WHERE k.access_key = $1 AND k.revoked_at IS NULL`,
    [accessKey]
  )
  const k = r[0]
  if (!k || k.plan !== PLAN || k.status === 'suspended') return null
  if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60_000) {
    void deps.db.query('UPDATE s3_keys SET last_used_at = now() WHERE access_key = $1', [accessKey]).catch(() => undefined)
  }
  return { secret: openSecret(k.secret_enc), store: new AccountS3Store(deps, k.account_id) }
}

// ---------- Aufbewahrungsregeln (GFS: täglich / wöchentlich / monatlich / jährlich) ----------

export const retentionSchema = z
  .object({
    prefix: z.string().max(200).default(''),
    keepDaily: z.number().int().min(0).max(3650),
    keepWeekly: z.number().int().min(0).max(520),
    keepMonthly: z.number().int().min(0).max(240),
    keepYearly: z.number().int().min(0).max(100)
  })
  .refine(r => r.keepDaily + r.keepWeekly + r.keepMonthly + r.keepYearly > 0, { message: 'Mindestens eine Regel' })
export type RetentionRule = z.output<typeof retentionSchema>

export const bucketSettingsSchema = z.object({
  lock: z.object({ mode: z.enum(['GOVERNANCE', 'COMPLIANCE']), days: z.number().int().min(1).max(36500) }).nullable().optional(),
  retention: retentionSchema.nullable().optional()
})

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = t.getUTCFullYear()
  return `${y}-W${Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7)}`
}

/**
 * Welche Objekte eine GFS-Regel behält: je Tag/Woche/Monat/Jahr das neueste, für die letzten N
 * Perioden. Alles, was jünger als 24 h ist, bleibt immer. Rückgabe: Keys, die gelöscht werden dürfen.
 */
export function gfsExpired(objects: Array<{ key: string; created: Date }>, rule: RetentionRule, now = new Date()): string[] {
  const sorted = [...objects].sort((a, b) => b.created.getTime() - a.created.getTime())
  const keep = new Set<string>()
  const buckets: Array<[number, (d: Date) => string]> = [
    [rule.keepDaily, d => d.toISOString().slice(0, 10)],
    [rule.keepWeekly, isoWeek],
    [rule.keepMonthly, d => d.toISOString().slice(0, 7)],
    [rule.keepYearly, d => d.toISOString().slice(0, 4)]
  ]
  for (const [n, periodOf] of buckets) {
    if (!n) continue
    const seen = new Set<string>()
    for (const o of sorted) {
      const p = periodOf(o.created)
      if (seen.has(p)) continue
      if (seen.size >= n) break
      seen.add(p)
      keep.add(o.key)
    }
  }
  return sorted.filter(o => !keep.has(o.key) && now.getTime() - o.created.getTime() > 86_400_000).map(o => o.key)
}

/** Wartung: Aufbewahrungsregeln anwenden (gesperrte Objekte bleiben), alte Multipart-Uploads abbrechen. */
export async function applyS3Retention(deps: Deps, now = new Date()): Promise<{ expired: number; aborted: number }> {
  const buckets = await deps.db.query<{ account_id: string; name: string; retention: RetentionRule }>(
    'SELECT account_id, name, retention FROM s3_buckets WHERE retention IS NOT NULL'
  )
  let expired = 0
  for (const b of buckets) {
    const rule = retentionSchema.safeParse(b.retention)
    if (!rule.success) continue
    const store = new AccountS3Store(deps, b.account_id)
    const rows = await deps.db.query<{ key: string; created_at: string }>(
      `SELECT key, created_at FROM s3_objects WHERE account_id = $1 AND bucket = $2 AND key LIKE $3`,
      [b.account_id, b.name, rule.data.prefix.replace(/[\\%_]/g, m => '\\' + m) + '%']
    )
    for (const key of gfsExpired(rows.map(r => ({ key: r.key, created: new Date(r.created_at) })), rule.data, now)) {
      try {
        await store.delete(b.name, key, { bypassGovernance: false })
        expired++
      } catch {
        // gesperrt (Object Lock) – bleibt bis zum Fristende
      }
    }
  }
  const stale = await deps.db.query<{ upload_id: string; account_id: string; bucket: string; key: string }>(
    `SELECT upload_id, account_id, bucket, key FROM s3_uploads WHERE created_at < now() - interval '7 days'`
  )
  for (const u of stale) await new AccountS3Store(deps, u.account_id).mpAbort(u.upload_id, u.bucket, u.key).catch(() => undefined)
  return { expired, aborted: stale.length }
}

// ---------- Übersicht fürs Dashboard ----------

export interface S3Overview {
  endpoint: string
  region: string
  keys: Array<{ accessKey: string; label: string; createdAt: string; lastUsedAt: string | null }>
  buckets: Array<{
    name: string
    objects: number
    bytes: number
    onFilecoin: number
    objectLock: boolean
    lock: { mode: LockMode; days: number } | null
    retention: RetentionRule | null
    createdAt: string
  }>
}

export async function s3Overview(deps: Deps, session: SessionInfo): Promise<S3Overview> {
  await assertBusiness(deps, session)
  const keys = await deps.db.query<{ access_key: string; label: string; created_at: string; last_used_at: string | null }>(
    'SELECT access_key, label, created_at, last_used_at FROM s3_keys WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at',
    [session.accountId]
  )
  const buckets = await deps.db.query<{
    name: string
    object_lock: boolean
    lock_mode: LockMode | null
    lock_days: number | null
    retention: RetentionRule | null
    created_at: string
    n: number
    bytes: number
    secured: number
  }>(
    `SELECT b.name, b.object_lock, b.lock_mode, b.lock_days, b.retention, b.created_at,
            count(o.key)::float8 AS n, COALESCE(SUM(o.size), 0)::float8 AS bytes,
            count(o.key) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM object_pieces op LEFT JOIN foc_members m ON m.storage_key = op.storage_key AND m.deleted_at IS NULL
               WHERE op.object_id = o.object_id AND op.cipher_bytes > 0 AND m.storage_key IS NULL))::float8 AS secured
       FROM s3_buckets b LEFT JOIN s3_objects o ON o.account_id = b.account_id AND o.bucket = b.name
      WHERE b.account_id = $1 GROUP BY b.name, b.object_lock, b.lock_mode, b.lock_days, b.retention, b.created_at ORDER BY b.name`,
    [session.accountId]
  )
  return {
    endpoint: s3PublicUrl(),
    region: 'us-east-1',
    keys: keys.map(k => ({ accessKey: k.access_key, label: k.label, createdAt: new Date(k.created_at).toISOString(), lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null })),
    buckets: buckets.map(b => ({
      name: b.name,
      objects: Number(b.n),
      bytes: Number(b.bytes),
      onFilecoin: Number(b.secured),
      objectLock: b.object_lock,
      lock: b.lock_mode && b.lock_days ? { mode: b.lock_mode, days: Number(b.lock_days) } : null,
      retention: b.retention,
      createdAt: new Date(b.created_at).toISOString()
    }))
  }
}

export async function createBucketFromDashboard(deps: Deps, session: SessionInfo, name: string, objectLock: boolean): Promise<void> {
  await assertBusiness(deps, session)
  if (!BUCKET_RE.test(name)) throw new ApiError('BAD_REQUEST', 'Bucket-Name: 3–63 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Bindestrich.')
  try {
    await new AccountS3Store(deps, session.accountId).createBucket(name, { objectLock })
  } catch (e) {
    throw new ApiError('BAD_REQUEST', (e as Error).message)
  }
}

export async function updateBucket(deps: Deps, session: SessionInfo, name: string, input: z.output<typeof bucketSettingsSchema>): Promise<void> {
  await assertBusiness(deps, session)
  const store = new AccountS3Store(deps, session.accountId)
  const info = await store.bucketInfo(name)
  if (!info) throw new ApiError('NOT_FOUND', 'Bucket nicht gefunden.')
  if (input.lock !== undefined) {
    if (!info.objectLock) throw new ApiError('BAD_REQUEST', 'Object Lock lässt sich nur beim Anlegen des Buckets aktivieren.')
    // Eine COMPLIANCE-Standardfrist lässt sich nicht abschwächen
    if (info.defaultRetention?.mode === 'COMPLIANCE' && (!input.lock || input.lock.mode !== 'COMPLIANCE' || input.lock.days < info.defaultRetention.days)) {
      throw new ApiError('BAD_REQUEST', 'Eine COMPLIANCE-Frist lässt sich nur verlängern, nicht verkürzen oder abschalten.')
    }
    await store.setBucketLock(name, input.lock)
  }
  if (input.retention !== undefined) {
    await deps.db.query('UPDATE s3_buckets SET retention = $3 WHERE account_id = $1 AND name = $2', [session.accountId, name, input.retention ? JSON.stringify(input.retention) : null])
  }
  await audit(deps.db, session.accountId, 'user', 's3.bucket_updated', { name, lock: input.lock ?? undefined, retention: input.retention ?? undefined })
}
