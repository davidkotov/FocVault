import { deps } from '@/server/deps'
import { requireAdmin, requireSession } from '@/server/auth/guard'
import { json, param, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { grantAddonSchema } from '@/server/billing/schemas'
import { adminGrantAddon } from '@/server/billing/service'

export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await requireAdmin(d.db, session)
  await adminGrantAddon(d, session, param(ctx, 'id'), await readJson(req, grantAddonSchema))
  return json({ ok: true }, 201)
})
