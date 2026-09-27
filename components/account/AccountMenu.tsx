'use client'

import Link from 'next/link'
import { useAccount } from '@/features/account/AccountProvider'

const PLAN_LABEL = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' } as const

export default function AccountMenu() {
  const { account, syncing, syncError, lock, logout, retrySync } = useAccount()
  if (!account) return null
  return (
    <div className="accountmenu">
      <span
        className="accountpill"
        title={syncError ? `Nicht synchronisiert: ${syncError}` : syncing ? 'Wird synchronisiert…' : 'Synchronisiert'}
      >
        <span className={`syncdot ${syncError ? 'err' : syncing ? 'busy' : ''}`} />
        <span className="mail">{account.label}</span>
        <span className={`badge ${account.plan === 'free' ? '' : 'pro'}`}>{PLAN_LABEL[account.plan]}</span>
      </span>
      {syncError && (
        <button className="small" onClick={retrySync}>
          Erneut syncen
        </button>
      )}
      {account.isAdmin && (
        <Link href="/admin">
          <button className="small">Admin</button>
        </Link>
      )}
      <button className="small" onClick={lock} title="Schlüssel aus dem Speicher entfernen">
        Sperren
      </button>
      <button className="small" onClick={() => void logout()}>
        Abmelden
      </button>
    </div>
  )
}
