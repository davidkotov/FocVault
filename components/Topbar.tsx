'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/site/Icons'

export interface SearchHit {
  id: string
  icon: 'file' | 'key' | 'note' | 'otp'
  title: string
  sub: string
  onSelect: () => void
}
import { useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

interface Props {
  title: string
  search?: string
  onSearchChange?: (v: string) => void
  showSearch?: boolean
  /** Rechter Bereich (Kontomenü). */
  right?: ReactNode
  /** Treffer aus Passwörtern, Notizen usw. (Dropdown unter dem Suchfeld) */
  hits?: SearchHit[]
}

export default function Topbar({ title, search, onSearchChange, showSearch = true, right, hits = [] }: Props) {
  const m = useMessages(appMessages)
  const ref = useRef<HTMLInputElement>(null)
  const [focus, setFocus] = useState(false)
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [search])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.metaKey && !e.ctrlKey && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)))) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="topbar">
      <h1 className="topbartitle">{title}</h1>
      {showSearch && (
        <div className="search">
          <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={ref}
            placeholder={m.search}
            value={search ?? ''}
            aria-label={m.search}
            onChange={e => onSearchChange?.(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={e => {
              if (!hits.length) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx(i => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx(i => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                hits[idx]?.onSelect()
                ref.current?.blur()
              } else if (e.key === 'Escape') ref.current?.blur()
            }}
          />
          <kbd>⌘K</kbd>
          {focus && !!search?.trim() && hits.length > 0 && (
            <div className="searchhits" role="listbox">
              {hits.slice(0, 8).map((h, i) => (
                <button
                  key={h.id}
                  role="option"
                  aria-selected={i === idx}
                  className={i === idx ? 'active' : ''}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    h.onSelect()
                    ref.current?.blur()
                  }}
                >
                  <Icon name={h.icon} size={16} />
                  <span className="sh-title">{h.title}</span>
                  <span className="sh-sub">{h.sub}</span>
                </button>
              ))}
            </div>
          )}
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
