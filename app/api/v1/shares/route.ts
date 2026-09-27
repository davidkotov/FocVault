import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { createShare, createShareSchema, listShares } from '@/server/shares/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json({ shares: await listShares(d, session, req.nextUrl.searchParams.get('objectId') ?? undefined) })
})

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  return json(await createShare(d, session, await readJson(req, createShareSchema, 3 * 1024 * 1024)), 201)
})
