'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount as useWagmiAccount, useChainId, useDisconnect, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import type { AccountView } from '@/lib/api-types'
import { shortAddress } from '@/lib/reown'
import { api } from '@/features/api/client'
import { Working } from '@/components/account/AuthShell'
import { useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { authMessages } from '@/lib/i18n/messages/auth'

export type WalletLoginResult =
  | { kind: 'existing'; account: AccountView }
  | { kind: 'new'; registrationToken: string; address: string; label?: string }

/**
 * Login über Reown AppKit: Google, Apple, E-Mail oder beliebige Wallet.
 * Danach eine SIWE-Signatur (keine Transaktion) → unser Server prüft und legt die Session an.
 * Reown liefert nur die Identität – der Tresor bleibt mit Passphrase/Recovery-Kit verschlüsselt.
 */
export default function WalletLogin({ onResult }: { onResult: (r: WalletLoginResult) => void }) {
  const m = useMessages(authMessages).social
  const errText = useErrorText()
  const { open } = useAppKit()
  const { embeddedWalletInfo } = useAppKitAccount()
  const { address, isConnected } = useWagmiAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)

  const signIn = useCallback(
    async (addr: `0x${string}`) => {
      if (runningRef.current) return
      runningRef.current = true
      setBusy(true)
      setError(null)
      try {
        const { nonce } = await api.walletNonce()
        const message = createSiweMessage({
          domain: window.location.host,
          uri: window.location.origin,
          address: addr,
          chainId,
          nonce,
          version: '1',
          statement: m.statement,
          issuedAt: new Date()
        })
        const signature = await signMessageAsync({ message })
        const res = await api.walletVerify(message, signature)
        // Identität ist bestätigt – die Wallet-Verbindung wird nicht mehr gebraucht (Session per Cookie).
        await disconnectAsync().catch(() => undefined)
        if (res.status === 'existing') onResult({ kind: 'existing', account: res.account })
        else {
          const email = embeddedWalletInfo?.user?.email
          onResult({
            kind: 'new',
            registrationToken: res.registrationToken,
            address: res.address,
            label: email ?? shortAddress(res.address)
          })
        }
      } catch (e) {
        const msg = errText(e)
        setError(/reject|denied|abgelehnt/i.test(msg) ? m.rejected : msg)
      } finally {
        runningRef.current = false
        setBusy(false)
        setPending(false)
      }
    },
    [chainId, signMessageAsync, disconnectAsync, embeddedWalletInfo, onResult, m, errText]
  )

  useEffect(() => {
    if (pending && isConnected && address) void signIn(address)
  }, [pending, isConnected, address, signIn])

  return (
    <div>
      {error && <div className="errorbox">{error}</div>}
      {busy ? (
        <Working label={m.confirm} />
      ) : (
        <button
          type="button"
          className="primary full reownbtn"
          onClick={() => {
            setError(null)
            if (isConnected && address) void signIn(address)
            else {
              setPending(true)
              void open()
            }
          }}
        >
          {m.button}
        </button>
      )}
    </div>
  )
}
