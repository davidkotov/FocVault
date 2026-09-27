'use client'

import Link from 'next/link'
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

export default function AuthShell({ children, wide, foot }: { children: ReactNode; wide?: boolean; foot?: ReactNode }) {
  const { path } = useI18n()
  const m = useMessages(authMessages)
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
