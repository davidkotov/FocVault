'use client'

import { useState } from 'react'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type TierName } from '@/lib/vault'

export type ViewId = 'cloud' | 'send' | 'trash' | 'plans' | 'account' | 'passwords' | 'notes' | '2fa' | 'passkeys' | 'familyFolder' | 'storageApi' | 'sharedVaults'

interface Props {
  view: ViewId
  onNavigate: (v: ViewId) => void
  usedBytes: number
  quotaBytes: number
  tierLabel: string
  tier: TierName
  /** Menüpunkt „Pakete & Speicher" (Konto-Modus) */
  showPlans?: boolean
  /** Pro-Module freigeschaltet (sonst Schloss + Hinweis) */
  pro?: boolean
  /** Familienordner anzeigen (Family-Mitglieder und -Inhaber) */
  family?: boolean
  /** Speicher-API: freigeschaltet (Business) – sonst Schloss */
  storageApi?: boolean
  storageApiLabel?: string
  apiSection?: string
  apiLockTip?: string
  /** Geteilte Tresore (Business) */
  sharedVaultsLabel?: string
}

const ICONS: Record<ViewId, JSX.Element> = {
  cloud: <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />,
  send: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  plans: (
    <>
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  account: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  passwords: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  notes: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  '2fa': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  sharedVaults: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V7M12 17v-2M15 12h2M7 12h2" />
    </>
  ),
  storageApi: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  familyFolder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="10" cy="13" r="1.6" />
      <circle cx="15" cy="13" r="1.6" />
    </>
  ),
  passkeys: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
    </>
  )
}

/** Seitenleiste; auf dem Handy als ausklappbares Menü (Burger-Button in der Topbar-Zeile). */
export default function Sidebar({ view, onNavigate, usedBytes, quotaBytes, tierLabel, tier, showPlans = false, pro = true, storageApi = false, storageApiLabel = 'Speicher-API', apiSection = 'API-Module', apiLockTip = 'Upgrade nötig – ab Business Starter', sharedVaultsLabel = 'Geteilte Tresore' }: Props) {
  const m = useMessages(appMessages).nav
  const [open, setOpen] = useState(false)
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0
  const go = (v: ViewId) => {
    onNavigate(v)
    setOpen(false)
  }
  const Lock = ({ tip = m.proOnly }: { tip?: string }) => (
    <span className="navlock" data-tip={tip} aria-label={tip}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  )
  const Item = ({ id, label, locked, tip }: { id: ViewId; label: string; locked?: boolean; tip?: string }) => (
    <button className={`navitem ${view === id ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => go(id)}>
      <svg className="icon" viewBox="0 0 24 24">
        {ICONS[id]}
      </svg>
      {label}
      {locked && <Lock tip={tip} />}
    </button>
  )

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebarbrand">
        <svg className="mark" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="20" fill="#0090ff" />
          <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
          <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
        </svg>
        Foc<span style={{ color: 'var(--accent)' }}>Vault</span>
        <button className="navtoggle" aria-label={m.menu} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <svg viewBox="0 0 24 24" width="22" height="22">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <nav className="navlist">
        <Item id="cloud" label={m.cloud} />
        {showPlans && <Item id="plans" label={m.plans} />}
        <Item id="account" label={m.account} />

        <div className="navsection">{m.more}</div>
        <Item id="passwords" label={m.passwords} locked={!pro} />
        <Item id="notes" label={m.notes} locked={!pro} />
        <Item id="2fa" label={m.totp} locked={!pro} />
        <Item id="sharedVaults" label={sharedVaultsLabel} locked={!storageApi} tip={apiLockTip} />

        <div className="navsection">{apiSection}</div>
        <Item id="storageApi" label={storageApiLabel} locked={!storageApi} tip={apiLockTip} />

        <div className="spacer" />

        <div className="quotawidget">
          <div className="lbl">
            <span>{m.storage}</span>
            <span>
              {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
            </span>
          </div>
          <div className="quotabar">
            <div className={pct >= 100 ? 'full' : ''} style={{ width: `${pct}%` }} />
          </div>
          {tier === 'FREE' ? (
            <button className="primary small" style={{ width: '100%' }} onClick={() => go(showPlans ? 'plans' : 'account')}>
              {m.upgrade}
            </button>
          ) : (
            <span className="badge pro">{fmt(m.active, { plan: tierLabel })}</span>
          )}
        </div>
      </nav>
    </aside>
  )
}
