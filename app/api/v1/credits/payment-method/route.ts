import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeContext } from '@/server/stripe/http'
import { stripeCardSetupUrl } from '@/server/stripe/service'
import { ApiError } from '@/server/shared/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Zahlungsmethode bei Stripe hinterlegen. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const gw = stripeGateway()
  if (!gw) throw new ApiError('BAD_REQUEST', 'Online-Zahlung (Stripe) ist noch nicht eingerichtet.')
  return json({ redirectUrl: await stripeCardSetupUrl(d, gw, session, stripeContext(req)) })
})
