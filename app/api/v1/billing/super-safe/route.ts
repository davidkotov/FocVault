import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { buySuperSafe, cancelSuperSafe } from '@/server/billing/super-safe'
import { accountView } from '@/server/accounts/service'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Super Safe buchen (mehr Filecoin-Kopien, Preis je TB Quota). */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await buySuperSafe(d, session)
  return json(await accountView(d, session.accountId), 201)
})

/** Super Safe kündigen – die zusätzlichen Kopien werden beim nächsten Filecoin-Abgleich freigegeben. */
export const DELETE = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await cancelSuperSafe(d, session)
  return json(await accountView(d, session.accountId))
})
