import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { ticketUpdateSchema, updateTicket } from '@/server/support/service'

export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await updateTicket(d, session.accountId, param(ctx, 'id'), await readJson(req, ticketUpdateSchema))
  return json({ ok: true })
})
