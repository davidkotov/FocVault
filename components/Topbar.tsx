'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/site/Icons'
import { ThemeToggle } from '@/features/theme/ThemeToggle'

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
  /** Suche als Modal (schmale Bildschirme – Knopf steht neben dem Burger-Menü) */
  searchOpen?: boolean
  onSearchOpen?: (open: boolean) => void
}

/** Tastaturnavigation für die Trefferliste – geteilt von Suchfeld und Such-Modal. */
function useHitKeys(hits: SearchHit[], search: string | undefined, close: () => void) {
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [search])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close()
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
      close()
    }
  }
  return { idx, setIdx, onKeyDown }
}

function Hits({ hits, idx, onPick }: { hits: SearchHit[]; idx: number; onPick: (h: SearchHit) => void }) {
  return (
    <>
      {hits.slice(0, 8).map((h, i) => (
        <button
          key={h.id}
          role="option"
          aria-selected={i === idx}
          className={i === idx ? 'active' : ''}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(h)}
        >
          <Icon name={h.icon} size={16} />
          <span className="sh-title">{h.title}</span>
          <span className="sh-sub">{h.sub}</span>
        </button>
      ))}
    </>
  )
}

/** Suche als Vollbild-Dialog – auf schmalen Bildschirmen statt der Leiste in der Kopfzeile. */
function SearchModal({ search, onSearchChange, hits, onClose }: { search?: string; onSearchChange?: (v: string) => void; hits: SearchHit[]; onClose: () => void }) {
  const m = useMessages(appMessages)
  const ref = useRef<HTMLInputElement>(null)
  const { idx, onKeyDown } = useHitKeys(hits, search, onClose)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Die Kopfzeile ist ein eigener Stapelkontext – der Dialog gehört deshalb an <body>
  return createPortal(
    <div className="searchmodal-backdrop" role="dialog" aria-modal="true" aria-label={m.search} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="searchmodal">
        <div className="searchmodal-field">
          <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={ref}
            placeholder={m.search}
            aria-label={m.search}
            value={search ?? ''}
            onChange={e => onSearchChange?.(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="modalclose" aria-label={m.proofs.close} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {!!search?.trim() && (
          <div className="searchmodal-hits" role="listbox">
            {hits.length > 0 ? (
              <Hits
                hits={hits}
                idx={idx}
                onPick={h => {
                  h.onSelect()
                  onClose()
                }}
              />
            ) : (
              <p className="dim">{m.files.noMatch}</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default function Topbar({ title, search, onSearchChange, showSearch = true, right, hits = [], searchOpen = false, onSearchOpen }: Props) {
  const m = useMessages(appMessages)
  const ref = useRef<HTMLInputElement>(null)
  const [focus, setFocus] = useState(false)
  const { idx, onKeyDown } = useHitKeys(hits, search, () => ref.current?.blur())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.metaKey && !e.ctrlKey && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)))) {
        e.preventDefault()
        // schmale Bildschirme haben kein Suchfeld in der Kopfzeile – dort öffnet der Dialog
        if (window.matchMedia('(max-width: 842px)').matches) onSearchOpen?.(true)
        else ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearchOpen])
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
            onKeyDown={onKeyDown}
          />
          <kbd>⌘K</kbd>
          {focus && !!search?.trim() && hits.length > 0 && (
            <div className="searchhits" role="listbox">
              <Hits
                hits={hits}
                idx={idx}
                onPick={h => {
                  h.onSelect()
                  ref.current?.blur()
                }}
              />
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
      <ThemeToggle />
      {right}
      {showSearch && searchOpen && <SearchModal search={search} onSearchChange={onSearchChange} hits={hits} onClose={() => onSearchOpen?.(false)} />}
    </div>
  )
}
