'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { passkeySupported } from '@/features/keys/passkey'
import { authMessages } from '@/lib/i18n/messages/auth'
import { reownEnabled } from '@/lib/reown'
import PasskeyLogin from './PasskeyLogin'
import WalletLogin, { type WalletLoginResult } from './WalletLogin'

/**
 * Einstieg über Reown (/anmelden und /registrieren) und – nur mit `passkey` – „Mit Passkey anmelden“.
 * Bekanntes Konto → Tresor entsperren; neue Identität → onNew (Tresor einrichten).
 * Ohne Reown-Project-ID und ohne Passkey-Unterstützung wird nichts angezeigt.
 */
export default function SocialEntry({
  onNew,
  passkey = false
}: {
  onNew: (r: Extract<WalletLoginResult, { kind: 'new' }>) => void
  passkey?: boolean
}) {
  const router = useRouter()
  const { signIn } = useAccount()
  const { path } = useI18n()
  const m = useMessages(authMessages).social
  // erst nach dem Mounten prüfen (kein Hydration-Unterschied zum Server-Rendering)
  const [withPasskey, setWithPasskey] = useState(false)
  useEffect(() => setWithPasskey(passkey && passkeySupported()), [passkey])
  if (!reownEnabled && !withPasskey) return null
  return (
    <>
      {reownEnabled && (
        <WalletLogin
          onResult={r => {
            if (r.kind === 'existing') {
              signIn(r.account)
              router.replace(path('/app'))
            } else onNew(r)
          }}
        />
      )}
      {withPasskey && <PasskeyLogin spaced={reownEnabled} />}
      <div className="ordivider">{m.divider}</div>
    </>
  )
}
