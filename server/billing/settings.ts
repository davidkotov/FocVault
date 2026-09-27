import { z } from 'zod'
import { DEFAULT_PRICING, type PricingConfig } from '../../lib/pricing'
import type { Db } from '../db'

const amount = z.number().min(0).max(100_000)
const gb = z.number().int().min(1).max(1_000_000)
const moneySchema = z.object({ CHF: amount, EUR: amount, USD: amount })
const priced = { monthly: moneySchema, yearly: moneySchema }

export const pricingSchema = z.object({
  v: z.literal(2),
  filOneUsdPerTbMonth: amount,
  filOneMinUsd: amount,
  fx: z.object({ usdToChf: z.number().min(0.1).max(5), eurToChf: z.number().min(0.1).max(5) }),
  stripePercent: z.number().min(0).max(20),
  stripeFixedChf: amount,
  free: z.object({ quotaGb: gb }),
  payg: z.object({
    perGbMonth: z.object({ CHF: z.number().min(0).max(10), EUR: z.number().min(0).max(10), USD: z.number().min(0).max(10) }),
    minInvoice: moneySchema,
    defaultCapGb: gb,
    maxCapGb: gb
  }),
  plans: z.object({
    pro: z.object({ label: z.string().min(1).max(40), quotaGb: gb, ...priced }),
    family: z.object({ label: z.string().min(1).max(40), quotaGb: gb, seats: z.number().int().min(1).max(50), ...priced })
  }),
  addons: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), gb, ...priced }))
    .min(1)
    .max(12)
    .refine(list => new Set(list.map(a => a.id)).size === list.length, { message: 'Paket-IDs müssen eindeutig sein' }),
  freeTier: z.object({
    monthlyBudgetChf: amount,
    inactiveWarnDays: z.number().int().min(30).max(3650),
    inactiveDeleteDays: z.number().int().min(60).max(3650)
  }),
  trashDays: z.number().int().min(1).max(365),
  versions: z.object({ days: z.number().int().min(1).max(365), max: z.number().int().min(1).max(100) }),
  storage: z.object({
    backend: z.enum(['filone', 'foc', 'both']),
    focUsdPerTibMonthPerCopy: amount,
    focCopies: z.number().int().min(1).max(5)
  }),
  api: z.object({
    perGbMonth: z.object({ CHF: z.number().min(0).max(10), EUR: z.number().min(0).max(10), USD: z.number().min(0).max(10) }),
    egressPerGb: z.object({ CHF: z.number().min(0).max(10), EUR: z.number().min(0).max(10), USD: z.number().min(0).max(10) }),
    includedEgressRatio: z.number().min(0).max(100),
    minMonthly: moneySchema
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
  if (!stored || stored.v !== 2) return DEFAULT_PRICING
  // Neue Abschnitte (z. B. storage, api) mit Standardwerten ergänzen, statt alles zu verwerfen.
  const parsed = pricingSchema.safeParse({ ...DEFAULT_PRICING, ...stored })
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
