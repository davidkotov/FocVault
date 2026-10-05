import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { ApiError } from '../shared/errors'
import { sha256 } from '../shared/bytes'

/**
 * WebAuthn-Grundlagen ohne Zusatzbibliothek: öffentliche Schlüssel (SPKI aus
 * `AuthenticatorAttestationResponse.getPublicKey()`) prüfen, authenticatorData lesen und
 * Assertion-Signaturen verifizieren. Unterstützt ES256 (-7), EdDSA (-8) und RS256 (-257).
 */
export const PASSKEY_ALGS = [-7, -8, -257] as const

function spki(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.from(raw), format: 'der', type: 'spki' })
}

/** SPKI prüfen (Typ passt zum Algorithmus, P-256 bzw. RSA ≥ 2048 Bit) und normalisiert zurückgeben. */
export function parsePublicKey(raw: Uint8Array, alg: number): Buffer {
  let key: KeyObject
  try {
    key = spki(raw)
  } catch {
    throw new ApiError('BAD_REQUEST', 'Öffentlicher Schlüssel des Passkeys ist ungültig.')
  }
  const d = key.asymmetricKeyDetails
  const ok =
    alg === -7
      ? key.asymmetricKeyType === 'ec' && d?.namedCurve === 'prime256v1'
      : alg === -8
        ? key.asymmetricKeyType === 'ed25519'
        : alg === -257
          ? key.asymmetricKeyType === 'rsa' && (d?.modulusLength ?? 0) >= 2048
          : false
  if (!ok) throw new ApiError('BAD_REQUEST', 'Dieser Passkey-Algorithmus wird nicht unterstützt.')
  return key.export({ format: 'der', type: 'spki' })
}

export interface AuthData {
  rpIdHash: Buffer
  /** User Present */
  up: boolean
  /** User Verified (Face ID, Touch ID, PIN …) */
  uv: boolean
  signCount: number
}

/** authenticatorData: rpIdHash (32) · Flags (1) · signCount (4, big-endian) · [Erweiterungen] */
export function parseAuthData(raw: Buffer): AuthData | null {
  if (raw.length < 37) return null
  const flags = raw[32]
  return { rpIdHash: raw.subarray(0, 32), up: !!(flags & 0x01), uv: !!(flags & 0x04), signCount: raw.readUInt32BE(33) }
}

/** Signatur über authenticatorData ‖ SHA-256(clientDataJSON) prüfen (ES256-Signaturen sind DER-kodiert). */
export function verifyAssertion(publicKey: Uint8Array, alg: number, authData: Buffer, clientDataJSON: Buffer, signature: Buffer): boolean {
  const data = Buffer.concat([authData, sha256(clientDataJSON)])
  try {
    const key = spki(publicKey)
    if (alg === -7) return verify('sha256', data, { key, dsaEncoding: 'der' }, signature)
    if (alg === -257) return verify('sha256', data, key, signature)
    if (alg === -8) return verify(null, data, key, signature)
  } catch {
    /* kaputter Schlüssel oder Signatur */
  }
  return false
}
