'use client'

import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { MIN_PASSPHRASE_LENGTH, passphraseStrength } from '@/features/keys/kdf'
import { authMessages } from '@/lib/i18n/messages/auth'

interface Props {
  value: string
  confirm: string
  onChange: (v: string) => void
  onConfirmChange: (v: string) => void
  label?: string
}

/** Passphrase + Wiederholung mit Stärkeanzeige. */
export default function PassphraseFields({ value, confirm, onChange, onConfirmChange, label }: Props) {
  const m = useMessages(authMessages)
  const name = label ?? m.passphrase
  const s = passphraseStrength(value)
  const mismatch = confirm.length > 0 && confirm !== value
  return (
    <>
      <div className="field">
        <label htmlFor="pp">{name}</label>
        <input
          id="pp"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={fmt(m.passphrasePlaceholder, { n: MIN_PASSPHRASE_LENGTH })}
        />
        <div className="strength" aria-hidden="true">
          <div className={`s${s.score}`} style={{ width: `${value ? Math.max(8, s.score * 25) : 0}%` }} />
        </div>
        <span className="hint">
          {value ? `${fmt(m.strength, { label: m.strengthLabels[s.score] })} ` : ''}
          {m.passphraseHint}
        </span>
      </div>
      <div className="field">
        <label htmlFor="pp2">{fmt(m.passphraseRepeat, { label: name })}</label>
        <input id="pp2" type="password" autoComplete="new-password" value={confirm} onChange={e => onConfirmChange(e.target.value)} />
        {mismatch && (
          <span className="hint" style={{ color: 'var(--red)' }}>
            {m.mismatch}
          </span>
        )}
      </div>
    </>
  )
}

export function passphraseReady(value: string, confirm: string): boolean {
  return value.length >= MIN_PASSPHRASE_LENGTH && value === confirm
}
