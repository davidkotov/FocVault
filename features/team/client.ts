'use client'

import { api, type TeamAdminView } from '@/features/api/client'
import { generateFamilyKeypair, unwrapSpaceKey, wrapSpaceKey, type WrappedSpaceKey } from '@/features/family/space-crypto'
import { deriveFromPassphrase, importMasterKey, unwrapMasterKeyRaw } from '@/features/keys/kdf'
import { decryptIndex } from '@/features/vault/index-crypto'
import { fromB64, fromB64Url, toB64Url, type Bytes } from '@/lib/crypto'
import type { AccountView } from '@/lib/api-types'
import type { GrantorVault } from '@/features/emergency/client'

/**
 * Firmen-Notfallzugriff im Browser. Team-Schlüssel = ECDH-P-256-Paar; der private Teil (32 Byte „d“)
 * wird je Admin verpackt (Kontext team-recovery), Master-Keys der Mitglieder für den öffentlichen
 * Teil (Kontext team-escrow). Der Server sieht keinen der Schlüssel im Klartext.
 */
type Keypair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey }
const keyCtx = (owner: string) => `team-recovery:${owner}`
const escrowCtx = (owner: string) => `team-escrow:${owner}`

/** Inhaber: neuen Team-Schlüssel erzeugen und für sich selbst verpacken. */
export async function createTeamRecoveryKey(view: TeamAdminView, me: Keypair): Promise<void> {
  const kp = await generateFamilyKeypair()
  const d = fromB64Url(kp.privateJwk.d!) as Bytes
  try {
    const gen = (view.recovery?.generation ?? 0) + 1
    await api.setRecoveryKey(kp.publicJwk, await wrapSpaceKey(d, me.publicJwk, keyCtx(view.owner), gen, view.me))
  } finally {
    d.fill(0)
  }
}

async function openTeamKey(view: { owner: string; me: string }, gen: number, wrapped: unknown, pub: JsonWebKey, me: Keypair): Promise<{ d: Bytes; priv: JsonWebKey }> {
  const d = await unwrapSpaceKey(wrapped as WrappedSpaceKey, me.privateJwk, keyCtx(view.owner), gen, view.me)
  return { d, priv: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, d: toB64Url(d), ext: true } }
}

/** Admins ohne Team-Schlüssel versorgen (jeder Admin mit Schlüssel hilft mit). */
export async function distributeTeamKey(view: TeamAdminView, me: Keypair): Promise<boolean> {
  const r = view.recovery
  if (!r?.myWrapped) return false
  const missing = r.admins.filter(a => !a.hasKey && a.publicKey)
  if (!missing.length) return false
  const { d } = await openTeamKey(view, r.generation, r.myWrapped, r.publicKey, me)
  try {
    const grants = []
    for (const a of missing) grants.push({ accountId: a.accountId, wrapped: await wrapSpaceKey(d, a.publicKey as JsonWebKey, keyCtx(view.owner), r.generation, a.accountId) })
    await api.grantRecoveryKey(r.generation, grants)
    return true
  } finally {
    d.fill(0)
  }
}

/** Mitglied: Master-Key (per Passphrase entsperrt) für den Team-Schlüssel hinterlegen. */
export async function escrowForTeam(account: AccountView, passphrase: string): Promise<void> {
  const t = account.team
  if (!t?.recovery) throw new Error('Kein Team-Schlüssel vorhanden.')
  const env = account.envelopes.find(e => e.kekType === 'passphrase')!
  const { kek } = await deriveFromPassphrase(passphrase, account.kdf)
  const raw = await unwrapMasterKeyRaw(env, kek)
  try {
    await api.escrow(t.recovery.generation, await wrapSpaceKey(raw, t.recovery.publicKey, escrowCtx(t.ownerId), t.recovery.generation, account.id))
  } finally {
    raw.fill(0)
  }
}

/** Nach Vier-Augen-Freigabe: Tresor des Mitglieds lesend öffnen. */
export async function openRecoveredVault(requestId: string, owner: string, me: string, keypair: Keypair): Promise<GrantorVault> {
  const v = await api.recoveryVault(requestId)
  const { d, priv } = await openTeamKey({ owner, me }, v.generation, v.teamKey, v.teamPublicKey, keypair)
  try {
    const raw = await unwrapSpaceKey(v.escrow as WrappedSpaceKey, priv, escrowCtx(owner), v.generation, v.targetId)
    let masterKey: CryptoKey
    try {
      masterKey = await importMasterKey(raw)
    } finally {
      raw.fill(0)
    }
    const container = v.body ? await decryptIndex(fromB64(v.body), masterKey, v.targetId) : { v: 3 as const, files: [], secrets: [] }
    // Private Schlüssel (Familien-/Teamordner) nicht an Dritte weiterreichen
  const { familyKey: _fk, ...visible } = container
  return { masterKey, container: visible }
  } finally {
    d.fill(0)
    priv.d = undefined
  }
}
