'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
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

  useEffect(() => {
    if (status === 'ready' || status === 'locked') router.replace('/app')
  }, [status, router])

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

  return (
    <AuthShell>
      <form
        onSubmit={e => {
          e.preventDefault()
          if (!busy && email && pass) void submit()
        }}
      >
        <h2>Anmelden</h2>
        <p className="lead">Deine Passphrase entsperrt den Tresor direkt auf diesem Gerät.</p>
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pass">Passphrase</label>
          <input
            id="pass"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={e => setPass(e.target.value)}
          />
        </div>
        {busy ? (
          <Working label="Schlüssel wird abgeleitet …" />
        ) : (
          <button className="primary full" type="submit" disabled={!email || !pass}>
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
