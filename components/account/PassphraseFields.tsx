'use client'

import { MIN_PASSPHRASE_LENGTH, passphraseStrength } from '@/features/keys/kdf'

interface Props {
  value: string
  confirm: string
  onChange: (v: string) => void
  onConfirmChange: (v: string) => void
  label?: string
}

/** Passphrase + Wiederholung mit Stärkeanzeige. */
export default function PassphraseFields({ value, confirm, onChange, onConfirmChange, label = 'Passphrase' }: Props) {
  const s = passphraseStrength(value)
  const mismatch = confirm.length > 0 && confirm !== value
  return (
    <>
      <div className="field">
        <label htmlFor="pp">{label}</label>
        <input
          id="pp"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={`mind. ${MIN_PASSPHRASE_LENGTH} Zeichen – am besten 4+ Wörter`}
        />
        <div className="strength" aria-hidden="true">
          <div className={`s${s.score}`} style={{ width: `${value ? Math.max(8, s.score * 25) : 0}%` }} />
        </div>
        <span className="hint">
          {value ? `Stärke: ${s.label}. ` : ''}Die Passphrase verschlüsselt deinen Tresor. Niemand – auch FocVault nicht – kann
          sie zurücksetzen.
        </span>
      </div>
      <div className="field">
        <label htmlFor="pp2">{label} wiederholen</label>
        <input
          id="pp2"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => onConfirmChange(e.target.value)}
        />
        {mismatch && <span className="hint" style={{ color: 'var(--red)' }}>Stimmt nicht überein.</span>}
      </div>
    </>
  )
}

export function passphraseReady(value: string, confirm: string): boolean {
  return value.length >= MIN_PASSPHRASE_LENGTH && value === confirm
}
