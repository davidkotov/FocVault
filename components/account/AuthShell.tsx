'use client'

import Link from 'next/link'
import { Icon } from '@/components/site/Icons'
import type { ReactNode } from 'react'
import LocaleSwitch from '@/components/LocaleSwitch'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { authMessages } from '@/lib/i18n/messages/auth'

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0090ff" />
      <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
      <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
    </svg>
  )
}

export type AuthKind = 'login' | 'register' | 'recover' | 'share'

/** Linke Seite der geteilten Anmelde-Ansicht: Matterhorn, Titel, drei Aussagen. */
export function AuthAside({ kind }: { kind: AuthKind }) {
  const a = useMessages(authMessages).aside[kind]
  return (
    <div className="unlockaside">
      <div className="unlockaside-top">
        <span className="unlockbadge">
          <Icon name={kind === 'share' ? 'send' : kind === 'recover' ? 'lifebuoy' : kind === 'register' ? 'shield' : 'lock'} size={22} />
        </span>
        <h2>{a.title}</h2>
        <p>{a.lead}</p>
      </div>
      <ul>
        {a.points.map(x => (
          <li key={x}>
            <Icon name="check" size={15} /> {x}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AuthShell({ children, wide, foot, aside, kind }: { children: ReactNode; wide?: boolean; foot?: ReactNode; aside?: ReactNode; kind?: AuthKind }) {
  const { path } = useI18n()
  const m = useMessages(authMessages)
  if (!aside && kind) aside = <AuthAside kind={kind} />
  if (aside)
    return (
      <main className="authsplit">
        <section className="authaside">{aside}</section>
        <section className="authpane">
          <div className="authtop">
            <Link href={path('/')} className="authbrand">
              <BrandMark />
              Foc<span>Vault</span>
            </Link>
            <LocaleSwitch />
          </div>
          <div className={`authcard${wide ? ' wide' : ''}`}>{children}</div>
          <p className="authfoot">{foot ?? m.shellFoot}</p>
        </section>
      </main>
    )
  return (
    <main className="authshell">
      <div className="authtop">
        <Link href={path('/')} className="authbrand">
          <BrandMark />
          Foc<span>Vault</span>
        </Link>
        <LocaleSwitch />
      </div>
      <div className={`authcard ${wide ? 'wide' : ''}`}>{children}</div>
      <p className="authfoot">{foot ?? m.shellFoot}</p>
    </main>
  )
}

export function Working({ label }: { label: string }) {
  return (
    <div className="working" role="status">
      <div className="spinner" />
      {label}
    </div>
  )
}

/** Vollbild-Ladeansicht (zwischen An-/Abmelden, beim Laden des Kontos). */
export function LoadingScreen({ label, error }: { label: string; error?: string | null }) {
  return (
    <main className="loadscreen" role="status" aria-live="polite">
      <div className="loadmark">
        <span className="loadring" />
        <BrandMark />
      </div>
      <div className="loadbrand">
        Foc<span>Vault</span>
      </div>
      {error ? <div className="errorbox" style={{ maxWidth: 420 }}>{error}</div> : <div className="loadlabel">{label}</div>}
      <div className="loadbar">
        <b />
      </div>
    </main>
  )
}
