'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { Icon } from '@/components/site/Icons'
import type { Locale } from '@/lib/i18n/config'

const PLAN_LABEL = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' } as const
const LANGUAGES: Array<{ id: Locale; name: string }> = [
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' }
]

function initials(label: string): string {
  const name = label.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Kopfzeile rechts: Sperren und Avatar mit Menü (Konto, Sprache, Admin, Abmelden). */
export default function AccountMenu({ onNavigate }: { onNavigate?: (view: 'account' | 'plans') => void }) {
  const { account, syncing, syncError, lock, logout, retrySync } = useAccount()
  const { path, locale, switchLocale } = useI18n()
  const m = useMessages(appMessages).menu
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!account) return null
  const syncTitle = syncError ? fmt(m.notSynced, { error: syncError }) : syncing ? m.syncing : m.synced
  const go = (v: 'account' | 'plans') => {
    setOpen(false)
    onNavigate?.(v)
  }
  return (
    <div className="accountmenu" ref={ref}>
      {syncError && (
        <button className="small" onClick={retrySync}>
          {m.retry}
        </button>
      )}
      <button className="ghostbtn" onClick={lock} title={m.lockTitle}>
        {m.lock}
      </button>
      <button type="button" className="avatarbtn" aria-haspopup="menu" aria-expanded={open} aria-label={m.open} title={syncTitle} onClick={() => setOpen(o => !o)}>
        {initials(account.label)}
        <span className={`syncdot ${syncError ? 'err' : syncing ? 'busy' : ''}`} />
      </button>
      {open && (
        <div className="avatarmenu" role="menu">
          <div className="avatarmenu-head">
            <span className="avatarbtn big">{initials(account.label)}</span>
            <div>
              <b>{account.label}</b>
              <span className="dim">
                <span className={`badge ${account.plan === 'free' ? '' : 'pro'}`}>{PLAN_LABEL[account.plan]}</span> {syncTitle}
              </span>
            </div>
          </div>
          {onNavigate && (
            <>
              <button role="menuitem" onClick={() => go('account')}>
                <Icon name="shield" size={16} /> {m.account}
              </button>
              <button role="menuitem" onClick={() => go('plans')}>
                <Icon name="layers" size={16} /> {m.plans}
              </button>
            </>
          )}
          {account.isAdmin && (
            <Link role="menuitem" href={path('/admin')} className="menulink">
              <Icon name="admin" size={16} /> {m.admin}
            </Link>
          )}
          <div className="avatarmenu-lang" role="group" aria-label={locale === 'en' ? 'Language' : 'Sprache'}>
            {LANGUAGES.map(l => (
              <button key={l.id} role="menuitemradio" aria-checked={locale === l.id} className={locale === l.id ? 'active' : ''} onClick={() => switchLocale(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
          <button role="menuitem" className="danger" onClick={() => void logout()}>
            <Icon name="logout" size={16} /> {m.logout}
          </button>
        </div>
      )}
    </div>
  )
}
