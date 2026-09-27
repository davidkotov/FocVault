'use client'

import { useRouter } from 'next/navigation'
import { useAccount } from '@/features/account/AccountProvider'
import { reownEnabled } from '@/lib/reown'
import WalletLogin, { type WalletLoginResult } from './WalletLogin'

/**
 * Reown-Einstieg für /anmelden und /registrieren. Bekanntes Konto → Tresor entsperren;
 * neue Identität → onNew (Tresor einrichten). Ohne Project-ID wird nichts angezeigt.
 */
export default function SocialEntry({ onNew }: { onNew: (r: Extract<WalletLoginResult, { kind: 'new' }>) => void }) {
  const router = useRouter()
  const { signIn } = useAccount()
  if (!reownEnabled) return null
  return (
    <>
      <WalletLogin
        onResult={r => {
          if (r.kind === 'existing') {
            signIn(r.account)
            router.replace('/app')
          } else onNew(r)
        }}
      />
      <div className="ordivider">oder mit E-Mail und Passphrase</div>
    </>
  )
}
