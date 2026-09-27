import { deps } from '@/server/deps'
import { rateLimit } from '@/server/auth/ratelimit'
import { clientIp, json, param, route } from '@/server/shared/http'
import { publicShare } from '@/server/shares/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Öffentlich (ohne Konto): verschlüsselte Metadaten eines Secure-Send-Links. */
export const GET = route(async (req, ctx) => {
  rateLimit(`share:${clientIp(req)}`, 60, 60_000)
  return json(await publicShare(await deps(), param(ctx, 'id')))
})
