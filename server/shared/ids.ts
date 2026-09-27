import { randomBytes } from 'node:crypto'

/** UUIDv7 (RFC 9562): zeitlich sortierbar, 74 Bit Zufall – nicht erratbar. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16)
  let ts = BigInt(now)
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ts & 0xffn)
    ts >>= 8n
  }
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}
