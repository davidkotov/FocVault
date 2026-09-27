import { deps } from '@/server/deps'
import { adminStats } from '@/server/admin/service'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  return json(await adminStats(d))
})
