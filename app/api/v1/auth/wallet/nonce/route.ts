import { deps } from '@/server/deps'
import { issueNonce } from '@/server/auth/wallet'
import { rateLimit } from '@/server/auth/ratelimit'
import { clientIp, json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async req => {
  rateLimit(`wallet:nonce:${clientIp(req)}`, 60, 15 * 60_000)
  return json({ nonce: await issueNonce(await deps()) })
})
