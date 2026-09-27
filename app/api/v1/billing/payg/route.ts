import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { paygSchema } from '@/server/billing/schemas'
import { setPayg } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'
import { stripeContext } from '@/server/stripe/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { enabled, capGb } = await readJson(req, paygSchema)
  const r = await setPayg(d, session, enabled, capGb, stripeContext(req))
  if (r.redirectUrl) return json({ redirectUrl: r.redirectUrl })
  return json(await accountView(d, session.accountId))
})
