import { randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'
import { safeEqual } from '../shared/bytes'

function scrypt(secret: Buffer, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(secret, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

export interface SecretHashParams {
  alg: 'scrypt'
  N: number
  r: number
  p: number
  keyLen: number
}

/**
 * Der Client schickt nie die Passphrase, sondern einen per Argon2id + HKDF abgeleiteten,
 * vom Verschlüsselungs-KEK unabhängigen Auth-Key (256 Bit). Wir speichern davon nur einen
 * gesalzenen scrypt-Hash – Defense in Depth bei einem DB-Leak.
 */
export const SCRYPT_PARAMS: SecretHashParams = { alg: 'scrypt', N: 2 ** 14, r: 8, p: 1, keyLen: 32 }

function derive(secret: Uint8Array, salt: Uint8Array, params: SecretHashParams): Promise<Buffer> {
  return scrypt(Buffer.from(secret), Buffer.from(salt), params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * params.N * params.r
  })
}

export async function hashSecret(secret: Uint8Array, params: SecretHashParams = SCRYPT_PARAMS) {
  const salt = randomBytes(16)
  const hash = await derive(secret, salt, params)
  return { hash, salt, params }
}

export async function verifySecret(
  secret: Uint8Array,
  hash: Uint8Array,
  salt: Uint8Array,
  params: SecretHashParams
): Promise<boolean> {
  const candidate = await derive(secret, salt, params)
  return safeEqual(candidate, hash)
}

/** Gleiche Rechenzeit auch für unbekannte Konten (kein Timing-Orakel für E-Mails). */
export async function burnVerification(): Promise<void> {
  await derive(randomBytes(32), randomBytes(16), SCRYPT_PARAMS)
}
