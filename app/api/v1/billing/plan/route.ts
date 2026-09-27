import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { changePlanSchema } from '@/server/billing/schemas'
import { changePlan } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Planwechsel (Self-Service). Ohne Stripe nur im Entwicklungsmodus. */
export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await changePlan(d, session, await readJson(req, changePlanSchema))
  return json(await accountView(d, session.accountId))
})
