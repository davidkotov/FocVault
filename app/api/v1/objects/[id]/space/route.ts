import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { moveToSpace } from '@/server/objects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Datei in den Familien-/Teamordner verschieben. */
export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  await moveToSpace(d, session, param(ctx, 'id'))
  return json({ ok: true })
})
