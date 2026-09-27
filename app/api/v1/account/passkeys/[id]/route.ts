import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { accountView } from '@/server/accounts/service'
import { removePasskey } from '@/server/accounts/passkeys'
import { json, param, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await removePasskey(d, session, param(ctx, 'id'))
  return json(await accountView(d, session.accountId))
})
