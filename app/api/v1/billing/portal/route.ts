import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { ApiError } from '@/server/shared/errors'
import { json, route } from '@/server/shared/http'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeContext } from '@/server/stripe/http'
import { stripePortal } from '@/server/stripe/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Stripe-Kundenportal: Zahlungsmittel, Rechnungen, Kündigung. */
export const POST = route(async req => {
  const gw = stripeGateway()
  if (!gw) throw new ApiError('BAD_REQUEST', 'Online-Zahlung ist nicht eingerichtet.')
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json({ redirectUrl: await stripePortal(d, gw, session, stripeContext(req)) })
})
