import { z } from 'zod'
import { DEFAULT_PRICING, type PricingConfig } from '../../lib/pricing'
import type { Db } from '../db'

const money = z.number().min(0).max(100_000)
const gb = z.number().int().min(1).max(1_000_000)

export const pricingSchema = z.object({
  filOneUsdPerTbMonth: money,
  filOneMinUsd: money,
  usdToChf: z.number().min(0.1).max(5),
  stripePercent: z.number().min(0).max(20),
  stripeFixedChf: money,
  free: z.object({ quotaGb: gb }),
  payg: z.object({ chfPerGbMonth: z.number().min(0).max(10), minInvoiceChf: money, defaultCapGb: gb, maxCapGb: gb }),
  plans: z.object({
    pro: z.object({ label: z.string().min(1).max(40), quotaGb: gb, chfPerMonth: money }),
    family: z.object({ label: z.string().min(1).max(40), quotaGb: gb, chfPerMonth: money, seats: z.number().int().min(1).max(50) })
  }),
  addons: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), gb, chfPerMonth: money }))
    .max(12)
    .refine(list => new Set(list.map(a => a.id)).size === list.length, { message: 'Paket-IDs müssen eindeutig sein' }),
  freeTier: z.object({
    monthlyBudgetChf: money,
    inactiveWarnDays: z.number().int().min(30).max(3650),
    inactiveDeleteDays: z.number().int().min(60).max(3650)
  })
})

export const treasurySchema = z.object({
  /** Nur die öffentliche Adresse – nie ein privater Schlüssel. */
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Wallet-Adresse (0x…) erwartet')
    .or(z.literal('')),
  chainId: z.union([z.literal(314), z.literal(314159)]),
  /** Freitext, z. B. „Reserve Free-Tier" */
  label: z.string().max(80)
})

export type TreasuryConfig = z.output<typeof treasurySchema>
export const DEFAULT_TREASURY: TreasuryConfig = { address: '', chainId: 314, label: 'Krypto-Reserve' }

async function read<T>(db: Db, key: string): Promise<T | null> {
  const rows = await db.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key])
  return rows[0]?.value ?? null
}

async function write(db: Db, key: string, value: unknown, by: string | null): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), by]
  )
}

/** Gespeichertes Preisbuch, fehlende Felder mit Standardwerten ergänzt. */
export async function getPricing(db: Db): Promise<PricingConfig> {
  const stored = await read<Partial<PricingConfig>>(db, 'pricing')
  if (!stored) return DEFAULT_PRICING
  const merged = {
    ...DEFAULT_PRICING,
    ...stored,
    free: { ...DEFAULT_PRICING.free, ...stored.free },
    payg: { ...DEFAULT_PRICING.payg, ...stored.payg },
    plans: {
      pro: { ...DEFAULT_PRICING.plans.pro, ...stored.plans?.pro },
      family: { ...DEFAULT_PRICING.plans.family, ...stored.plans?.family }
    },
    freeTier: { ...DEFAULT_PRICING.freeTier, ...stored.freeTier },
    addons: stored.addons ?? DEFAULT_PRICING.addons
  }
  const parsed = pricingSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_PRICING
}

export async function setPricing(db: Db, value: PricingConfig, by: string): Promise<void> {
  await write(db, 'pricing', pricingSchema.parse(value), by)
}

export async function getTreasury(db: Db): Promise<TreasuryConfig> {
  const stored = await read<TreasuryConfig>(db, 'treasury')
  const parsed = treasurySchema.safeParse({ ...DEFAULT_TREASURY, ...stored })
  return parsed.success ? parsed.data : DEFAULT_TREASURY
}

export async function setTreasury(db: Db, value: TreasuryConfig, by: string): Promise<void> {
  await write(db, 'treasury', treasurySchema.parse(value), by)
}
