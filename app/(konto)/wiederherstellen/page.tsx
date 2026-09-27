'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import {
  buildPassphraseChange,
  deriveFromRecovery,
  importMasterKey,
  isValidRecoveryWords,
  normalizeRecoveryWords,
  unwrapMasterKeyRaw
} from '@/features/keys/kdf'
import { authMessages } from '@/lib/i18n/messages/auth'

/** Standard: nur die 24 Wörter (Konto wird über die abgeleitete Kennung gefunden); E-Mail optional für ältere Konten. */
export default function RecoverPage() {
  const router = useRouter()
  const { path } = useI18n()
  const a = useMessages(authMessages)
  const m = a.recover
  const errText = useErrorText()
  const { status, account, enter } = useAccount()
  const signedIn = (status === 'locked' || status === 'ready') && !!account
  const [email, setEmail] = useState('')
  const [withEmail, setWithEmail] = useState(false)
  const [words, setWords] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = normalizeRecoveryWords(words).split(' ').filter(Boolean).length
  const wordsOk = count === 24 && isValidRecoveryWords(words)
  const ready = (signedIn || !withEmail || !!email.trim()) && wordsOk && passphraseReady(pass, pass2)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const rec = await deriveFromRecovery(words)
      const view = signedIn
        ? await api.recoveryWithSession(rec.authKey, rec.lookup)
        : await api.recovery({
            email: withEmail && email.trim() ? email.trim().toLowerCase() : undefined,
            recoveryLookup: rec.lookup,
            recoveryAuthKey: rec.authKey
          })
      const env = view.envelopes.find(e => e.kekType === 'recovery')
      if (!env) throw new Error('recovery envelope missing')
      const raw = await unwrapMasterKeyRaw(env, rec.kek)
      try {
        const updated = await api.setPassphrase(await buildPassphraseChange(raw, pass))
        await enter(updated, await importMasterKey(raw))
      } finally {
        raw.fill(0)
      }
      router.replace(path('/app'))
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <AuthShell>
        <Working label="…" />
      </AuthShell>
    )
  }

  return (
    <AuthShell wide>
      <form
        onSubmit={e => {
          e.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        <h2>{m.title}</h2>
        <p className="lead">
          {signedIn ? `${fmt(m.signedIn, { name: account.label })} ` : ''}
          {m.lead}

        </p>
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="words">{m.words}</label>
          <textarea
            id="words"
            rows={4}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={words}
            onChange={e => setWords(e.target.value)}
            placeholder={m.wordsPlaceholder}
            style={{ fontFamily: 'var(--mono)' }}
          />
          <span className="hint" style={{ color: wordsOk ? 'var(--green)' : undefined }}>
            {wordsOk ? m.valid : `${fmt(m.count, { n: count })}${count === 24 ? m.checksum : ''}`}
          </span>
        </div>
        {!signedIn &&
          (withEmail ? (
            <div className="field">
              <label htmlFor="email">
                {a.email} <span className="dim">({m.optional})</span>
              </label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
              <span className="hint">{m.emailHint}</span>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: -4 }}>
              {m.noEmailNeeded}{' '}
              <button type="button" className="linkish" onClick={() => setWithEmail(true)}>
                {m.addEmail}
              </button>
            </p>
          ))}
        <PassphraseFields value={pass} confirm={pass2} onChange={setPass} onConfirmChange={setPass2} label={m.newPass} />
        {busy ? (
          <Working label={m.working} />
        ) : (
          <button className="primary full" type="submit" disabled={!ready}>
            {m.submit}
          </button>
        )}
        <div className="authlinks">
          <Link href={path(signedIn ? '/app' : '/anmelden')}>{signedIn ? m.backApp : m.backLogin}</Link>
        </div>
      </form>
    </AuthShell>
  )
}
