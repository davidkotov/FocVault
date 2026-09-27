'use client'

import type { PasskeyEnvelope } from '@/lib/api-types'
import { fromB64Url, toB64Url, type Bytes } from '@/lib/crypto'

/**
 * Passkey-Entsperren über die WebAuthn-PRF-Erweiterung (hmac-secret): Der Authenticator
 * (Face ID, Touch ID, Windows Hello, Sicherheitsschlüssel) liefert zu einem Salt einen geheimen,
 * gerätegebundenen Wert. Daraus wird per HKDF ein Schlüssel abgeleitet, der den Master-Key verpackt.
 * Der Wert verlässt den Browser nie; ohne den Passkey ist die gespeicherte Hülle wertlos.
 */
const te = new TextEncoder()

export class PasskeyError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED' | 'NO_PRF' | 'CANCELLED' | 'NO_MATCH',
    message: string
  ) {
    super(message)
  }
}

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials
}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } }

function prfOf(cred: PublicKeyCredential): Bytes | null {
  const ext = (cred.getClientExtensionResults() as { prf?: PrfResults }).prf
  const first = ext?.results?.first
  return first ? (new Uint8Array(first instanceof Uint8Array ? first : new Uint8Array(first)) as Bytes) : null
}

function cancelled(e: unknown): boolean {
  const n = (e as DOMException)?.name
  return n === 'NotAllowedError' || n === 'AbortError'
}

/** Schlüssel aus dem PRF-Wert (HKDF-SHA-256, eigener Kontext für FocVault). */
export async function passkeyKek(prf: Bytes, credentialId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('focvault/passkey-kek/v1'), info: te.encode(credentialId) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Passkey auf diesem Gerät anlegen und sofort den PRF-Wert holen. */
export async function createPasskey(user: { id: string; name: string }): Promise<{ credentialId: string; salt: string; prf: Bytes }> {
  if (!passkeySupported()) throw new PasskeyError('UNSUPPORTED', 'Dieser Browser unterstützt keine Passkeys.')
  const salt = crypto.getRandomValues(new Uint8Array(32)) as Bytes
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'FocVault', id: window.location.hostname },
        user: { id: te.encode(user.id), name: user.name, displayName: user.name },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential
  } catch (e) {
    if (cancelled(e)) throw new PasskeyError('CANCELLED', 'Abgebrochen.')
    throw e
  }
  const credentialId = toB64Url(new Uint8Array(cred.rawId) as Bytes)
  const ext = (cred.getClientExtensionResults() as { prf?: PrfResults }).prf
  if (ext && ext.enabled === false) throw new PasskeyError('NO_PRF', 'Dieser Passkey kann nicht zum Entsperren verwendet werden (keine PRF-Unterstützung).')
  // Manche Authenticatoren liefern den Wert erst bei der ersten Anmeldung
  const prf = prfOf(cred) ?? (await passkeyPrf([{ credentialId, salt: toB64Url(salt) }])).prf
  return { credentialId, salt: toB64Url(salt), prf }
}

/** Mit einem der hinterlegten Passkeys den PRF-Wert holen. */
export async function passkeyPrf(passkeys: Array<Pick<PasskeyEnvelope, 'credentialId' | 'salt'>>): Promise<{ credentialId: string; prf: Bytes }> {
  if (!passkeySupported()) throw new PasskeyError('UNSUPPORTED', 'Dieser Browser unterstützt keine Passkeys.')
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: passkeys.map(p => ({ type: 'public-key' as const, id: fromB64Url(p.credentialId) })),
        userVerification: 'required',
        timeout: 120_000,
        extensions: {
          prf: { evalByCredential: Object.fromEntries(passkeys.map(p => [p.credentialId, { first: fromB64Url(p.salt) }])) }
        } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential
  } catch (e) {
    if (cancelled(e)) throw new PasskeyError('CANCELLED', 'Abgebrochen.')
    throw e
  }
  const credentialId = toB64Url(new Uint8Array(cred.rawId) as Bytes)
  const prf = prfOf(cred)
  if (!prf) throw new PasskeyError('NO_PRF', 'Dieser Passkey kann nicht zum Entsperren verwendet werden (keine PRF-Unterstützung).')
  if (!passkeys.some(p => p.credentialId === credentialId)) throw new PasskeyError('NO_MATCH', 'Unbekannter Passkey.')
  return { credentialId, prf }
}

export function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${os} · ${browser}`
}
