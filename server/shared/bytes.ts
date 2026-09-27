import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function b64uEncode(u: Uint8Array): string {
  return Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64url')
}

export function b64uDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

export function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest()
}

export function hmacSha256(key: Uint8Array, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}
