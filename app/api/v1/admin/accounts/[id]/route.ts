import { deps } from '@/server/deps'
import { planSchema } from '@/server/accounts/schemas'
import { setPlan } from '@/server/admin/service'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  requireAdmin(session)
  const { plan } = await readJson(req, planSchema)
  await setPlan(d, session, param(ctx, 'id'), plan)
  return json({ ok: true })
})
