import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { rateLimit } from '@/server/auth/ratelimit'
import { accountView } from '@/server/accounts/service'
import { json, readJson, route } from '@/server/shared/http'
import { inviteInfo, joinFamily } from '@/server/family/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/)

/** Vorschau: von wem ist die Einladung? */
export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  rateLimit(`family-join:${session.accountId}`, 30, 60_000)
  return json(await inviteInfo(d, token.parse(req.nextUrl.searchParams.get('token'))))
})

export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  rateLimit(`family-join:${session.accountId}`, 30, 60_000)
  const body = await readJson(req, z.object({ token }))
  await joinFamily(d, session, body.token)
  return json(await accountView(d, session.accountId))
})
