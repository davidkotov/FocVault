'use client'

import { useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { deriveFromPassphrase, deriveFromRecovery, isValidRecoveryWords } from '@/features/keys/kdf'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'
import { Icon } from '@/components/site/Icons'

/** Konto endgültig löschen – mit Passphrase oder Recovery-Kit und getippter Bestätigung. */
export default function DeleteAccountCard({ onPlans, onTeam }: { onPlans: () => void; onTeam: () => void }) {
  const m = useMessages(appMessages).deleteAcc
  const { account } = useAccount()
  const { path } = useI18n()
  const errText = useErrorText()
  const [kind, setKind] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!account) return null
  const word = m.confirmWord
  const ready = secret.trim().length > 0 && confirm.trim().toUpperCase() === word

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      let authKey: string
      if (kind === 'passphrase') authKey = (await deriveFromPassphrase(secret, account.kdf)).authKey
      else {
        if (!isValidRecoveryWords(secret)) throw new Error(m.invalidWords)
        authKey = (await deriveFromRecovery(secret)).authKey
      }
      await api.deleteAccount({ kind, authKey, confirm: 'DELETE' })
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('fv_')) localStorage.removeItem(k)
        for (const k of Object.keys(sessionStorage)) if (k.startsWith('fv_')) sessionStorage.removeItem(k)
      } catch {
        /* Speicher nicht verfügbar */
      }
      window.location.assign(path('/') + '?konto=geloescht')
    } catch (e) {
      setError(e instanceof Error && e.message === m.invalidWords ? m.invalidWords : errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="card plansection deletecard">
      <div className="plansection-head">
        <h3>{m.title}</h3>
        <span className="pwbadge bad">{m.irreversible}</span>
      </div>
      <div className="deletebody">
        <p className="dim">{m.lead}</p>
        <ul className="deletelist">
          {m.points.map(p => (
            <li key={p}>
              <Icon name="x" size={14} /> {p}
            </li>
          ))}
        </ul>
        <div className="deletehints">
          {account.plan !== 'free' && (
            <button className="linkish" onClick={onPlans}>
              {m.hintPlan}
            </button>
          )}
          <button className="linkish" onClick={onTeam}>
            {m.hintTeam}
          </button>
        </div>
        <div className="sm2-seg" role="group" aria-label={m.method}>
          <button className={kind === 'passphrase' ? 'active' : ''} aria-pressed={kind === 'passphrase'} onClick={() => (setKind('passphrase'), setSecret(''))}>
            {m.withPassphrase}
          </button>
          <button className={kind === 'recovery' ? 'active' : ''} aria-pressed={kind === 'recovery'} onClick={() => (setKind('recovery'), setSecret(''))}>
            {m.withRecovery}
          </button>
        </div>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (ready) void run()
          }}
        >
          {kind === 'passphrase' ? (
            <label className="field">
              <span>{m.passphrase}</span>
              <input type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>{m.words}</span>
              <textarea rows={3} value={secret} onChange={e => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          <label className="field">
            <span>{m.typeConfirm.replace('{word}', word)}</span>
            <input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" aria-label={m.typeConfirm.replace('{word}', word)} />
          </label>
          {error && <div className="errorbox">{error}</div>}
          <button className="danger full" type="submit" disabled={!ready || busy}>
            {busy ? m.deleting : m.button}
          </button>
        </form>
      </div>
    </div>
  )
}
