'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountView } from '@/lib/api-types'
import type { VaultContainer } from '@/lib/vault'
import { mergeContainers } from '@/lib/merge'
import { api, errorMessage } from '@/features/api/client'
import { deriveFromPassphrase, unwrapMasterKey } from '@/features/keys/kdf'
import { passkeyKek, passkeyLogin, passkeyPrf, passkeyPrfSalt } from '@/features/keys/passkey'
import { toB64Url } from '@/lib/crypto'
import { loadIndex, saveIndex, type IndexState } from '@/features/vault/sync'

export type AccountStatus = 'loading' | 'signedOut' | 'locked' | 'ready'

const AUTO_LOCK_MS = 30 * 60_000
/** längste Auto-Sperre: 24 Stunden (kein „nie“ – der Schlüssel soll nicht unbegrenzt im Speicher bleiben) */
const MAX_AUTO_LOCK_MIN = 24 * 60
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
  /** Mit einem hinterlegten Passkey entsperren */
  unlockWithPasskey: () => Promise<void>
  /** Anmelden per Passkey ohne E-Mail; true = Tresor gleich mit entsperrt, false = Session, Tresor gesperrt */
  signInWithPasskey: () => Promise<boolean>
  lock: () => void
  /** Automatisch sperren nach … Minuten (dieses Gerät; bei Teams höchstens die Richtlinie) */
  autoLockMinutes: number
  /** Vorgabe der Team-Richtlinie (Obergrenze) oder null */
  autoLockMax: number | null
  setAutoLockMinutes: (n: number) => void
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

  // Start: Konto laden. Nur solange noch „loading“ gilt – eine späte Antwort darf einen inzwischen
  // entsperrten Tresor nicht wieder sperren (langsames Netz, doppelte Effekte im Dev-Modus).
  useEffect(() => {
    let stale = false
    api
      .account()
      .then(view => {
        if (stale) return
        setStatus(s => {
          if (s !== 'loading') return s
          accountRef.current = view
          setAccount(view)
          return view ? 'locked' : 'signedOut'
        })
      })
      .catch(e => {
        if (stale) return
        setBootError(errorMessage(e, 'Server nicht erreichbar.'))
        setStatus(s => (s === 'loading' ? 'signedOut' : s))
      })
    return () => {
      stale = true
    }
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
      // Team-Richtlinie: Länge der Passphrase melden (der Server kann sie nicht selbst prüfen)
      const chars = [...passphrase.normalize('NFKC')].length
      if (view.team && view.team.passphraseChars !== chars) void api.attestPassphrase(chars).catch(() => undefined)
    },
    [enter]
  )

  const unlockWithPasskey = useCallback(async () => {
    const view = accountRef.current
    if (!view?.passkeys.length) throw new Error('Kein Passkey eingerichtet.')
    const { credentialId, prf } = await passkeyPrf(view.passkeys)
    const pk = view.passkeys.find(p => p.credentialId === credentialId)!
    try {
      const kek = await passkeyKek(prf, credentialId)
      await enter(view, await unwrapMasterKey({ kekType: 'passkey', iv: pk.iv, cipher: pk.cipher }, kek))
    } finally {
      prf.fill(0)
    }
  }, [enter])

  const signInWithPasskey = useCallback(async () => {
    const { challenge } = await api.passkeyOptions()
    const { assertion, prf } = await passkeyLogin(challenge)
    try {
      const view = await api.passkeyVerify(assertion)
      const pk = view.passkeys.find(p => p.credentialId === assertion.credentialId)
      // Ein Aufruf liefert Signatur + PRF-Wert – aber nur für Passkeys mit dem festen Salt
      if (prf && pk && pk.salt === toB64Url(await passkeyPrfSalt())) {
        try {
          const kek = await passkeyKek(prf, pk.credentialId)
          await enter(view, await unwrapMasterKey({ kekType: 'passkey', iv: pk.iv, cipher: pk.cipher }, kek))
          return true
        } catch {
          /* Hülle passt nicht (mehr) – dann mit Passphrase entsperren */
        }
      }
      signIn(view)
      return false
    } finally {
      prf?.fill(0)
    }
  }, [enter, signIn])

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

  // Auto-Lock nach Inaktivität (ARCHITECTURE §9.2) – pro Gerät einstellbar, Team-Richtlinie ist die Obergrenze
  const [autoLockPref, setAutoLockPref] = useState<number>(() => {
    if (typeof window === 'undefined') return AUTO_LOCK_MS / 60_000
    const v = Number(window.localStorage.getItem('fv_autolock_min'))
    return Number.isFinite(v) && v >= 1 && v <= MAX_AUTO_LOCK_MIN ? v : AUTO_LOCK_MS / 60_000
  })
  const autoLockMax = account?.team ? account.team.policy.autoLockMinutes : null
  const autoLockMinutes = autoLockMax ? Math.min(autoLockPref, autoLockMax) : autoLockPref
  const setAutoLockMinutes = useCallback((n: number) => {
    const v = Math.max(1, Math.min(MAX_AUTO_LOCK_MIN, Math.round(n)))
    setAutoLockPref(v)
    window.localStorage.setItem('fv_autolock_min', String(v))
  }, [])
  useEffect(() => {
    if (status !== 'ready') return
    const ms = autoLockMinutes * 60_000
    let timer = setTimeout(lock, ms)
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, ms)
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach(ev => window.removeEventListener(ev, reset))
    }
  }, [status, lock, autoLockMinutes]) // eslint-disable-line react-hooks/exhaustive-deps

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
      unlockWithPasskey,
      signInWithPasskey,
      lock,
      autoLockMinutes,
      autoLockMax,
      setAutoLockMinutes,
      logout,
      refreshAccount,
      mutate,
      retrySync: () => void flush()
    }),
    [status, account, masterKey, vault, syncing, syncError, bootError, enter, signIn, unlock, unlockWithPasskey, signInWithPasskey, lock, autoLockMinutes, autoLockMax, setAutoLockMinutes, logout, refreshAccount, mutate, flush]
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
