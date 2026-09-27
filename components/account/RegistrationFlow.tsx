'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Working } from '@/components/account/AuthShell'
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { buildRegistration, newRecoveryWords } from '@/features/keys/kdf'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { authMessages } from '@/lib/i18n/messages/auth'
import { commonMessages } from '@/lib/i18n/messages/common'

export type RegistrationMode =
  | { kind: 'email' }
  | { kind: 'wallet'; registrationToken: string; address: string; label?: string }

type Step = 'form' | 'kit' | 'confirm' | 'working'

function pickPositions(): number[] {
  const set = new Set<number>()
  while (set.size < 3) set.add(Math.floor(Math.random() * 24))
  return [...set].sort((a, b) => a - b)
}

/**
 * Tresor einrichten: Passphrase → Recovery-Kit (24 Wörter) → Stichprobe → Konto anlegen.
 * E-Mail-Konten und Reown-Konten (Wallet/Social) nutzen denselben Ablauf.
 */
export default function RegistrationFlow({ mode, onStepChange }: { mode: RegistrationMode; onStepChange?: (s: Step) => void }) {
  const router = useRouter()
  const { enter } = useAccount()
  const { path, locale } = useI18n()
  const a = useMessages(authMessages)
  const m = a.register
  const c = useMessages(commonMessages)
  const errText = useErrorText()
  const [step, setStepState] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [agree, setAgree] = useState(false)
  const [saved, setSaved] = useState(false)
  const [words, setWords] = useState<string[]>([])
  const [positions, setPositions] = useState<number[]>([])
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const setStep = (s: Step) => {
    setStepState(s)
    onStepChange?.(s)
  }
  const emailOk = mode.kind === 'wallet' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const formOk = emailOk && passphraseReady(pass, pass2) && agree
  const answersOk = useMemo(() => positions.every((p, i) => answers[i].trim().toLowerCase() === words[p]), [positions, answers, words])
  const stepIndex = { form: 0, kit: 1, confirm: 2, working: 3 }[step]
  const identity = mode.kind === 'wallet' ? (mode.label ?? mode.address) : email.trim().toLowerCase()

  const kitText = () =>
    [
      m.kitFile.title,
      `${m.kitFile.account}: ${identity}`,
      `${m.kitFile.created}: ${new Date().toLocaleString(locale === 'en' ? 'en-GB' : 'de-CH')}`,
      '',
      ...words.map((w, i) => `${String(i + 1).padStart(2, ' ')}. ${w}`),
      '',
      m.kitFile.use,
      m.kitFile.keep
    ].join('\n')

  const download = () => {
    const url = URL.createObjectURL(new Blob([kitText()], { type: 'text/plain;charset=utf-8' }))
    const el = document.createElement('a')
    el.href = url
    el.download = 'FocVault-Recovery-Kit.txt'
    el.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const create = async () => {
    setStep('working')
    setError(null)
    try {
      const { input, masterKey } = await buildRegistration(email.trim().toLowerCase(), pass, words)
      const view =
        mode.kind === 'email'
          ? await api.register(input)
          : await api.walletRegister({
              registrationToken: mode.registrationToken,
              label: mode.label,
              authKey: input.authKey,
              recoveryAuthKey: input.recoveryAuthKey,
              kdf: input.kdf,
              envelopes: input.envelopes
            })
      await enter(view, masterKey)
      router.replace(path('/app'))
    } catch (e) {
      setError(errText(e))
      setStep('confirm')
    }
  }

  return (
    <>
      <div className="stepper" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={i <= stepIndex ? 'on' : ''} />
        ))}
      </div>
      {error && <div className="errorbox">{error}</div>}

      {step === 'form' && (
        <form
          onSubmit={e => {
            e.preventDefault()
            if (!formOk) return
            setWords(newRecoveryWords())
            setSaved(false)
            setError(null)
            setStep('kit')
          }}
        >
          <h2>{mode.kind === 'wallet' ? m.titleWallet : m.title}</h2>
          <p className="lead">{mode.kind === 'wallet' ? fmt(m.leadWallet, { name: identity }) : fmt(m.lead, { gb: 5 })}</p>
          {mode.kind === 'email' && (
            <div className="field">
              <label htmlFor="email">{a.email}</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          )}
          <PassphraseFields value={pass} confirm={pass2} onChange={setPass} onConfirmChange={setPass2} />
          <label className="checkline">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span>{m.agree}</span>
          </label>
          <button className="primary full" type="submit" disabled={!formOk}>
            {m.toKit}
          </button>
        </form>
      )}

      {step === 'kit' && (
        <>
          <h2>{m.kitTitle}</h2>
          <p className="lead">{m.kitLead}</p>
          <div className="wordgrid" data-testid="recovery-words">
            {words.map((w, i) => (
              <div className="word" key={i}>
                <span>{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ marginBottom: 14 }}>
            <button className="small" onClick={() => void navigator.clipboard?.writeText(words.join(' ')).then(() => setCopied(true))}>
              {copied ? m.copied : m.copy}
            </button>
            <button className="small" onClick={download}>
              {m.saveFile}
            </button>
            <button className="small" onClick={() => window.print()}>
              {m.print}
            </button>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
            <span>{m.saved}</span>
          </label>
          <div className="row">
            <button onClick={() => setStep('form')}>{c.back}</button>
            <button
              className="primary"
              disabled={!saved}
              onClick={() => {
                setPositions(pickPositions())
                setAnswers(['', '', ''])
                setStep('confirm')
              }}
            >
              {c.next}
            </button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <form
          onSubmit={e => {
            e.preventDefault()
            if (answersOk) void create()
          }}
        >
          <h2>{m.checkTitle}</h2>
          <p className="lead">{m.checkLead}</p>
          <div className="confirmwords">
            {positions.map((p, i) => (
              <div className="field" key={p}>
                <label htmlFor={`w${i}`}>{fmt(m.word, { n: p + 1 })}</label>
                <input
                  id={`w${i}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={answers[i]}
                  onChange={e => setAnswers(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </div>
          <div className="row wrap">
            <button type="button" onClick={() => setStep('kit')}>
              {m.showKit}
            </button>
            <button className="primary" type="submit" disabled={!answersOk}>
              {mode.kind === 'wallet' ? m.createWallet : m.create}
            </button>
          </div>
        </form>
      )}

      {step === 'working' && (
        <>
          <h2>{m.workingTitle}</h2>
          <Working label={m.working} />
          <p className="hint">{m.workingHint}</p>
        </>
      )}
    </>
  )
}
