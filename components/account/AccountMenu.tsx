'use client'

import Link from 'next/link'
import { useAccount } from '@/features/account/AccountProvider'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import LocaleSwitch from '@/components/LocaleSwitch'

const PLAN_LABEL = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' } as const

export default function AccountMenu() {
  const { account, syncing, syncError, lock, logout, retrySync } = useAccount()
  const { path } = useI18n()
  const m = useMessages(appMessages).menu
  if (!account) return null
  return (
    <div className="accountmenu">
      <LocaleSwitch />
      <span
        className="accountpill"
        title={syncError ? fmt(m.notSynced, { error: syncError }) : syncing ? m.syncing : m.synced}
      >
        <span className={`syncdot ${syncError ? 'err' : syncing ? 'busy' : ''}`} />
        <span className="mail">{account.label}</span>
        <span className={`badge ${account.plan === 'free' ? '' : 'pro'}`}>{PLAN_LABEL[account.plan]}</span>
      </span>
      {syncError && (
        <button className="small" onClick={retrySync}>
          {m.retry}
        </button>
      )}
      {account.isAdmin && (
        <Link href={path('/admin')} className="hide-mobile">
          <button className="small">{m.admin}</button>
        </Link>
      )}
      <button className="small" onClick={lock} title={m.lockTitle}>
        {m.lock}
      </button>
      <button className="small" onClick={() => void logout()}>
        {m.logout}
      </button>
    </div>
  )
}
