'use client'

import Link from 'next/link'
import { useState } from 'react'
import AuthShell from '@/components/account/AuthShell'
import RegistrationFlow, { type RegistrationMode } from '@/components/account/RegistrationFlow'
import SocialEntry from '@/components/account/SocialEntry'

export default function RegisterPage() {
  const [mode, setMode] = useState<RegistrationMode>({ kind: 'email' })
  const [step, setStep] = useState('form')
  const firstStep = step === 'form'
  return (
    <AuthShell wide={!firstStep}>
      {mode.kind === 'email' && firstStep && (
        <SocialEntry onNew={r => setMode({ kind: 'wallet', registrationToken: r.registrationToken, address: r.address, label: r.label })} />
      )}
      <RegistrationFlow key={mode.kind} mode={mode} onStepChange={setStep} />
      {firstStep && (
        <div className="authlinks">
          <span>
            Schon ein Konto? <Link href="/anmelden">Anmelden</Link>
          </span>
        </div>
      )}
    </AuthShell>
  )
}
