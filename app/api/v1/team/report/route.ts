import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, route } from '@/server/shared/http'
import { complianceData } from '@/server/team/service'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days') ?? 90) || 90))
  return json(await complianceData(d, session, days))
})
