import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readBytes, route } from '@/server/shared/http'
import { getSpaceIndex, putSpaceIndex } from '@/server/family/space'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Verschlüsselter Index des Familienordners (Ciphertext unter dem Ordner-Schlüssel). */
export const GET = route(async req => {
  const d = await deps()
  const idx = await getSpaceIndex(d, await requireSession(req, d.db))
  if (!idx) return new Response(null, { status: 204 })
  return new Response(new Uint8Array(idx.body), {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'X-FV-Version': String(idx.version) }
  })
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const baseVersion = Number(req.headers.get('x-fv-base-version') ?? 'NaN')
  const body = await readBytes(req, 8 * 1024 * 1024)
  return json(await putSpaceIndex(d, session, baseVersion, body))
})
