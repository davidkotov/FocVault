'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Working } from '@/components/account/AuthShell'
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import { useAccount } from '@/features/account/AccountProvider'
import { api, errorMessage } from '@/features/api/client'
import { buildRegistration, newRecoveryWords } from '@/features/keys/kdf'

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
  const answersOk = useMemo(
    () => positions.every((p, i) => answers[i].trim().toLowerCase() === words[p]),
    [positions, answers, words]
  )
  const stepIndex = { form: 0, kit: 1, confirm: 2, working: 3 }[step]
  const identity = mode.kind === 'wallet' ? (mode.label ?? mode.address) : email.trim().toLowerCase()

  const kitText = () =>
    [
      'FocVault Recovery-Kit',
      `Konto: ${identity}`,
      `Erstellt: ${new Date().toLocaleString('de-CH')}`,
      '',
      ...words.map((w, i) => `${String(i + 1).padStart(2, ' ')}. ${w}`),
      '',
      'Mit diesen 24 Wörtern kannst du deinen Tresor wiederherstellen, falls du die Passphrase vergisst.',
      'Offline aufbewahren (ausgedruckt, Tresor). Wer diese Wörter hat, kann deinen Tresor öffnen.'
    ].join('\n')

  const download = () => {
    const url = URL.createObjectURL(new Blob([kitText()], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'FocVault-Recovery-Kit.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const create = async () => {
    setStep('working')
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const { input, masterKey } = await buildRegistration(normalized, pass, words)
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
      router.replace('/app')
    } catch (e) {
      setError(errorMessage(e, 'Registrierung fehlgeschlagen.'))
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
          <h2>{mode.kind === 'wallet' ? 'Tresor einrichten' : 'Konto erstellen'}</h2>
          <p className="lead">
            {mode.kind === 'wallet' ? (
              <>
                Angemeldet als <strong>{identity}</strong>. Lege jetzt die Passphrase fest, die deinen Tresor verschlüsselt –
                sie ist unabhängig von deinem Login und verlässt nie dein Gerät.
              </>
            ) : (
              '5 GB kostenlos, Ende-zu-Ende-verschlüsselt. Keine Wallet, keine Kreditkarte nötig.'
            )}
          </p>
          {mode.kind === 'email' && (
            <div className="field">
              <label htmlFor="email">E-Mail</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          )}
          <PassphraseFields value={pass} confirm={pass2} onChange={setPass} onConfirmChange={setPass2} />
          <label className="checkline">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span>
              Ich verstehe: Ohne Passphrase <strong>und</strong> ohne Recovery-Kit kann niemand meine Daten wiederherstellen –
              auch FocVault nicht.
            </span>
          </label>
          <button className="primary full" type="submit" disabled={!formOk}>
            Weiter zum Recovery-Kit
          </button>
        </form>
      )}

      {step === 'kit' && (
        <>
          <h2>Dein Recovery-Kit</h2>
          <p className="lead">
            Diese 24 Wörter sind der Ersatzschlüssel zu deinem Tresor. Schreib sie auf oder speichere sie offline. Sie werden
            nur jetzt angezeigt und nie an uns übertragen.
          </p>
          <div className="wordgrid" data-testid="recovery-words">
            {words.map((w, i) => (
              <div className="word" key={i}>
                <span>{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="small" onClick={() => void navigator.clipboard?.writeText(words.join(' ')).then(() => setCopied(true))}>
              {copied ? '✓ Kopiert' : 'Kopieren'}
            </button>
            <button className="small" onClick={download}>
              Als Textdatei speichern
            </button>
            <button className="small" onClick={() => window.print()}>
              Drucken
            </button>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
            <span>Ich habe die 24 Wörter sicher und offline aufbewahrt.</span>
          </label>
          <div className="row">
            <button onClick={() => setStep('form')}>Zurück</button>
            <button
              className="primary"
              disabled={!saved}
              onClick={() => {
                setPositions(pickPositions())
                setAnswers(['', '', ''])
                setStep('confirm')
              }}
            >
              Weiter
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
          <h2>Kurz prüfen</h2>
          <p className="lead">Gib die folgenden Wörter aus deinem Recovery-Kit ein – so stellen wir sicher, dass es stimmt.</p>
          <div className="confirmwords">
            {positions.map((p, i) => (
              <div className="field" key={p}>
                <label htmlFor={`w${i}`}>Wort Nr. {p + 1}</label>
                <input
                  id={`w${i}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={answers[i]}
                  onChange={e => setAnswers(a => a.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => setStep('kit')}>
              Kit nochmal zeigen
            </button>
            <button className="primary" type="submit" disabled={!answersOk}>
              {mode.kind === 'wallet' ? 'Tresor erstellen' : 'Konto erstellen'}
            </button>
          </div>
        </form>
      )}

      {step === 'working' && (
        <>
          <h2>Tresor wird eingerichtet</h2>
          <Working label="Schlüssel werden auf deinem Gerät erzeugt (Argon2id) …" />
          <p className="hint">Das dauert einen Moment – absichtlich, damit Passphrasen nicht erraten werden können.</p>
        </>
      )}
    </>
  )
}
