'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountView } from '@/lib/api-types'
import type { VaultContainer } from '@/lib/vault'
import { mergeContainers } from '@/lib/merge'
import { api, errorMessage } from '@/features/api/client'
import { deriveFromPassphrase, unwrapMasterKey } from '@/features/keys/kdf'
import { loadIndex, saveIndex, type IndexState } from '@/features/vault/sync'

export type AccountStatus = 'loading' | 'signedOut' | 'locked' | 'ready'

const AUTO_LOCK_MS = 30 * 60_000
const empty = (): VaultContainer => ({ v: 3, files: [], secrets: [] })

interface AccountContextValue {
  status: AccountStatus
  account: AccountView | null
  masterKey: CryptoKey | null
  vault: VaultContainer
  syncing: boolean
  syncError: string | null
  bootError: string | null
  /** Nach Registrierung/Login/Recovery: Session besteht, Master-Key ist entsperrt. */
  enter: (view: AccountView, masterKey: CryptoKey) => Promise<void>
  /** Session besteht (z. B. nach Reown-Login), Tresor noch gesperrt. */
  signIn: (view: AccountView) => void
  unlock: (passphrase: string) => Promise<void>
  lock: () => void
  logout: () => Promise<void>
  refreshAccount: () => Promise<void>
  mutate: (fn: (c: VaultContainer) => VaultContainer) => void
  retrySync: () => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount außerhalb von <AccountProvider>')
  return ctx
}

/**
 * Konto-Zustand im Browser. Der Master-Key liegt nur als nicht exportierbarer CryptoKey im RAM
 * und wird nach 30 Minuten Inaktivität verworfen. Der Tresor-Index wird nach jeder Änderung
 * verschlüsselt gespeichert; Änderungen während eines laufenden Speichervorgangs werden
 * gesammelt und per 3-Wege-Merge nachgezogen.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>('loading')
  const [account, setAccount] = useState<AccountView | null>(null)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [vault, setVault] = useState<VaultContainer>(empty)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  const keyRef = useRef<CryptoKey | null>(null)
  const accountRef = useRef<AccountView | null>(null)
  const baseRef = useRef<IndexState>({ version: 0, container: empty() })
  const localRef = useRef<VaultContainer>(empty())
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    api
      .account()
      .then(view => {
        accountRef.current = view
        setAccount(view)
        setStatus(view ? 'locked' : 'signedOut')
      })
      .catch(e => {
        setBootError(errorMessage(e, 'Server nicht erreichbar.'))
        setStatus('signedOut')
      })
  }, [])

  const enter = useCallback(async (view: AccountView, mk: CryptoKey) => {
    const idx = await loadIndex(mk, view.id)
    keyRef.current = mk
    accountRef.current = view
    baseRef.current = idx
    localRef.current = idx.container
    setAccount(view)
    setMasterKey(mk)
    setVault(idx.container)
    setSyncError(null)
    setStatus('ready')
  }, [])

  const signIn = useCallback((view: AccountView) => {
    accountRef.current = view
    setAccount(view)
    setStatus('locked')
  }, [])

  const unlock = useCallback(
    async (passphrase: string) => {
      const view = accountRef.current
      if (!view) throw new Error('Nicht angemeldet.')
      const env = view.envelopes.find(e => e.kekType === 'passphrase')
      if (!env) throw new Error('Kein Passphrase-Schlüssel für dieses Konto.')
      const { kek } = await deriveFromPassphrase(passphrase, view.kdf)
      await enter(view, await unwrapMasterKey(env, kek))
    },
    [enter]
  )

  const lock = useCallback(() => {
    keyRef.current = null
    baseRef.current = { version: 0, container: empty() }
    localRef.current = empty()
    setMasterKey(null)
    setVault(empty())
    setStatus(s => (s === 'ready' ? 'locked' : s))
  }, [])

  const logout = useCallback(async () => {
    lock()
    await api.logout().catch(() => undefined)
    accountRef.current = null
    setAccount(null)
    setStatus('signedOut')
  }, [lock])

  const refreshAccount = useCallback(async () => {
    const view = await api.account()
    if (view) {
      accountRef.current = view
      setAccount(view)
    }
  }, [])

  const flush = useCallback(async () => {
    const mk = keyRef.current
    const acc = accountRef.current
    if (!mk || !acc) return
    if (savingRef.current) {
      dirtyRef.current = true
      return
    }
    savingRef.current = true
    setSyncing(true)
    try {
      do {
        dirtyRef.current = false
        const sent = localRef.current
        const result = await saveIndex(mk, acc.id, baseRef.current, sent)
        if (keyRef.current !== mk) return
        baseRef.current = result
        localRef.current = dirtyRef.current ? mergeContainers(sent, localRef.current, result.container) : result.container
        setVault(localRef.current)
      } while (dirtyRef.current)
      setSyncError(null)
    } catch (e) {
      setSyncError(errorMessage(e, 'Synchronisierung fehlgeschlagen.'))
    } finally {
      savingRef.current = false
      setSyncing(false)
    }
  }, [])

  const mutate = useCallback(
    (fn: (c: VaultContainer) => VaultContainer) => {
      if (!keyRef.current) return
      localRef.current = fn(localRef.current)
      setVault(localRef.current)
      void flush()
    },
    [flush]
  )

  // Auto-Lock nach Inaktivität (ARCHITECTURE §9.2)
  useEffect(() => {
    if (status !== 'ready') return
    let timer = setTimeout(lock, AUTO_LOCK_MS)
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, AUTO_LOCK_MS)
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach(ev => window.removeEventListener(ev, reset))
    }
  }, [status, lock])

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      account,
      masterKey,
      vault,
      syncing,
      syncError,
      bootError,
      enter,
      signIn,
      unlock,
      lock,
      logout,
      refreshAccount,
      mutate,
      retrySync: () => void flush()
    }),
    [status, account, masterKey, vault, syncing, syncError, bootError, enter, signIn, unlock, lock, logout, refreshAccount, mutate, flush]
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
