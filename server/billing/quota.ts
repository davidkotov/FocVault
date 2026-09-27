import { GB, type PricingConfig } from '../../lib/pricing'
import type { Plan } from '../../lib/api-types'
import type { Db } from '../db'
import { quotaAccountId } from '../family/service'


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
  if (account.plan === 'free') {
    const baseBytes = pricing.free.quotaGb * GB
    const capGb = account.payg_enabled ? Math.min(account.payg_cap_gb ?? pricing.payg.defaultCapGb, pricing.payg.maxCapGb) : 0
    const paygBytes = capGb * GB
    return { quotaBytes: baseBytes + paygBytes, baseBytes, addonBytes: 0, paygBytes }
  }
  // Family-/Team-Mitglieder teilen die Quota (inkl. Zusatzspeicher) des Inhabers
  const quotaId = account.plan === 'family' || account.plan === 'business' ? await quotaAccountId(db, account.id) : account.id
  let baseGb = account.plan === 'pro' ? pricing.plans.pro.quotaGb : pricing.plans.family.quotaGb
  if (account.plan === 'business') {
    const o = await db.query<{ business_tier: 'starter' | 'business' | 'enterprise' | null; custom_quota_gb: number | null }>(
      'SELECT business_tier, custom_quota_gb FROM accounts WHERE id = $1',
      [quotaId]
    )
    const tier = o[0]?.business_tier ?? 'business'
    baseGb = o[0]?.custom_quota_gb ?? (tier === 'enterprise' ? pricing.business.enterprise.quotaGb : pricing.business[tier].quotaGb)
  }
  const baseBytes = baseGb * GB
  const rows = await db.query<{ bytes: number }>(
    `SELECT COALESCE(SUM(bytes), 0)::float8 AS bytes FROM account_addons WHERE account_id = $1 AND status = 'active'`,
    [quotaId]
  )
  const addonBytes = Number(rows[0]?.bytes ?? 0)
  return { quotaBytes: baseBytes + addonBytes, baseBytes, addonBytes, paygBytes: 0 }
}
