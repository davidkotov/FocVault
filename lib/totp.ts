/** TOTP (RFC 6238) – reine WebCrypto-Implementierung, kein externes Package.
 *  Basis: HMAC-SHA1/256/512 mit Base32-Secret, wie bei Google Authenticator. */

export interface TotpOptions {
  secret: string
  digits?: number
  period?: number
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Dekodiert ein Base32-Secret (Leerzeichen/padding tolerant). */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  if (clean.length === 0) throw new Error('Leeres Secret')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`Ungültiges Zeichen im Base32-Secret: "${ch}"`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function generateBase32Secret(bytes = 20): string {
  const rand = crypto.getRandomValues(new Uint8Array(bytes))
  let out = ''
  let bits = 0
  let value = 0
  for (const b of rand) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export async function generateTotp(opts: TotpOptions, at = Date.now()): Promise<string> {
  const { secret, digits = 6, period = 30, algorithm = 'SHA1' } = opts
  if (secret.length === 0) throw new Error('Kein Secret')
  const keyMaterial = base32Decode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: algorithm === 'SHA256' ? 'SHA-256' : algorithm === 'SHA512' ? 'SHA-512' : 'SHA-1' },
    false,
    ['sign']
  )
  let counter = BigInt(Math.floor(at / period / 1000))
  const msg = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(counter & 0xffn)
    counter >>= 8n
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const offset = sig[sig.length - 1] & 0x0f
  const binary =
    ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff)
  const code = binary % Math.pow(10, digits)
  return code.toString().padStart(digits, '0')
}

/** Sekunden bis zum Ablauf des aktuellen TOTP-Codes. */
export function totpRemaining(at = Date.now(), period = 30): number {
  return period - (Math.floor(at / 1000) % period)
}

export interface OtpauthData {
  account: string
  issuer?: string
  secret: string
  digits?: number
  period?: number
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
}

/** Parst einen otpauth://totp/…-Link (Standard-Export/QR-Backup bei 2FA-Setup). */
export function parseOtpauth(uri: string): OtpauthData | null {
  try {
    const u = new URL(uri.trim())
    if (u.protocol !== 'otpauth:' || u.host.toLowerCase() !== 'totp') return null
    const label = decodeURIComponent(u.pathname.slice(1))
    const [account, issuer] = label.split(':').reverse()
    const secret = u.searchParams.get('secret') ?? ''
    if (!secret) return null
    const algo = (u.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
    return {
      account,
      ...(issuer ? { issuer } : {}),
      secret,
      ...(u.searchParams.get('digits') ? { digits: Number(u.searchParams.get('digits')) } : {}),
      ...(u.searchParams.get('period') ? { period: Number(u.searchParams.get('period')) } : {}),
      ...(algo === 'SHA256' || algo === 'SHA512' ? { algorithm: algo } : {})
    }
  } catch {
    return null
  }
}
