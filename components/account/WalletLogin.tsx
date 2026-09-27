'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount as useWagmiAccount, useChainId, useDisconnect, useSignMessage } from 'wagmi'
import { createSiweMessage } from 'viem/siwe'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import type { AccountView } from '@/lib/api-types'
import { SIWE_STATEMENT, shortAddress } from '@/lib/reown'
import { api, errorMessage } from '@/features/api/client'
import { Working } from '@/components/account/AuthShell'

export type WalletLoginResult =
  | { kind: 'existing'; account: AccountView }
  | { kind: 'new'; registrationToken: string; address: string; label?: string }

/**
 * Login über Reown AppKit: Google, Apple, E-Mail oder beliebige Wallet.
 * Danach eine SIWE-Signatur (keine Transaktion) → unser Server prüft und legt die Session an.
 * Reown liefert nur die Identität – der Tresor bleibt mit Passphrase/Recovery-Kit verschlüsselt.
 */
export default function WalletLogin({ onResult }: { onResult: (r: WalletLoginResult) => void }) {
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
          statement: SIWE_STATEMENT,
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
        const msg = errorMessage(e, 'Anmeldung fehlgeschlagen.')
        setError(/reject|denied|abgelehnt/i.test(msg) ? 'Signatur abgelehnt.' : msg)
      } finally {
        runningRef.current = false
        setBusy(false)
        setPending(false)
      }
    },
    [chainId, signMessageAsync, disconnectAsync, embeddedWalletInfo, onResult]
  )

  useEffect(() => {
    if (pending && isConnected && address) void signIn(address)
  }, [pending, isConnected, address, signIn])

  return (
    <div>
      {error && <div className="errorbox">{error}</div>}
      {busy ? (
        <Working label="Bitte die Anmeldung in deiner Wallet bestätigen …" />
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
          Mit Google, Apple, E-Mail oder Wallet
        </button>
      )}
      <p className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
        über Reown · keine Transaktion, keine Kosten
      </p>
    </div>
  )
}
