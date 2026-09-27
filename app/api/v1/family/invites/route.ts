import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { createInvite } from '@/server/family/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const d = await deps()
  return json(await createInvite(d, await requireSession(req, d.db)), 201)
})
