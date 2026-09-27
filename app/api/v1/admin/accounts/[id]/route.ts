import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { adminAccountSchema } from '@/server/billing/schemas'
import { adminUpdateAccount } from '@/server/billing/service'

export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await adminUpdateAccount(d, session, param(ctx, 'id'), await readJson(req, adminAccountSchema))
  return json({ ok: true })
})
