import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { adminSuperSafeSchema } from '@/server/billing/schemas'
import { adminSetSuperSafe } from '@/server/billing/super-safe'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Admin: Super Safe freischalten (Preis je TB, Standard 0) oder beenden. */
export const PUT = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await adminSetSuperSafe(d, session, param(ctx, 'id'), await readJson(req, adminSuperSafeSchema))
  return json({ ok: true })
})
