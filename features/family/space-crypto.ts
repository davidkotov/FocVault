import { fromB64Url, toB64Url, type Bytes } from '@/lib/crypto'
import type { VaultContainer } from '@/lib/vault'

/**
 * Kryptografie des Familienordners (läuft nur im Browser bzw. Backup-Programm):
 * - Schlüsselpaar je Konto: ECDH P-256; der private Teil liegt im eigenen verschlüsselten Tresor.
 * - Ordner-Schlüssel (32 Byte, AES-256-GCM) je Generation; für jedes Mitglied verpackt mit
 *   ECDH-ES: ephemeres Schlüsselpaar → gemeinsames Geheimnis → HKDF-SHA-256 → AES-GCM.
 *   Kontext (Familie, Generation, Empfänger) geht in HKDF-Info und AAD ein – eine Hülle lässt sich
 *   nicht für ein anderes Mitglied oder eine andere Generation missbrauchen.
 * - Index des Ordners: AES-GCM mit dem Schlüssel der neuesten Generation, Generation im Header.
 */
const te = new TextEncoder()
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface WrappedSpaceKey {
  epk: { kty: 'EC'; crv: 'P-256'; x: string; y: string }
  iv: string
  ct: string
}

const pubOnly = (j: JsonWebKey) => ({ kty: 'EC' as const, crv: 'P-256' as const, x: j.x!, y: j.y! })

export async function generateFamilyKeypair(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  return {
    publicJwk: pubOnly(await crypto.subtle.exportKey('jwk', kp.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey)
  }
}

function context(ownerId: string, generation: number, recipientId: string): Bytes {
  return te.encode(`focvault/space-key/v1|${ownerId}|${generation}|${recipientId}`) as Bytes
}

async function kek(privateKey: CryptoKey, publicKey: CryptoKey, info: Bytes): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('focvault/space-kek/v1'), info },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Ordner-Schlüssel für ein Mitglied verpacken. */
export async function wrapSpaceKey(raw: Bytes, recipientPublicJwk: JsonWebKey, ownerId: string, generation: number, recipientId: string): Promise<WrappedSpaceKey> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const pub = await crypto.subtle.importKey('jwk', pubOnly(recipientPublicJwk), ECDH, false, [])
  const info = context(ownerId, generation, recipientId)
  const key = await kek(eph.privateKey, pub, info)
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Bytes
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: info }, key, raw)) as Bytes
  return { epk: pubOnly(await crypto.subtle.exportKey('jwk', eph.publicKey)), iv: toB64Url(iv), ct: toB64Url(ct) }
}

/** Eigene Hülle öffnen → Rohschlüssel (32 Byte). */
export async function unwrapSpaceKey(w: WrappedSpaceKey, privateJwk: JsonWebKey, ownerId: string, generation: number, myId: string): Promise<Bytes> {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits'])
  const epk = await crypto.subtle.importKey('jwk', w.epk, ECDH, false, [])
  const info = context(ownerId, generation, myId)
  const key = await kek(priv, epk, info)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64Url(w.iv), additionalData: info }, key, fromB64Url(w.ct))) as Bytes
}

export function newSpaceKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(32)) as Bytes
}

export function importSpaceKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// ---------- Index des Familienordners ----------

const indexAad = (ownerId: string) => te.encode(`focvault/space-index/v1|${ownerId}`)

/** Format: 0x01 | Generation (uint32 BE) | IV (12) | Ciphertext */
export async function encryptSpaceIndex(container: VaultContainer, key: CryptoKey, generation: number, ownerId: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = te.encode(JSON.stringify({ v: 3, files: container.files }))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: indexAad(ownerId) }, key, plain))
  const out = new Uint8Array(17 + ct.length) as Bytes
  out[0] = 1
  new DataView(out.buffer).setUint32(1, generation)
  out.set(iv, 5)
  out.set(ct, 17)
  return out
}

export function spaceIndexGeneration(body: Uint8Array): number {
  if (body[0] !== 1 || body.length < 17) throw new Error('Unbekanntes Format des Familienordners.')
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1)
}

export async function decryptSpaceIndex(body: Uint8Array, key: CryptoKey, ownerId: string): Promise<VaultContainer> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: body.subarray(5, 17) as Bytes, additionalData: indexAad(ownerId) },
    key,
    body.subarray(17) as Bytes
  )
  const parsed = JSON.parse(new TextDecoder().decode(plain))
  return { v: 3, files: Array.isArray(parsed.files) ? parsed.files : [], secrets: [] }
}
