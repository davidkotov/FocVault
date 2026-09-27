import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { listVersions } from '@/server/objects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json({ items: await listVersions(d, session) })
})
