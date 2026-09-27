import { deps } from '@/server/deps'
import { preloginSchema } from '@/server/accounts/schemas'
import { prelogin } from '@/server/accounts/service'
import { rateLimit } from '@/server/auth/ratelimit'
import { clientIp, json, readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  const { email } = await readJson(req, preloginSchema)
  rateLimit(`prelogin:ip:${clientIp(req)}`, 60, 15 * 60_000)
  return json(await prelogin(await deps(), email))
})
