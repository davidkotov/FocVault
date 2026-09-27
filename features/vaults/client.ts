'use client'

import { ApiClientError, api, type SharedVaultState, type VaultRole, type VaultsOverview } from '@/features/api/client'
import { fromB64, toB64, type Bytes } from '@/lib/crypto'
import type { SecretEntry } from '@/lib/vault'
import { generateFamilyKeypair, importSpaceKey, newSpaceKey, unwrapSpaceKey, wrapSpaceKey, type WrappedSpaceKey } from '@/features/family/space-crypto'
import { decryptVaultIndex, encryptVaultIndex, vaultIndexGeneration, vaultKeyContext, type SharedVaultData } from './crypto'

type Keypair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey }

export interface OpenVault {
  id: string
  role: VaultRole
  state: SharedVaultState
  /** null = (noch) kein Schlüssel für dieses Konto */
  data: SharedVaultData | null
}

const samePub = (a: unknown, b: JsonWebKey) => {
  const x = a as JsonWebKey | null
  return !!x && x.x === b.x && x.y === b.y
}

/**
 * Geteilte Tresore im Browser: Schlüsselpaar sicherstellen, Hüllen öffnen, fehlende Hüllen für
 * Mitglieder verteilen, nach dem Entfernen (Verwalter) eine neue Generation anlegen und den Index
 * damit neu verschlüsseln. Alle Änderungen am Index mit optimistischem Locking.
 */
export class SharedVaultsClient {
  overview: VaultsOverview | null = null
  vaults: OpenVault[] = []
  private keys = new Map<string, Map<number, { raw: Bytes; key: CryptoKey }>>()
  private generated: Keypair | null = null
  private running: Promise<void> | null = null

  constructor(
    private readonly familyKey: () => Keypair | undefined,
    private readonly saveFamilyKey: (k: Keypair) => void
  ) {}

  load(): Promise<void> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null))
    return this.running
  }

  private async keypair(ov: VaultsOverview): Promise<Keypair> {
    let fk = this.familyKey() ?? this.generated
    if (!fk) {
      fk = this.generated = await generateFamilyKeypair()
      this.saveFamilyKey(fk)
    }
    const me = ov.team.find(t => t.accountId === ov.me)
    if (!samePub(me?.publicKey, fk.publicJwk)) await api.setPublicKey(fk.publicJwk)
    return fk
  }

  private async run(): Promise<void> {
    let ov = await api.vaults()
    const fk = await this.keypair(ov)
    ov = await api.vaults()
    let changed = false
    for (const v of ov.vaults) {
      const ring = new Map<number, { raw: Bytes; key: CryptoKey }>()
      for (const k of v.myKeys) {
        try {
          const raw = await unwrapSpaceKey(k.wrapped as WrappedSpaceKey, fk.privateJwk, vaultKeyContext(v.id), k.generation, ov.me)
          ring.set(k.generation, { raw, key: await importSpaceKey(raw) })
        } catch {
          // Hülle für ein früheres Schlüsselpaar – ein anderes Mitglied verteilt neu
        }
      }
      this.keys.set(v.id, ring)
      if (!ring.size) continue
      if (v.rotateNeeded && v.role === 'manage') {
        await this.rotate(v, ring).catch(() => undefined)
        changed = true
        continue
      }
      // fehlende Hüllen (auch für neu hinzugefügte Mitglieder) verteilen
      for (const [gen, k] of ring) {
        const grants = []
        for (const m of v.members) {
          if (!m.publicKey || m.generations.includes(gen)) continue
          grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(k.raw, m.publicKey as JsonWebKey, vaultKeyContext(v.id), gen, m.accountId) })
        }
        if (grants.length) {
          await api.grantVaultKeys(v.id, gen, grants).catch(() => undefined)
          changed = true
        }
      }
    }
    if (changed) ov = await api.vaults()
    this.overview = ov
    const out: OpenVault[] = []
    for (const v of ov.vaults) {
      const ring = this.keys.get(v.id)
      let data: SharedVaultData | null = null
      try {
        const body = fromB64(v.body)
        const k = ring?.get(vaultIndexGeneration(body))
        if (k) data = await decryptVaultIndex(body, k.key, v.id)
      } catch {
        data = null
      }
      out.push({ id: v.id, role: v.role, state: v, data })
    }
    this.vaults = out
  }

  /** Neue Generation für alle aktuellen Mitglieder und Index damit neu verschlüsseln. */
  private async rotate(v: SharedVaultState, ring: Map<number, { raw: Bytes; key: CryptoKey }>) {
    const oldGen = vaultIndexGeneration(fromB64(v.body))
    const old = ring.get(oldGen)
    if (!old) return
    const data = await decryptVaultIndex(fromB64(v.body), old.key, v.id)
    const gen = v.generation + 1
    const raw = newSpaceKey()
    const grants = []
    for (const m of v.members) {
      if (!m.publicKey) continue
      grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(raw, m.publicKey as JsonWebKey, vaultKeyContext(v.id), gen, m.accountId) })
    }
    await api.grantVaultKeys(v.id, gen, grants)
    const key = await importSpaceKey(raw)
    ring.set(gen, { raw, key })
    await api.putVaultIndex(v.id, v.version, toB64(await encryptVaultIndex(data, key, gen, v.id)))
  }

  async create(name: string): Promise<string> {
    const ov = this.overview ?? (await api.vaults())
    const fk = await this.keypair(ov)
    const id = crypto.randomUUID()
    const raw = newSpaceKey()
    const key = await importSpaceKey(raw)
    const wrapped = await wrapSpaceKey(raw, fk.publicJwk, vaultKeyContext(id), 1, ov.me)
    await api.createVault({ id, wrapped, body: toB64(await encryptVaultIndex({ name, secrets: [] }, key, 1, id)) })
    await this.load()
    return id
  }

  /** Änderung am Tresor; bei Konflikt neu laden und erneut anwenden. */
  async update(id: string, fn: (d: SharedVaultData) => SharedVaultData): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = this.vaults.find(x => x.id === id)
      if (!v?.data) throw new Error('Tresor nicht geladen.')
      const ring = this.keys.get(id)
      const gen = Math.max(...(ring?.keys() ?? [0]))
      const k = ring?.get(gen)
      if (!k || gen !== v.state.generation) {
        await this.load()
        continue
      }
      const next = fn(v.data)
      try {
        const { version } = await api.putVaultIndex(id, v.state.version, toB64(await encryptVaultIndex(next, k.key, gen, id)))
        v.data = next
        v.state = { ...v.state, version }
        this.vaults = [...this.vaults]
        return
      } catch (e) {
        if (!(e instanceof ApiClientError && e.code === 'VERSION_CONFLICT')) throw e
        await this.load()
      }
    }
    throw new Error('Tresor konnte nicht gespeichert werden – zu viele gleichzeitige Änderungen.')
  }

  async saveSecret(id: string, s: SecretEntry) {
    await this.update(id, d => ({ ...d, secrets: [s, ...d.secrets.filter(x => x.id !== s.id)] }))
  }
  async saveSecrets(id: string, list: SecretEntry[]) {
    const ids = new Set(list.map(s => s.id))
    await this.update(id, d => ({ ...d, secrets: [...list, ...d.secrets.filter(x => !ids.has(x.id))] }))
  }
  async deleteSecret(id: string, secretId: string) {
    await this.update(id, d => ({ ...d, secrets: d.secrets.filter(x => x.id !== secretId) }))
  }
  async rename(id: string, name: string) {
    await this.update(id, d => ({ ...d, name }))
  }

  /** Person hinzufügen und – falls schon möglich – sofort den Schlüssel übergeben. */
  async addMember(id: string, accountId: string, role: VaultRole) {
    await api.addVaultMember(id, accountId, role)
    await this.load()
  }
  async setRole(id: string, accountId: string, role: VaultRole) {
    await api.setVaultRole(id, accountId, role)
    await this.load()
  }
  /** Entfernen → der Verwalter-Client legt beim Neuladen sofort eine neue Generation an. */
  async removeMember(id: string, accountId: string) {
    await api.removeVaultMember(id, accountId)
    await this.load()
  }
  async remove(id: string) {
    await api.deleteVault(id)
    await this.load()
  }
}
