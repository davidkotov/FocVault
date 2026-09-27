import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { currencySchema } from '@/server/billing/schemas'
import { setCurrency } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { currency } = await readJson(req, currencySchema)
  await setCurrency(d, session, currency)
  return json(await accountView(d, session.accountId))
})
