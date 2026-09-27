'use client'

import { useAccount } from '@/features/account/AccountProvider'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { Icon } from '@/components/site/Icons'

/** „Anmeldung“: wie man sich anmeldet und entsperrt – mit Sprung zu den Einstellungen. */
export default function SignInCard({ onJump, isPro }: { onJump: (id: string) => void; isPro: boolean }) {
  const m = useMessages(appMessages).signin
  const { account } = useAccount()
  if (!account) return null
  const minutes = account.team?.policy.autoLockMinutes ?? 30
  return (
    <div className="card plansection signincard">
      <div className="plansection-head">
        <h3>{m.title}</h3>
        <span className="dim">{m.lead}</span>
      </div>
      <div className="pwfield">
        <span className="k">{m.login}</span>
        <b>{account.label}</b>
        <span />
      </div>
      <div className="pwfield">
        <span className="k">{m.passphrase}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono">••••••••••••••••</span>
          <span className="strongbadge">{m.argon}</span>
        </span>
        <button className="small" onClick={() => onJump('acc-passphrase')}>
          {m.change}
        </button>
      </div>
      <div className="pwfield">
        <span className="k">{m.passkeys}</span>
        <span>
          {account.passkeys.length
            ? account.passkeys.map((p, i) => (
                <span key={p.credentialId} className="pkname">
                  {i > 0 && ' · '}
                  <Icon name="passkey" size={14} /> {p.label}
                </span>
              ))
            : <span className="dim">{m.none}</span>}
        </span>
        <button className="small" onClick={() => onJump('acc-passkeys')}>
          {isPro ? m.manage : m.unlock}
        </button>
      </div>
      <div className="pwfield">
        <span className="k">{m.autolock}</span>
        <span>{fmt(m.autolockValue, { n: minutes })}</span>
        <span />
      </div>
    </div>
  )
}
