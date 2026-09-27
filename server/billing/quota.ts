import { GB, type PricingConfig } from '../../lib/pricing'
import type { Plan } from '../../lib/api-types'
import type { Db } from '../db'

/** Business: individuell – bis zur Vertragsanbindung eine großzügige Sicherheitsgrenze. */
const BUSINESS_QUOTA_BYTES = 100 * 1e12

export interface QuotaBreakdown {
  quotaBytes: number
  baseBytes: number
  addonBytes: number
  paygBytes: number
}

/**
 * Quota = Plan-Basis + aktive Zusatzpakete (Abos) bzw. Pay-as-you-go-Obergrenze (Free).
 * Werte aus dem aktuellen Preisbuch → Preisänderungen wirken sofort, ohne Migration.
 */
export async function quotaFor(
  db: Db,
  account: { id: string; plan: Plan; payg_enabled?: boolean; payg_cap_gb?: number | null },
  pricing: PricingConfig
): Promise<QuotaBreakdown> {
  if (account.plan === 'business') {
    return { quotaBytes: BUSINESS_QUOTA_BYTES, baseBytes: BUSINESS_QUOTA_BYTES, addonBytes: 0, paygBytes: 0 }
  }
  if (account.plan === 'free') {
    const baseBytes = pricing.free.quotaGb * GB
    const capGb = account.payg_enabled ? Math.min(account.payg_cap_gb ?? pricing.payg.defaultCapGb, pricing.payg.maxCapGb) : 0
    const paygBytes = capGb * GB
    return { quotaBytes: baseBytes + paygBytes, baseBytes, addonBytes: 0, paygBytes }
  }
  const baseBytes = (account.plan === 'pro' ? pricing.plans.pro.quotaGb : pricing.plans.family.quotaGb) * GB
  const rows = await db.query<{ bytes: number }>(
    `SELECT COALESCE(SUM(bytes), 0)::float8 AS bytes FROM account_addons WHERE account_id = $1 AND status = 'active'`,
    [account.id]
  )
  const addonBytes = Number(rows[0]?.bytes ?? 0)
  return { quotaBytes: baseBytes + addonBytes, baseBytes, addonBytes, paygBytes: 0 }
}
