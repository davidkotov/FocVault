import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { completeObject } from '@/server/objects/service'
import { json, param, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await completeObject(d, session, param(ctx, 'id')))
})
