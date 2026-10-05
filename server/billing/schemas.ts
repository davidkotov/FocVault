import { z } from 'zod'

const currency = z.enum(['CHF', 'EUR', 'USD'])
const interval = z.enum(['month', 'year'])

export const buyAddonSchema = z.object({ packId: z.string().regex(/^[a-z0-9-]{1,40}$/) })
export const paygSchema = z.object({ enabled: z.boolean(), capGb: z.number().int().min(1).max(1_000_000).optional() })
export const changePlanSchema = z.object({
  plan: z.enum(['free', 'pro', 'family', 'business']),
  interval,
  currency,
  /** Business: Stufe (Enterprise nur per Vertrag) und zusätzliche Nutzer */
  tier: z.enum(['starter', 'business']).optional(),
  extraSeats: z.number().int().min(0).max(10000).optional()
})
export const currencySchema = z.object({ currency })
export const grantAddonSchema = z.object({
  gb: z.number().int().min(1).max(1_000_000),
  price: z.number().min(0).max(100_000),
  note: z.string().max(200).optional()
})
export const adminAccountSchema = z.object({
  plan: z.enum(['free', 'pro', 'family', 'business']).optional(),
  interval: interval.optional(),
  currency: currency.optional(),
  paygEnabled: z.boolean().optional(),
  paygCapGb: z.number().int().min(1).max(1_000_000).optional(),
  status: z.enum(['active', 'readonly', 'suspended']).optional()
})
export const adminSuperSafeSchema = z.object({
  enabled: z.boolean(),
  /** Preis je TB und Intervall (Standard 0 = Kulanz) */
  unitPrice: z.number().min(0).max(100_000).optional(),
  note: z.string().max(200).optional()
})
