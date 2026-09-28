import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { creditsView } from '@/server/credits/service'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeHasPaymentMethod } from '@/server/stripe/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const gw = stripeGateway()
  const hasPaymentMethod = gw ? await stripeHasPaymentMethod(d, gw, session.accountId).catch(() => false) : false
  return json(await creditsView(d, session, { stripe: !!gw, hasPaymentMethod }))
})
