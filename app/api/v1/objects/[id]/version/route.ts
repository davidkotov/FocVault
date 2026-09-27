import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, param, route } from '@/server/shared/http'
import { keepAsVersion } from '@/server/objects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Bisherige Fassung als Version aufbewahren (nach dem Hochladen einer neuen). */
export const POST = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await keepAsVersion(d, session, param(ctx, 'id')))
})
