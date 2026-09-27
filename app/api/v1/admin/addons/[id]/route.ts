import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { cancelAddon } from '@/server/billing/service'

export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await cancelAddon(d, session, param(ctx, 'id'), 'admin')
  return json({ ok: true })
})
