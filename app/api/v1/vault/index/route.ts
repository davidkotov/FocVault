import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { MAX_INDEX_BYTES, getIndex, putIndex } from '@/server/vault/service'
import { json, readBytes, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Verschlüsselter Tresor-Index (Ciphertext unter dem Master-Key; der Server kann ihn nicht lesen). */
export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const idx = await getIndex(d, session.accountId)
  if (!idx) return new Response(null, { status: 204 })
  return new Response(idx.body as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'X-FV-Version': String(idx.version) }
  })
})

export const PUT = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const baseVersion = Number(req.headers.get('x-fv-base-version') ?? 'NaN')
  const body = await readBytes(req, MAX_INDEX_BYTES)
  return json(await putIndex(d, session.accountId, baseVersion, body))
})
