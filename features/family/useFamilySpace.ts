'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import type { SpaceState } from '@/features/api/client'
import type { VaultEntry } from '@/lib/vault'
import { SpaceClient, type SpaceStatus } from './space-client'

export type { SpaceStatus }

/** React-Hülle um den SpaceClient (ein Client pro Konto). */
export function useFamilySpace(enabled: boolean) {
  const { account, vault, mutate } = useAccount()
  const familyKeyRef = useRef(vault.familyKey)
  familyKeyRef.current = vault.familyKey
  const client = useRef<SpaceClient | null>(null)
  if (account && !client.current) {
    client.current = new SpaceClient(
      account.id,
      () => familyKeyRef.current,
      k => mutate(c => (c.familyKey ? c : { ...c, familyKey: k }))
    )
  }
  const [status, setStatus] = useState<SpaceStatus>('loading')
  const [files, setFiles] = useState<VaultEntry[]>([])
  const [state, setState] = useState<SpaceState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sync = useCallback(() => {
    const c = client.current!
    setStatus(c.status)
    setFiles(c.files)
    setState(c.state)
    setError(c.error)
  }, [])

  const reload = useCallback(async () => {
    if (!client.current) return
    await client.current.load()
    sync()
  }, [sync])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  const update = useCallback(
    async (fn: (files: VaultEntry[]) => VaultEntry[]) => {
      await client.current!.update(fn)
      sync()
    },
    [sync]
  )

  return {
    status,
    error,
    files,
    state,
    reload,
    update,
    client: client.current,
    generation: () => client.current?.generation() ?? 0,
    currentKey: () => client.current?.currentKey() ?? null,
    keyFor: (gen: number | undefined) => client.current?.keyFor(gen) ?? null
  }
}
