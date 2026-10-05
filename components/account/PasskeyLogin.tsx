'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Working } from '@/components/account/AuthShell'
import { Icon } from '@/components/site/Icons'
import { useAccount } from '@/features/account/AccountProvider'
import { ApiClientError } from '@/features/api/client'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { PasskeyError } from '@/features/keys/passkey'
import { authMessages } from '@/lib/i18n/messages/auth'

/**
 * „Mit Passkey anmelden“ ohne E-Mail (Face ID, Touch ID, Windows Hello …). Mit PRF-Unterstützung wird
 * der Tresor gleich mit entsperrt, sonst danach wie gewohnt mit der Passphrase.
 */
export default function PasskeyLogin({ spaced }: { spaced?: boolean }) {
  const router = useRouter()
  const { path } = useI18n()
  const m = useMessages(authMessages).passkey
  const errText = useErrorText()
  const { signInWithPasskey } = useAccount()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithPasskey()
      router.replace(path('/app'))
    } catch (e) {
      setError(
        e instanceof PasskeyError && e.code === 'CANCELLED'
          ? m.cancelled
          : e instanceof ApiClientError && e.code === 'INVALID_CREDENTIALS'
            ? m.unknown
            : errText(e)
      )
      setBusy(false)
    }
  }

  return (
    <div style={spaced ? { marginTop: 10 } : undefined}>
      {error && <div className="errorbox">{error}</div>}
      {busy ? (
        <Working label={m.working} />
      ) : (
        <button type="button" className="full reownbtn" title={m.title} onClick={() => void go()}>
          <Icon name="passkey" size={16} className="inlineicon" /> {m.button}
        </button>
      )}
    </div>
  )
}
