import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { paygSchema } from '@/server/billing/schemas'
import { setPayg } from '@/server/billing/service'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { enabled, capGb } = await readJson(req, paygSchema)
  await setPayg(d, session, enabled, capGb)
  return json(await accountView(d, session.accountId))
})
