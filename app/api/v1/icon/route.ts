import { z } from 'zod'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { rateLimit } from '@/server/auth/ratelimit'
import { fetchIcon, validHost } from '@/server/icons/service'
import { ApiError } from '@/server/shared/errors'
import { readJson, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const iconSchema = z.object({ host: z.string().trim().toLowerCase().max(253) })

/**
 * Icon einer Website (nur angemeldet, nicht protokolliert). Der Host steht im POST-Body statt in der
 * Query, damit Namen von Tresor-Einträgen nicht in Zugriffs-Logs (Proxy, Hosting) landen.
 * route() verlangt für POST den Client-Header (CSRF-Schutz).
 */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  rateLimit(`icon:${session.accountId}`, 120, 15 * 60_000)
  const { host } = await readJson(req, iconSchema, 1024)
  if (!validHost(host)) throw new ApiError('BAD_REQUEST', 'Ungültige Adresse.')
  const icon = await fetchIcon(host)
  if (!icon) throw new ApiError('NOT_FOUND', 'Kein Icon gefunden.')
  return new Response(new Uint8Array(icon.body), {
    headers: { 'content-type': icon.type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
  })
})
