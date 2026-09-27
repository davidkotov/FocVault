import type { AdminStats, Plan } from '../../lib/api-types'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { isProd } from '../shared/env'
import { isUuid } from '../shared/ids'
import type { SessionInfo } from '../auth/sessions'
import { getPricing } from '../billing/settings'

const TB = 1e12
/** Fil One Listenpreis (docs.fil.one, 27.09.2026): $4.99 / TB / Monat, Minimum $4.99. */
const FILONE_USD_PER_TB_MONTH = 4.99

/** Nur Aggregate und Metadaten – der Admin sieht nie Inhalte oder Dateinamen (Zero-Knowledge). */
export async function adminStats(deps: Deps): Promise<AdminStats> {
  const [counts, byPlan, storage, uploads, accounts, events] = await Promise.all([
    deps.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM accounts'),
    deps.db.query<{ plan: Plan; n: number }>('SELECT plan, count(*)::float8 AS n FROM accounts GROUP BY plan'),
    deps.db.query<{ bytes: number; n: number }>(
      `SELECT COALESCE(SUM(cipher_bytes), 0)::float8 AS bytes, count(*)::float8 AS n FROM objects WHERE state = 'stored'`
    ),
    deps.db.query<{ n: number }>(`SELECT count(*)::float8 AS n FROM objects WHERE state = 'uploading'`),
    deps.db.query<{
      id: string
      email: string
      plan: Plan
      status: string
      created_at: Date
      stored: number
      objects: number
    }>(
      `SELECT a.id,
              COALESCE(a.email, a.label, (SELECT w.address FROM auth_wallets w WHERE w.account_id = a.id LIMIT 1), '—') AS email,
              a.plan, a.status, a.created_at,
              COALESCE(SUM(o.cipher_bytes) FILTER (WHERE o.state = 'stored'), 0)::float8 AS stored,
              (count(o.id) FILTER (WHERE o.state = 'stored'))::float8 AS objects
         FROM accounts a LEFT JOIN objects o ON o.owner_account_id = a.id
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100`
    ),
    deps.db.query<{ at: Date; kind: string; email: string | null }>(
      `SELECT e.at, e.kind,
              COALESCE(a.email, a.label, (SELECT w.address FROM auth_wallets w WHERE w.account_id = a.id LIMIT 1)) AS email
         FROM audit_events e LEFT JOIN accounts a ON a.id = e.account_id
        ORDER BY e.id DESC LIMIT 40`
    )
  ])
  const accountsByPlan: Record<Plan, number> = { free: 0, pro: 0, family: 0, business: 0 }
  for (const r of byPlan) accountsByPlan[r.plan] = Number(r.n)
  const storedBytes = Number(storage[0]?.bytes ?? 0)
  const pricing = await getPricing(deps.db)
  const addonMrr = await deps.db.query<{ chf: number }>(
    `SELECT COALESCE(SUM(ad.chf_per_month), 0)::float8 AS chf FROM account_addons ad JOIN accounts a ON a.id = ad.account_id
      WHERE ad.status = 'active' AND a.plan IN ('pro', 'family')`
  )
  const mrrChf =
    accountsByPlan.pro * pricing.plans.pro.chfPerMonth +
    accountsByPlan.family * pricing.plans.family.chfPerMonth +
    Number(addonMrr[0]?.chf ?? 0)
  return {
    environment: {
      storage: deps.storage.kind,
      storageDirect: deps.storage.direct,
      database: deps.db.driver,
      production: isProd
    },
    totals: {
      accounts: Number(counts[0]?.n ?? 0),
      accountsByPlan,
      storedBytes,
      objects: Number(storage[0]?.n ?? 0),
      uploadsInProgress: Number(uploads[0]?.n ?? 0)
    },
    economics: {
      storageCostUsdPerMonth: Math.max(FILONE_USD_PER_TB_MONTH, (storedBytes / TB) * FILONE_USD_PER_TB_MONTH),
      mrrChf: Math.round(mrrChf * 100) / 100
    },
    accounts: accounts.map(a => ({
      id: a.id,
      email: a.email,
      plan: a.plan,
      status: a.status,
      createdAt: new Date(a.created_at).toISOString(),
      storedBytes: Number(a.stored),
      objects: Number(a.objects)
    })),
    events: events.map(e => ({ at: new Date(e.at).toISOString(), kind: e.kind, email: e.email }))
  }
}

/**
 * Plan manuell setzen (bis Stripe in Phase 2 kommt). In Production nur für Admins aus
 * ADMIN_EMAILS – die Route prüft das über requireAdmin.
 */
export async function setPlan(deps: Deps, admin: SessionInfo, accountId: string, plan: Plan): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const rows = await deps.db.query('UPDATE accounts SET plan = $2 WHERE id = $1 RETURNING id', [accountId, plan])
  if (!rows.length) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  await audit(deps.db, accountId, 'admin', 'account.plan_changed', { plan, by: admin.accountId })
}
