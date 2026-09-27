import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { accountView } from '@/server/accounts/service'
import { ApiError } from '@/server/shared/errors'
import { json, route } from '@/server/shared/http'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeResume } from '@/server/stripe/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Geplante Kündigung zurücknehmen. */
export const POST = route(async req => {
  const gw = stripeGateway()
  if (!gw) throw new ApiError('BAD_REQUEST', 'Online-Zahlung ist nicht eingerichtet.')
  const d = await deps()
  const session = await requireSession(req, d.db)
  await stripeResume(d, gw, session)
  return json(await accountView(d, session.accountId))
})
