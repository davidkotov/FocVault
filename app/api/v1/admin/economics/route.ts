import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { economicsReport } from '@/server/billing/service'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  return json(await economicsReport(d))
})
