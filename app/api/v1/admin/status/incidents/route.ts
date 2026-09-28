import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { createIncident, incidentSchema } from '@/server/status/service'

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  return json(await createIncident(d, session.accountId, await readJson(req, incidentSchema)), 201)
})
