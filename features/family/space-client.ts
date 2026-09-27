'use client'

import { ApiClientError, api, type SpaceState } from '@/features/api/client'
import type { Bytes } from '@/lib/crypto'
import type { VaultEntry } from '@/lib/vault'
import {
  decryptSpaceIndex,
  encryptSpaceIndex,
  generateFamilyKeypair,
  importSpaceKey,
  newSpaceKey,
  spaceIndexGeneration,
  unwrapSpaceKey,
  wrapSpaceKey,
  type WrappedSpaceKey
} from './space-crypto'

export type SpaceStatus = 'loading' | 'ready' | 'waiting' | 'error'
type Keypair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey }

/**
 * Familien-/Teamordner im Browser: Schlüsselpaar sicherstellen, eigene Ordner-Schlüssel öffnen,
 * fehlende Hüllen für andere Mitglieder verteilen (jedes Gerät hilft mit), beim Inhaber bei Bedarf
 * eine neue Generation anlegen, Index laden und speichern.
 */
export class SpaceClient {
  status: SpaceStatus = 'loading'
  error: string | null = null
  state: SpaceState | null = null
  files: VaultEntry[] = []
  private keys = new Map<number, { raw: Bytes; key: CryptoKey }>()
  private index = { version: 0, files: [] as VaultEntry[] }
  private generated: Keypair | null = null
  private running: Promise<SpaceStatus> | null = null

  constructor(
    private readonly accountId: string,
    private readonly familyKey: () => Keypair | undefined,
    private readonly saveFamilyKey: (k: Keypair) => void
  ) {}

  generation(): number {
    return Math.max(0, ...this.keys.keys())
  }
  currentKey(): CryptoKey | null {
    return this.keys.get(this.generation())?.key ?? null
  }
  keyFor(gen: number | undefined): CryptoKey | null {
    return this.keys.get(gen ?? this.generation())?.key ?? null
  }

  /** Nie zwei Abgleiche gleichzeitig (sonst konkurrierende Schlüssel/Generationen). */
  load(): Promise<SpaceStatus> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null))
    return this.running
  }

  private async run(): Promise<SpaceStatus> {
    this.error = null
    try {
      let fk = this.familyKey() ?? this.generated
      if (!fk) {
        fk = this.generated = await generateFamilyKeypair()
        this.saveFamilyKey(fk)
      }
      let st = await api.familySpace()
      const me = st.members.find(m => m.accountId === this.accountId)
      const pub = me?.publicKey as JsonWebKey | null
      if (!pub || pub.x !== fk.publicJwk.x || pub.y !== fk.publicJwk.y) {
        await api.setPublicKey(fk.publicJwk)
        st = await api.familySpace()
      }
      this.keys = new Map()
      for (const k of st.myKeys) {
        try {
          const raw = await unwrapSpaceKey(k.wrapped as WrappedSpaceKey, fk.privateJwk, st.ownerId, k.generation, this.accountId)
          this.keys.set(k.generation, { raw, key: await importSpaceKey(raw) })
        } catch {
          // Hülle für ein älteres Schlüsselpaar – wird von einem anderen Gerät neu verteilt
        }
      }
      // Inhaber: erste Generation, neue nach dem Entfernen eines Mitglieds, oder eigener aktueller Schlüssel fehlt
      if (st.isOwner && (st.generation === 0 || st.rotateNeeded || !this.keys.has(st.generation))) {
        const gen = st.generation + 1
        const raw = newSpaceKey()
        const grants = []
        for (const m of st.members) {
          if (!m.publicKey) continue
          grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(raw, m.publicKey as JsonWebKey, st.ownerId, gen, m.accountId) })
        }
        await api.familySpaceGrant(gen, grants)
        this.keys.set(gen, { raw, key: await importSpaceKey(raw) })
        st = await api.familySpace()
      }
      // Fehlende Hüllen verteilen (auch ältere Generationen, damit neue Mitglieder vorhandene Dateien lesen können)
      for (const [gen, k] of this.keys) {
        const grants = []
        for (const m of st.members) {
          if (!m.publicKey || m.generations.includes(gen)) continue
          grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(k.raw, m.publicKey as JsonWebKey, st.ownerId, gen, m.accountId) })
        }
        if (grants.length) await api.familySpaceGrant(gen, grants).catch(() => undefined)
      }
      this.state = st
      if (!this.keys.size) return (this.status = 'waiting')
      await this.reloadIndex()
      return (this.status = this.status === 'waiting' ? 'waiting' : 'ready')
    } catch (e) {
      this.error = (e as Error).message
      return (this.status = 'error')
    }
  }

  private async reloadIndex() {
    const r = await api.getSpaceIndex()
    if (!r) {
      this.index = { version: 0, files: [] }
    } else {
      const k = this.keys.get(spaceIndexGeneration(r.body))
      if (!k) {
        this.status = 'waiting'
        return
      }
      this.index = { version: r.version, files: (await decryptSpaceIndex(r.body, k.key, this.state!.ownerId)).files }
    }
    this.files = this.index.files
    this.status = 'ready'
  }

  /** Änderung am Index: bei Konflikt neu laden und dieselbe Änderung erneut anwenden. */
  async update(fn: (files: VaultEntry[]) => VaultEntry[]): Promise<void> {
    if (!this.state) throw new Error('Gemeinsamer Ordner nicht geladen.')
    for (let attempt = 0; attempt < 4; attempt++) {
      const gen = this.generation()
      const k = this.keys.get(gen)!
      const next = fn(this.index.files)
      try {
        const body = await encryptSpaceIndex({ v: 3, files: next, secrets: [] }, k.key, gen, this.state.ownerId)
        const { version } = await api.putSpaceIndex(this.index.version, body)
        this.index = { version, files: next }
        this.files = next
        return
      } catch (e) {
        if (!(e instanceof ApiClientError && e.code === 'VERSION_CONFLICT')) throw e
        await this.reloadIndex()
      }
    }
    throw new Error('Ordner konnte nicht gespeichert werden – zu viele gleichzeitige Änderungen.')
  }
}
