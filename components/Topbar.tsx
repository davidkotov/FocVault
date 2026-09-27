'use client'

import type { ReactNode } from 'react'
import { useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

interface Props {
  title: string
  search?: string
  onSearchChange?: (v: string) => void
  showSearch?: boolean
  /** Rechter Bereich (Kontomenü). */
  right?: ReactNode
}

export default function Topbar({ title, search, onSearchChange, showSearch, right }: Props) {
  const m = useMessages(appMessages)
  return (
    <div className="topbar">
      <h1 className="topbartitle">{title}</h1>
      {showSearch && (
        <div className="search">
          <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input placeholder={m.search} value={search ?? ''} onChange={e => onSearchChange?.(e.target.value)} />
          <kbd>/</kbd>
        </div>
      )}
      <span className="lockpill">
        <svg className="icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        {m.nav.unlocked}
      </span>
      {right}
    </div>
  )
}
