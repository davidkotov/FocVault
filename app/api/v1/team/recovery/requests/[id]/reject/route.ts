import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, param, route } from '@/server/shared/http'
import { decideRecoveryRequest } from '@/server/team/service'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  await decideRecoveryRequest(d, await requireSession(req, d.db), param(ctx, 'id'), false)
  return json({ ok: true })
})
