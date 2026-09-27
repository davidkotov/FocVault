import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, route } from '@/server/shared/http'
import { teamAdminView } from '@/server/team/service'

export const GET = route(async req => {
  const d = await deps()
  return json(await teamAdminView(d, await requireSession(req, d.db)))
})
