import { z } from 'zod'

export const buyAddonSchema = z.object({ packId: z.string().regex(/^[a-z0-9-]{1,40}$/) })
export const paygSchema = z.object({ enabled: z.boolean(), capGb: z.number().int().min(1).max(1_000_000).optional() })
export const grantAddonSchema = z.object({
  gb: z.number().int().min(1).max(1_000_000),
  chfPerMonth: z.number().min(0).max(100_000),
  note: z.string().max(200).optional()
})
export const adminAccountSchema = z.object({
  plan: z.enum(['free', 'pro', 'family', 'business']).optional(),
  paygEnabled: z.boolean().optional(),
  paygCapGb: z.number().int().min(1).max(1_000_000).optional(),
  status: z.enum(['active', 'readonly', 'suspended']).optional()
})
