import { parseVaultContainer, type VaultContainer } from '@/lib/vault'
import type { Bytes } from '@/lib/crypto'

const te = new TextEncoder()
const td = new TextDecoder()

/** AAD bindet den Index an das Konto – ein fremder Index-Blob lässt sich nicht unterschieben. */
const indexAad = (accountId: string) => te.encode(`focvault/index/v1/${accountId}`)

/** Format: [12 Byte IV][AES-GCM(JSON)] unter dem Master-Key. */
export async function encryptIndex(container: VaultContainer, masterKey: CryptoKey, accountId: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: indexAad(accountId) },
      masterKey,
      te.encode(JSON.stringify(container))
    )
  )
  const out = new Uint8Array(iv.byteLength + cipher.byteLength)
  out.set(iv, 0)
  out.set(cipher, iv.byteLength)
  return out as Bytes
}

export async function decryptIndex(bytes: Uint8Array, masterKey: CryptoKey, accountId: string): Promise<VaultContainer> {
  if (bytes.byteLength < 28) throw new Error('Tresor-Index ist beschädigt.')
  const iv = bytes.slice(0, 12)
  const cipher = bytes.slice(12)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: indexAad(accountId) }, masterKey, cipher)
  } catch {
    throw new Error('Tresor-Index konnte nicht entschlüsselt werden.')
  }
  return parseVaultContainer(td.decode(plain))
}
