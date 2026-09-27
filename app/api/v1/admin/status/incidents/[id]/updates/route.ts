import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { addIncidentUpdate, incidentUpdateSchema } from '@/server/status/service'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await addIncidentUpdate(d, session.accountId, param(ctx, 'id'), await readJson(req, incidentUpdateSchema))
  return json({ ok: true })
})
