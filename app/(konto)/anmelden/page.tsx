'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
import RegistrationFlow, { type RegistrationMode } from '@/components/account/RegistrationFlow'
import SocialEntry from '@/components/account/SocialEntry'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { deriveFromPassphrase, unwrapMasterKey } from '@/features/keys/kdf'
import { authMessages } from '@/lib/i18n/messages/auth'
import { teamAdminMessages } from '@/lib/i18n/messages/team-admin'
import { Icon } from '@/components/site/Icons'

export default function LoginPage() {
  const router = useRouter()
  const { path } = useI18n()
  const a = useMessages(authMessages)
  const m = a.login
  const errText = useErrorText()
  const { status, enter } = useAccount()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<Extract<RegistrationMode, { kind: 'wallet' }> | null>(null)
  const [setupStep, setSetupStep] = useState('form')
  const sm = useMessages(teamAdminMessages).login
  const [sso, setSso] = useState(false)
  const [ssoEmail, setSsoEmail] = useState('')

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('sso_error')
    if (e) {
      setError(e)
      setSso(true)
    }
  }, [])

  useEffect(() => {
    if (!setup && (status === 'ready' || status === 'locked')) router.replace(path('/app'))
  }, [status, router, setup, path])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const { kdf } = await api.prelogin(normalized)
      const keys = await deriveFromPassphrase(pass, kdf)
      const view = await api.login(normalized, keys.authKey)
      const env = view.envelopes.find(e => e.kekType === 'passphrase')
      if (!env) throw new Error('passphrase envelope missing')
      await enter(view, await unwrapMasterKey(env, keys.kek))
      const chars = [...pass.normalize('NFKC')].length
      if (view.team && view.team.passphraseChars !== chars) void api.attestPassphrase(chars).catch(() => undefined)
      router.replace(path('/app'))
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  if (setup) {
    return (
      <AuthShell kind="register" wide={setupStep !== 'form'}>
        <RegistrationFlow mode={setup} onStepChange={setSetupStep} />
      </AuthShell>
    )
  }

  return (
    <AuthShell kind="login">
      <h2>{m.title}</h2>
      <p className="lead">{m.lead}</p>
      <SocialEntry onNew={r => setSetup({ kind: 'wallet', registrationToken: r.registrationToken, address: r.address, label: r.label })} />
      <form
        onSubmit={e => {
          e.preventDefault()
          if (!busy && email && pass) void submit()
        }}
      >
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="email">{a.email}</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pass">{a.passphrase}</label>
          <input id="pass" type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        {busy ? (
          <Working label={m.working} />
        ) : (
          <button className="full" type="submit" disabled={!email || !pass}>
            {m.submit}
          </button>
        )}
        <div className="ssobox">
          {sso ? (
            <div className="field">
              <label htmlFor="sso-email">{sm.ssoEmail}</label>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input id="sso-email" type="email" autoComplete="email" value={ssoEmail} onChange={e => setSsoEmail(e.target.value)} />
                <button
                  type="button"
                  className="small"
                  disabled={!/.+@.+\..+/.test(ssoEmail)}
                  onClick={() => {
                    window.location.href = `/api/v1/auth/sso/start?email=${encodeURIComponent(ssoEmail.trim().toLowerCase())}`
                  }}
                >
                  {sm.ssoGo}
                </button>
              </div>
              <span className="hint">{sm.ssoHint}</span>
            </div>
          ) : (
            <button type="button" className="linkish" onClick={() => setSso(true)}>
              <Icon name="building" size={15} className="inlineicon" /> {sm.sso}
            </button>
          )}
        </div>
        <div className="authlinks">
          <Link href={path('/wiederherstellen')}>{m.forgot}</Link>
          <span>
            {m.newHere} <Link href={path('/registrieren')}>{m.create}</Link>
          </span>
        </div>
      </form>
    </AuthShell>
  )
}
