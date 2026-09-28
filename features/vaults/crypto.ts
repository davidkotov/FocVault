import type { Bytes } from '@/lib/crypto'
import { parseSecrets, type SecretEntry } from '@/lib/vault'

/**
 * Index eines geteilten Tresors: Name und Einträge, AES-256-GCM mit dem Tresor-Schlüssel der
 * neuesten Generation. Format wie beim Teamordner (0x01 | Generation uint32 | IV | Ciphertext),
 * aber eigene AAD – ein Index lässt sich nicht in einen anderen Tresor oder Ordner verschieben.
 * Die Schlüssel-Hüllen nutzen `wrapSpaceKey` mit dem Kontext `vault:<id>`.
 */
const te = new TextEncoder()
const aad = (vaultId: string) => te.encode(`focvault/shared-vault/v1|${vaultId}`)

export interface SharedVaultData {
  name: string
  secrets: SecretEntry[]
}

export const vaultKeyContext = (vaultId: string) => `vault:${vaultId}`

export async function encryptVaultIndex(data: SharedVaultData, key: CryptoKey, generation: number, vaultId: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = te.encode(JSON.stringify({ v: 1, name: data.name, secrets: data.secrets }))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(vaultId) }, key, plain))
  const out = new Uint8Array(17 + ct.length) as Bytes
  out[0] = 1
  new DataView(out.buffer).setUint32(1, generation)
  out.set(iv, 5)
  out.set(ct, 17)
  return out
}

export function vaultIndexGeneration(body: Uint8Array): number {
  if (body[0] !== 1 || body.length < 17) throw new Error('Unbekanntes Tresor-Format.')
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1)
}

export async function decryptVaultIndex(body: Uint8Array, key: CryptoKey, vaultId: string): Promise<SharedVaultData> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(5, 17) as Bytes, additionalData: aad(vaultId) }, key, body.subarray(17) as Bytes)
  const parsed = JSON.parse(new TextDecoder().decode(plain))
  return { name: typeof parsed.name === 'string' ? parsed.name : '', secrets: parseSecrets(parsed.secrets) }
}
