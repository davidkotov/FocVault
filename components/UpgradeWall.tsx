'use client'

import { useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

interface Props {
  title: string
  description: string
  onUpgrade: () => void
}

export default function UpgradeWall({ title, description, onUpgrade }: Props) {
  const m = useMessages(appMessages).upgradeWall
  return (
    <div className="card upgradewall">
      <div className="upgradeicon">🔐</div>
      <h3>{title}</h3>
      <p className="dim">{description}</p>
      <p className="dim">{m.body}</p>
      <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
        <button className="primary" onClick={onUpgrade}>
          {m.cta}
        </button>
      </div>
    </div>
  )
}
