'use client'

import { Icon } from '@/components/site/Icons'
import { useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'

interface Props {
  title: string
  description: string
  onUpgrade: () => void
  /** eigener Text/Button (z. B. Business statt Pro) */
  body?: string
  cta?: string
}

export default function UpgradeWall({ title, description, onUpgrade, body, cta }: Props) {
  const m = useMessages(appMessages).upgradeWall
  return (
    <div className="card upgradewall">
      <div className="upgradeicon">
        <Icon name="lock" size={30} />
      </div>
      <h3>{title}</h3>
      <p className="dim">{description}</p>
      <p className="dim">{body ?? m.body}</p>
      <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
        <button className="primary" onClick={onUpgrade}>
          {cta ?? m.cta}
        </button>
      </div>
    </div>
  )
}
