import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { changePlanSchema } from '@/server/billing/schemas'
import { changePlan } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'
import { stripeContext } from '@/server/stripe/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Planwechsel: mit Stripe Weiterleitung zum Checkout bzw. Umstellung des Abos; ohne Stripe nur in Dev. */
export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const r = await changePlan(d, session, await readJson(req, changePlanSchema), stripeContext(req))
  if (r.redirectUrl) return json({ redirectUrl: r.redirectUrl })
  return json(await accountView(d, session.accountId))
})
