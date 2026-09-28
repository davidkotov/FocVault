import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { json, param, readJson, route } from '@/server/shared/http'
import { roleSchema, setMemberRole } from '@/server/team/service'

export const PATCH = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { role } = await readJson(req, roleSchema)
  await setMemberRole(d, session, param(ctx, 'id'), role)
  return json({ ok: true })
})
