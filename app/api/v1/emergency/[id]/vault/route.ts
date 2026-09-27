import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { emergencyVault } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async (req, ctx) => {
  const d = await deps()
  return json(await emergencyVault(d, await requireSession(req, d.db), param(ctx, 'id')))
})
