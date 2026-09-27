'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
import RegistrationFlow, { type RegistrationMode } from '@/components/account/RegistrationFlow'
import SocialEntry from '@/components/account/SocialEntry'
import { useAccount } from '@/features/account/AccountProvider'
import { api, errorMessage } from '@/features/api/client'
import { deriveFromPassphrase, unwrapMasterKey } from '@/features/keys/kdf'

export default function LoginPage() {
  const router = useRouter()
  const { status, enter } = useAccount()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<Extract<RegistrationMode, { kind: 'wallet' }> | null>(null)
  const [setupStep, setSetupStep] = useState('form')

  useEffect(() => {
    if (!setup && (status === 'ready' || status === 'locked')) router.replace('/app')
  }, [status, router, setup])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const { kdf } = await api.prelogin(normalized)
      const keys = await deriveFromPassphrase(pass, kdf)
      const view = await api.login(normalized, keys.authKey)
      const env = view.envelopes.find(e => e.kekType === 'passphrase')
      if (!env) throw new Error('Kein Passphrase-Schlüssel für dieses Konto.')
      await enter(view, await unwrapMasterKey(env, keys.kek))
      router.replace('/app')
    } catch (e) {
      setError(errorMessage(e, 'Anmeldung fehlgeschlagen.'))
      setBusy(false)
    }
  }

  if (setup) {
    // Neue Reown-Identität: Tresor direkt hier einrichten.
    return (
      <AuthShell wide={setupStep !== 'form'}>
        <RegistrationFlow mode={setup} onStepChange={setSetupStep} />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h2>Anmelden</h2>
      <p className="lead">Deine Passphrase entsperrt den Tresor danach direkt auf diesem Gerät.</p>
      <SocialEntry onNew={r => setSetup({ kind: 'wallet', registrationToken: r.registrationToken, address: r.address, label: r.label })} />
      <form
        onSubmit={e => {
          e.preventDefault()
          if (!busy && email && pass) void submit()
        }}
      >
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input id="pass" type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        {busy ? (
          <Working label="Schlüssel wird abgeleitet …" />
        ) : (
          <button className="full" type="submit" disabled={!email || !pass}>
            Anmelden
          </button>
        )}
        <div className="authlinks">
          <Link href="/wiederherstellen">Passphrase vergessen?</Link>
          <span>
            Neu hier? <Link href="/registrieren">Konto erstellen</Link>
          </span>
        </div>
      </form>
    </AuthShell>
  )
}
