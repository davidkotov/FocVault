'use client'

import { formatBytes } from '@/lib/vault'

export type ViewId = 'cloud' | 'send' | 'account'

interface Props {
  view: ViewId
  onNavigate: (v: ViewId) => void
  usedBytes: number
  quotaBytes: number
  tierLabel: string
}

export default function Sidebar({ view, onNavigate, usedBytes, quotaBytes, tierLabel }: Props) {
  const pct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100))

  return (
    <aside className="sidebar">
      <div className="sidebarbrand">
        <svg className="mark" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="20" fill="#0090ff" />
          <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
          <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
        </svg>
        Foc<span style={{ color: 'var(--accent)' }}>Vault</span>
      </div>

      <button className={`navitem ${view === 'cloud' ? 'active' : ''}`} onClick={() => onNavigate('cloud')}>
        <svg className="icon" viewBox="0 0 24 24">
          <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
        </svg>
        Meine Cloud
      </button>
      <button className={`navitem ${view === 'send' ? 'active' : ''}`} onClick={() => onNavigate('send')}>
        <svg className="icon" viewBox="0 0 24 24">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
        </svg>
        Secure Send
      </button>
      <button className={`navitem ${view === 'account' ? 'active' : ''}`} onClick={() => onNavigate('account')}>
        <svg className="icon" viewBox="0 0 24 24">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
        </svg>
        Konto &amp; Zahlungen
      </button>

      <div className="navsection">Weitere Module</div>
      <div className="navitem disabled">
        <svg className="icon" viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        Passwörter <span className="badge-soon">Bald</span>
      </div>
      <div className="navitem disabled">
        <svg className="icon" viewBox="0 0 24 24">
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <rect x="3" y="11" width="18" height="10" rx="2" />
        </svg>
        Passkeys <span className="badge-soon">Bald</span>
      </div>
      <div className="navitem disabled">
        <svg className="icon" viewBox="0 0 24 24">
          <path d="M4 4h16v16H4z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
        Notizen <span className="badge-soon">Bald</span>
      </div>

      <div className="spacer" />

      <div className="quotawidget">
        <div className="lbl">
          <span>Speicher</span>
          <span>
            {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
          </span>
        </div>
        <div className="quotabar">
          <div className={pct >= 100 ? 'full' : ''} style={{ width: `${pct}%` }} />
        </div>
        {tierLabel !== 'Pro' && (
          <button className="primary small" style={{ width: '100%' }} onClick={() => onNavigate('account')}>
            Auf Pro upgraden
          </button>
        )}
        {tierLabel === 'Pro' && <span className="badge pro">Pro aktiv</span>}
      </div>
    </aside>
  )
}
