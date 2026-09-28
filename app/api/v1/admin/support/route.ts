import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { listTickets } from '@/server/support/service'

export const GET = route(async req => {
  const d = await deps()
  await requireAdmin(d.db, await requireSession(req, d.db))
  const status = new URL(req.url).searchParams.get('status') ?? undefined
  return json({ tickets: await listTickets(d, status && ['open', 'answered', 'closed'].includes(status) ? status : undefined) })
})
