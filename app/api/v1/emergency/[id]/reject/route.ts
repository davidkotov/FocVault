import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { rejectEmergency } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  await rejectEmergency(d, await requireSession(req, d.db), param(ctx, 'id'))
  return json({ ok: true })
})
