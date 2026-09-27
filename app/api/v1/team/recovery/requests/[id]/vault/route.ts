import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, param, route } from '@/server/shared/http'
import { recoveryVault } from '@/server/team/service'

export const GET = route(async (req, ctx) => {
  const d = await deps()
  return json(await recoveryVault(d, await requireSession(req, d.db), param(ctx, 'id')))
})
