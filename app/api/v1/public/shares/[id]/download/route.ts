import { deps } from '@/server/deps'
import { rateLimit } from '@/server/auth/ratelimit'
import { clientIp, json, param, route } from '@/server/shared/http'
import { startShareDownload } from '@/server/shares/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx) => {
  rateLimit(`share-dl:${clientIp(req)}`, 20, 60_000)
  return json(await startShareDownload(await deps(), param(ctx, 'id')))
})
