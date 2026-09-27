'use client'

import { api } from '@/features/api/client'
import { generateFamilyKeypair, unwrapSpaceKey, wrapSpaceKey, type WrappedSpaceKey } from '@/features/family/space-crypto'
import { deriveFromPassphrase, importMasterKey, unwrapMasterKeyRaw } from '@/features/keys/kdf'
import { decryptIndex } from '@/features/vault/index-crypto'
import { fromB64 } from '@/lib/crypto'
import type { AccountView } from '@/lib/api-types'
import type { VaultContainer } from '@/lib/vault'

type Keypair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey }

const ctx = (contactId: string) => `emergency:${contactId}`

/** Eigenes ECDH-Schlüsselpaar sicherstellen und veröffentlichen (wie Teamordner/geteilte Tresore). */
export async function ensureKeypair(serverPub: unknown | null, current: Keypair | undefined, save: (k: Keypair) => void): Promise<Keypair> {
  let fk = current
  if (!fk) {
    fk = await generateFamilyKeypair()
    save(fk)
  }
  const p = serverPub as JsonWebKey | null
  if (!p || p.x !== fk.publicJwk.x || p.y !== fk.publicJwk.y) await api.setPublicKey(fk.publicJwk)
  return fk
}

/** Inhaber bestätigt: Master-Key (per Passphrase entsperrt) für die Vertrauensperson verpacken. */
export async function confirmContact(account: AccountView, passphrase: string, contactId: string, granteeId: string, granteePub: JsonWebKey): Promise<void> {
  const env = account.envelopes.find(e => e.kekType === 'passphrase')
  if (!env) throw new Error('Passphrase-Schlüssel fehlt.')
  const { kek } = await deriveFromPassphrase(passphrase, account.kdf)
  const raw = await unwrapMasterKeyRaw(env, kek)
  try {
    await api.confirmEmergency(contactId, await wrapSpaceKey(raw, granteePub, ctx(contactId), 1, granteeId))
  } finally {
    raw.fill(0)
  }
}

export interface GrantorVault {
  masterKey: CryptoKey
  container: VaultContainer
}

/** Vertrauensperson: Hülle öffnen, Tresor-Index des Inhabers laden und entschlüsseln (nur lesen). */
export async function openGrantorVault(contactId: string, wrapped: unknown, myId: string, privateJwk: JsonWebKey): Promise<GrantorVault> {
  const raw = await unwrapSpaceKey(wrapped as WrappedSpaceKey, privateJwk, ctx(contactId), 1, myId)
  let masterKey: CryptoKey
  try {
    masterKey = await importMasterKey(raw)
  } finally {
    raw.fill(0)
  }
  const v = await api.emergencyVault(contactId)
  const container = v.body ? await decryptIndex(fromB64(v.body), masterKey, v.grantorId) : { v: 3 as const, files: [], secrets: [] }
  return { masterKey, container }
}
