'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
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

/**
 * Familienordner im Browser: Schlüsselpaar sicherstellen, eigene Ordner-Schlüssel öffnen,
 * fehlende Hüllen für andere Mitglieder verteilen (jedes Gerät hilft mit), beim Inhaber bei Bedarf
 * eine neue Generation anlegen, Index laden und speichern.
 */
export function useFamilySpace(enabled: boolean) {
  const { account, vault, mutate } = useAccount()
  const [status, setStatus] = useState<SpaceStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<VaultEntry[]>([])
  const [state, setState] = useState<SpaceState | null>(null)
  const keys = useRef(new Map<number, { raw: Bytes; key: CryptoKey }>())
  const index = useRef<{ version: number; files: VaultEntry[] }>({ version: 0, files: [] })
  const familyKey = vault.familyKey
  const running = useRef<Promise<void> | null>(null)
  const generated = useRef<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey } | null>(null)

  const currentGen = () => Math.max(0, ...keys.current.keys())

  const run = useCallback(async () => {
    if (!account) return
    setError(null)
    try {
      // Genau ein Schlüsselpaar pro Tresor – auch wenn der Effekt doppelt läuft
      let fk = familyKey ?? generated.current
      if (!fk) {
        fk = generated.current = await generateFamilyKeypair()
        const created = fk
        mutate(c => (c.familyKey ? c : { ...c, familyKey: created }))
      }
      let st = await api.familySpace()
      const me = st.members.find(m => m.accountId === account.id)
      const pub = me?.publicKey as JsonWebKey | null
      if (!pub || pub.x !== fk.publicJwk.x || pub.y !== fk.publicJwk.y) {
        await api.setPublicKey(fk.publicJwk)
        st = await api.familySpace()
      }

      keys.current = new Map()
      for (const k of st.myKeys) {
        try {
          const raw = await unwrapSpaceKey(k.wrapped as WrappedSpaceKey, fk.privateJwk, st.ownerId, k.generation, account.id)
          keys.current.set(k.generation, { raw, key: await importSpaceKey(raw) })
        } catch {
          // Hülle für einen älteren Schlüssel – wird von einem anderen Gerät neu verteilt
        }
      }

      // Inhaber: erste Generation, neue nach dem Entfernen eines Mitglieds, oder eigener
      // aktueller Schlüssel fehlt (z. B. neues Schlüsselpaar) → neue Generation, ältere verteilen die anderen
      if (st.isOwner && (st.generation === 0 || st.rotateNeeded || !keys.current.has(st.generation))) {
        const gen = st.generation + 1
        const raw = newSpaceKey()
        const grants = []
        for (const m of st.members) {
          if (!m.publicKey) continue
          grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(raw, m.publicKey as JsonWebKey, st.ownerId, gen, m.accountId) })
        }
        await api.familySpaceGrant(gen, grants)
        keys.current.set(gen, { raw, key: await importSpaceKey(raw) })
        st = await api.familySpace()
      }

      // Fehlende Hüllen an Mitglieder mit Schlüsselpaar verteilen (auch ältere Generationen,
      // damit neue Mitglieder vorhandene Dateien lesen können)
      for (const [gen, k] of keys.current) {
        const grants = []
        for (const m of st.members) {
          if (!m.publicKey || m.generations.includes(gen)) continue
          grants.push({ accountId: m.accountId, wrapped: await wrapSpaceKey(k.raw, m.publicKey as JsonWebKey, st.ownerId, gen, m.accountId) })
        }
        if (grants.length) await api.familySpaceGrant(gen, grants).catch(() => undefined)
      }
      setState(st)

      if (!keys.current.size) {
        setStatus('waiting')
        return
      }
      const r = await api.getSpaceIndex()
      if (r) {
        const gen = spaceIndexGeneration(r.body)
        const k = keys.current.get(gen)
        if (!k) {
          setStatus('waiting')
          return
        }
        index.current = { version: r.version, files: (await decryptSpaceIndex(r.body, k.key, st.ownerId)).files }
      } else {
        index.current = { version: 0, files: [] }
      }
      setFiles(index.current.files)
      setStatus('ready')
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    }
  }, [account, familyKey, mutate])

  /** Nie zwei Abgleiche gleichzeitig (sonst konkurrierende Schlüssel/Generationen). */
  const load = useCallback(() => {
    if (!running.current) running.current = run().finally(() => (running.current = null))
    return running.current
  }, [run])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  /** Änderung am Index: bei Konflikt neu laden und dieselbe Änderung erneut anwenden. */
  const update = useCallback(
    async (fn: (files: VaultEntry[]) => VaultEntry[]) => {
      if (!state) throw new Error('Familienordner nicht geladen.')
      for (let attempt = 0; attempt < 4; attempt++) {
        const gen = currentGen()
        const k = keys.current.get(gen)!
        const next = fn(index.current.files)
        try {
          const body = await encryptSpaceIndex({ v: 3, files: next, secrets: [] }, k.key, gen, state.ownerId)
          const { version } = await api.putSpaceIndex(index.current.version, body)
          index.current = { version, files: next }
          setFiles(next)
          return
        } catch (e) {
          if (!(e instanceof ApiClientError && e.code === 'VERSION_CONFLICT')) throw e
          const r = await api.getSpaceIndex()
          if (r) {
            const rk = keys.current.get(spaceIndexGeneration(r.body))
            if (!rk) throw new Error('Neuer Ordner-Schlüssel – bitte neu laden.')
            index.current = { version: r.version, files: (await decryptSpaceIndex(r.body, rk.key, state.ownerId)).files }
          }
        }
      }
      throw new Error('Familienordner konnte nicht gespeichert werden – zu viele gleichzeitige Änderungen.')
    },
    [state]
  )

  return {
    status,
    error,
    files,
    state,
    reload: load,
    update,
    generation: () => currentGen(),
    /** Schlüssel der aktuellen Generation (für neue Dateien) */
    currentKey: () => keys.current.get(currentGen())?.key ?? null,
    keyFor: (gen: number | undefined) => keys.current.get(gen ?? currentGen())?.key ?? null
  }
}
