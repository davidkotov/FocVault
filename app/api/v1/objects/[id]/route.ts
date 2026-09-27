import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { deleteObject } from '@/server/objects/service'
import { json, param, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await deleteObject(d, session, param(ctx, 'id'))
  return json({ ok: true })
})
