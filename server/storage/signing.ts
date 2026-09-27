import { ApiError } from '../shared/errors'
import { hmacSha256, safeEqual } from '../shared/bytes'
import { serverSecret } from '../shared/env'

export type StorageOp = 'put' | 'get'
export const STORAGE_ROUTE_PREFIX = '/api/v1/storage/'

function payload(op: StorageOp, key: string, exp: string, len: string): string {
  return `fv-storage-v1\n${op}\n${key}\n${exp}\n${len}`
}

/** Kurzlebige, HMAC-signierte URL auf unseren Storage-Endpunkt (lokal bzw. Proxy zu Fil One). */
export function signedStorageUrl(
  op: StorageOp,
  key: string,
  ttlSec: number,
  len?: number
): { url: string; expiresAt: number } {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSec)
  const lenStr = len === undefined ? '' : String(len)
  const sig = hmacSha256(serverSecret(), payload(op, key, exp, lenStr)).toString('base64url')
  const q = new URLSearchParams({ op, exp, sig })
  if (lenStr) q.set('len', lenStr)
  const path = key.split('/').map(encodeURIComponent).join('/')
  return { url: `${STORAGE_ROUTE_PREFIX}${path}?${q.toString()}`, expiresAt: Number(exp) * 1000 }
}

export function verifyStorageUrl(op: StorageOp, key: string, params: URLSearchParams): { len?: number } {
  if (params.get('op') !== op) throw new ApiError('FORBIDDEN', 'Falsche Operation für diesen Link.')
  const exp = params.get('exp') ?? ''
  const lenStr = params.get('len') ?? ''
  const sig = params.get('sig') ?? ''
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) throw new ApiError('FORBIDDEN', 'Link abgelaufen.')
  if (lenStr && !/^\d+$/.test(lenStr)) throw new ApiError('FORBIDDEN', 'Ungültiger Link.')
  const expected = hmacSha256(serverSecret(), payload(op, key, exp, lenStr))
  if (!safeEqual(expected, Buffer.from(sig, 'base64url'))) throw new ApiError('FORBIDDEN', 'Ungültige Signatur.')
  return { len: lenStr ? Number(lenStr) : undefined }
}
