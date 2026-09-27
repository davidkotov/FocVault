'use client'

import type { ReactNode } from 'react'
import WalletBar from '@/components/WalletBar'
import { useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

interface Props {
  title: string
  search?: string
  onSearchChange?: (v: string) => void
  showSearch?: boolean
  /** Rechter Bereich; Standard ist die Wallet-Leiste (Wallet-Modus). */
  right?: ReactNode
}

export default function Topbar({ title, search, onSearchChange, showSearch, right }: Props) {
  const m = useMessages(appMessages)
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {showSearch && (
        <div className="search">
          <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input placeholder={m.search} value={search ?? ''} onChange={e => onSearchChange?.(e.target.value)} />
        </div>
      )}
      {right ?? <WalletBar />}
    </div>
  )
}
