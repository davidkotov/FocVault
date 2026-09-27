import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { getPricing, pricingSchema, setPricing } from '@/server/billing/settings'
import { audit } from '@/server/deps'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  return json(await getPricing(d.db))
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  const value = await readJson(req, pricingSchema)
  await setPricing(d.db, value, session.accountId)
  await audit(d.db, session.accountId, 'admin', 'admin.pricing_changed')
  return json(await getPricing(d.db))
})
