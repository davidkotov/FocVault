import { getStorage } from '@/server/storage'
import { verifyStorageUrl } from '@/server/storage/signing'
import { ApiError } from '@/server/shared/errors'
import { param, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Speicher-Endpunkt für signierte URLs: lokal (Dev) bzw. Proxy zu Fil One, solange der
 * Browser nicht direkt hochladen kann (CORS bei Fil One nicht dokumentiert).
 * Autorisierung ausschließlich über die HMAC-Signatur (kurzlebig, an Key/Größe gebunden).
 */
export const PUT = route(
  async (req, ctx) => {
    const key = param(ctx, 'key')
    const { len } = verifyStorageUrl('put', key, req.nextUrl.searchParams)
    if (len === undefined) throw new ApiError('FORBIDDEN', 'Upload-Link ohne Größenangabe.')
    const declared = req.headers.get('content-length')
    if (declared !== null && Number(declared) !== len) {
      throw new ApiError('UPLOAD_SIZE_MISMATCH', 'Größe passt nicht zum Upload-Link.', { expected: len, actual: Number(declared) })
    }
    if (!req.body) throw new ApiError('BAD_REQUEST', 'Leerer Upload.')
    await getStorage().writeStream(key, req.body, len)
    return new Response(null, { status: 200 })
  },
  { csrf: false }
)

export const GET = route(
  async (req, ctx) => {
    const key = param(ctx, 'key')
    verifyStorageUrl('get', key, req.nextUrl.searchParams)
    const obj = await getStorage().readStream(key)
    if (!obj) throw new ApiError('NOT_FOUND', 'Objekt nicht gefunden.')
    return new Response(obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(obj.size) }
    })
  },
  { csrf: false }
)
