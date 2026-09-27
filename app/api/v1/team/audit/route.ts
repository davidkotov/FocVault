import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, route } from '@/server/shared/http'
import { auditQuerySchema, teamAudit } from '@/server/team/service'
import { ApiError } from '@/server/shared/errors'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const q = auditQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!q.success) throw new ApiError('BAD_REQUEST', 'Ungültige Filter.')
  return json({ events: await teamAudit(d, session, q.data) })
})
