'use client'

import { useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes } from '@/lib/vault'
import { Icon } from '@/components/site/Icons'

const PLAN_LABEL = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' } as const
const PRESETS = [5, 15, 30, 60, 240, 480]

/** „Anmeldung“: Konto, Paket, Speicher, Passphrase, Passkeys und Auto-Sperre auf einen Blick. */
export default function SignInCard({ onTab, onPlans }: { onTab: (tab: 'passphrase' | 'passkeys') => void; onPlans: () => void }) {
  const m = useMessages(appMessages).signin
  const { account, vault, autoLockMinutes, autoLockMax, setAutoLockMinutes } = useAccount()
  const { fmtDate, fmtNumber } = useI18n()
  const [custom, setCustom] = useState<string | null>(null)
  if (!account) return null
  const presets = PRESETS.filter(n => !autoLockMax || n <= autoLockMax)
  const isPreset = presets.includes(autoLockMinutes)
  const label = (n: number) => (n % 60 === 0 && n >= 60 ? fmt(m.hours, { n: n / 60 }) : fmt(m.minutes, { n }))
  return (
    <div className="card plansection signincard">
      <div className="plansection-head">
        <h3>{m.title}</h3>
        <span className="dim">{m.lead}</span>
      </div>
      <div className="pwfield">
        <span className="k">{account.email ? m.email : m.login}</span>
        <b>{account.email ?? account.label}</b>
        <span />
      </div>
      {account.wallets.map(w => (
        <div className="pwfield" key={w}>
          <span className="k">{m.wallet}</span>
          <span className="mono">
            {w.slice(0, 10)}…{w.slice(-6)}
          </span>
          <span />
        </div>
      ))}
      <div className="pwfield">
        <span className="k">{m.plan}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <b>{PLAN_LABEL[account.plan]}</b>
          <span className="dim">
            {formatBytes(account.usedBytes)} / {formatBytes(account.quotaBytes)}
          </span>
        </span>
        <button className="small" onClick={onPlans}>
          {m.manage}
        </button>
      </div>
      <div className="pwfield">
        <span className="k">{m.entries}</span>
        <span>{fmt(m.entriesValue, { f: fmtNumber(vault.files.length), s: fmtNumber(vault.secrets.length) })}</span>
        <span className="dim">{fmt(m.since, { date: fmtDate(account.createdAt) })}</span>
      </div>
      <div className="pwfield">
        <span className="k">{m.passphrase}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono">••••••••••••••••</span>
          <span className="strongbadge">Argon2id · {Math.round(account.kdf.m / 1024)} MiB</span>
        </span>
        <button className="small" onClick={() => onTab('passphrase')}>
          {m.change}
        </button>
      </div>
      <div className="pwfield">
        <span className="k">{m.passkeys}</span>
        <span>
          {account.passkeys.length ? (
            account.passkeys.map((p, i) => (
              <span key={p.credentialId} className="pkname">
                {i > 0 && ' · '}
                <Icon name="passkey" size={14} /> {p.label}
              </span>
            ))
          ) : (
            <span className="dim">{m.none}</span>
          )}
        </span>
        <button className="small" onClick={() => onTab('passkeys')}>
          {m.manageShort}
        </button>
      </div>
      <div className="pwfield">
        <span className="k">{m.autolock}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select
            className="smallselect"
            aria-label={m.autolock}
            value={custom !== null || !isPreset ? 'custom' : String(autoLockMinutes)}
            onChange={e => {
              if (e.target.value === 'custom') return setCustom(String(autoLockMinutes))
              setCustom(null)
              setAutoLockMinutes(Number(e.target.value))
            }}
          >
            {presets.map(n => (
              <option key={n} value={n}>
                {fmt(m.after, { t: label(n) })}
              </option>
            ))}
            <option value="custom">{m.custom}</option>
          </select>
          {(custom !== null || !isPreset) && (
            <form
              className="row"
              style={{ gap: 6, alignItems: 'center' }}
              onSubmit={e => {
                e.preventDefault()
                const n = Number(custom ?? autoLockMinutes)
                if (n >= 1) setAutoLockMinutes(autoLockMax ? Math.min(n, autoLockMax) : n)
                setCustom(null)
              }}
            >
              <input
                className="capinput"
                type="number"
                min={1}
                max={autoLockMax ?? 1440}
                aria-label={m.customMinutes}
                value={custom ?? autoLockMinutes}
                onChange={e => setCustom(e.target.value)}
              />
              <span className="dim">{m.min}</span>
              {custom !== null && (
                <button className="small" type="submit">
                  {m.save}
                </button>
              )}
            </form>
          )}
        </span>
        <span className="hint">{autoLockMax ? fmt(m.policyMax, { n: autoLockMax }) : m.thisDevice}</span>
      </div>
    </div>
  )
}
