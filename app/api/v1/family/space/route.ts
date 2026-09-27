import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { spaceState } from '@/server/family/space'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  return json(await spaceState(d, await requireSession(req, d.db)))
})
