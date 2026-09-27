'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import { useAccount } from '@/features/account/AccountProvider'
import { api, errorMessage } from '@/features/api/client'
import {
  buildPassphraseChange,
  deriveFromRecovery,
  importMasterKey,
  isValidRecoveryWords,
  normalizeRecoveryWords,
  unwrapMasterKeyRaw
} from '@/features/keys/kdf'

export default function RecoverPage() {
  const router = useRouter()
  const { enter } = useAccount()
  const [email, setEmail] = useState('')
  const [words, setWords] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = normalizeRecoveryWords(words).split(' ').filter(Boolean).length
  const wordsOk = count === 24 && isValidRecoveryWords(words)
  const ready = !!email && wordsOk && passphraseReady(pass, pass2)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const rec = await deriveFromRecovery(words)
      const view = await api.recovery(normalized, rec.authKey)
      const env = view.envelopes.find(e => e.kekType === 'recovery')
      if (!env) throw new Error('Recovery-Schlüssel nicht gefunden.')
      const raw = await unwrapMasterKeyRaw(env, rec.kek)
      try {
        const change = await buildPassphraseChange(raw, pass)
        const updated = await api.setPassphrase(change)
        await enter(updated, await importMasterKey(raw))
      } finally {
        raw.fill(0)
      }
      router.replace('/app')
    } catch (e) {
      setError(errorMessage(e, 'Wiederherstellung fehlgeschlagen.'))
      setBusy(false)
    }
  }

  return (
    <AuthShell wide>
      <form
        onSubmit={e => {
          e.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        <h2>Tresor wiederherstellen</h2>
        <p className="lead">
          Mit deinem Recovery-Kit setzt du eine neue Passphrase. Deine Dateien bleiben erhalten – alle anderen Geräte werden
          abgemeldet.
        </p>
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="words">Recovery-Kit (24 Wörter)</label>
          <textarea
            id="words"
            rows={4}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={words}
            onChange={e => setWords(e.target.value)}
            placeholder="wort1 wort2 wort3 …"
            style={{ fontFamily: 'var(--mono)' }}
          />
          <span className="hint" style={{ color: wordsOk ? 'var(--green)' : undefined }}>
            {wordsOk ? '✓ Recovery-Kit gültig' : `${count} von 24 Wörtern${count === 24 ? ' – Prüfsumme stimmt nicht' : ''}`}
          </span>
        </div>
        <PassphraseFields value={pass} confirm={pass2} onChange={setPass} onConfirmChange={setPass2} label="Neue Passphrase" />
        {busy ? (
          <Working label="Tresor wird entsperrt und neu verschlüsselt …" />
        ) : (
          <button className="primary full" type="submit" disabled={!ready}>
            Wiederherstellen
          </button>
        )}
        <div className="authlinks">
          <Link href="/anmelden">Zurück zur Anmeldung</Link>
        </div>
      </form>
    </AuthShell>
  )
}
