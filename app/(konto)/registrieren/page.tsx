'use client'

import Link from 'next/link'
import { useState } from 'react'
import AuthShell from '@/components/account/AuthShell'
import RegistrationFlow, { type RegistrationMode } from '@/components/account/RegistrationFlow'
import SocialEntry from '@/components/account/SocialEntry'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { authMessages } from '@/lib/i18n/messages/auth'

export default function RegisterPage() {
  const { path } = useI18n()
  const m = useMessages(authMessages).register
  const [mode, setMode] = useState<RegistrationMode>({ kind: 'email' })
  const [step, setStep] = useState('form')
  const firstStep = step === 'form'
  return (
    <AuthShell kind="register" wide={!firstStep}>
      {mode.kind === 'email' && firstStep && (
        <SocialEntry onNew={r => setMode({ kind: 'wallet', registrationToken: r.registrationToken, address: r.address, label: r.label })} />
      )}
      <RegistrationFlow key={mode.kind} mode={mode} onStepChange={setStep} />
      {firstStep && (
        <div className="authlinks">
          <span>
            {m.haveAccount} <Link href={path('/anmelden')}>{m.signIn}</Link>
          </span>
        </div>
      )}
    </AuthShell>
  )
}
