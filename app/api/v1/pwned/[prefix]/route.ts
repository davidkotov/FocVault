import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { ipLimit, rateLimit } from '@/server/auth/ratelimit'
import { ApiError } from '@/server/shared/errors'
import { param, requestMeta, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cache = new Map<string, { at: number; body: string }>()
const TTL = 60 * 60_000

/**
 * Passwort-Check (k-Anonymität): leitet nur die ersten 5 Hex-Zeichen des SHA-1-Hashes an
 * Have I Been Pwned weiter (mit Padding). So sieht HIBP weder Passwort noch die IP des Nutzers,
 * und FocVault sieht nur das Präfix – das Passwort verlässt den Browser nie.
 */
export const GET = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const prefix = param(ctx, 'prefix').toUpperCase()
  if (!/^[0-9A-F]{5}$/.test(prefix)) throw new ApiError('BAD_REQUEST', 'Ungültiges Präfix.')
  rateLimit(`pwned:${session.accountId}`, 5000, 60 * 60_000)
  rateLimit(`pwned:ip:${requestMeta(req).ip}`, ipLimit(10000), 60 * 60_000)
  const hit = cache.get(prefix)
  let body = hit && Date.now() - hit.at < TTL ? hit.body : null
  if (!body) {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'FocVault-Passwort-Check' }, signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!r?.ok) throw new ApiError('STORAGE_UNAVAILABLE', 'Der Leak-Abgleich ist gerade nicht erreichbar.')
    body = await r.text()
    if (cache.size > 5000) cache.clear()
    cache.set(prefix, { at: Date.now(), body })
  }
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600' } })
})
