import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { emergencyInviteInfo } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async (req, ctx) => {
  const d = await deps()
  await requireSession(req, d.db)
  return json(await emergencyInviteInfo(d, param(ctx, 'token')))
})
