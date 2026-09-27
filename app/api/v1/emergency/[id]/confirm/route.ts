import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'
import { confirmEmergency, confirmEmergencySchema } from '@/server/emergency/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await confirmEmergency(d, session, param(ctx, 'id'), await readJson(req, confirmEmergencySchema))
  return json({ ok: true })
})
