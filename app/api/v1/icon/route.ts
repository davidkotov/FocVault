import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { rateLimit } from '@/server/auth/ratelimit'
import { fetchIcon, validHost } from '@/server/icons/service'
import { ApiError } from '@/server/shared/errors'
import { route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Icon einer Website (nur angemeldet, nicht protokolliert). */
export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  rateLimit(`icon:${session.accountId}`, 120, 15 * 60_000)
  const host = (new URL(req.url).searchParams.get('host') ?? '').trim().toLowerCase()
  if (!validHost(host)) throw new ApiError('BAD_REQUEST', 'Ungültige Adresse.')
  const icon = await fetchIcon(host)
  if (!icon) throw new ApiError('NOT_FOUND', 'Kein Icon gefunden.')
  return new Response(new Uint8Array(icon.body), {
    headers: { 'content-type': icon.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
  })
})
