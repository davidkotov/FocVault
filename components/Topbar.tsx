'use client'

import WalletBar from '@/components/WalletBar'

interface Props {
  title: string
  search?: string
  onSearchChange?: (v: string) => void
  showSearch?: boolean
}

export default function Topbar({ title, search, onSearchChange, showSearch }: Props) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {showSearch && (
        <div className="search">
          <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Dateien durchsuchen…"
            value={search ?? ''}
            onChange={e => onSearchChange?.(e.target.value)}
          />
        </div>
      )}
      <WalletBar />
    </div>
  )
}
