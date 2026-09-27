import { TIERS, type TierName } from '../../lib/vault'
import type { Plan } from '../../lib/api-types'
import type { Db } from '../db'

const TIER_OF: Record<Plan, TierName> = { free: 'FREE', pro: 'PRO', family: 'FAMILY', business: 'BUSINESS' }

export function tierOf(plan: Plan): TierName {
  return TIER_OF[plan]
}

export function quotaFor(plan: Plan): number {
  return TIERS[TIER_OF[plan]].maxBytes
}

/** Monatspreis in CHF für die MRR-Schätzung (Business = individuell → 0). */
export const PLAN_PRICE_CHF: Record<Plan, number> = { free: 0, pro: 13.9, family: 19.9, business: 0 }

/** Quota-Basis = Ciphertext-Bytes (inkl. Frame-Overhead), laufende Uploads sind reserviert. */
export async function usedBytes(db: Db, accountId: string): Promise<number> {
  const rows = await db.query<{ used: number }>(
    `SELECT COALESCE(SUM(cipher_bytes), 0)::float8 AS used
       FROM objects WHERE owner_account_id = $1 AND state IN ('uploading', 'stored')`,
    [accountId]
  )
  return Number(rows[0]?.used ?? 0)
}
