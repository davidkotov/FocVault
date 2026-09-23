'use client'

interface Props {
  title: string
  description: string
  onUpgrade: () => void
}

export default function UpgradeWall({ title, description, onUpgrade }: Props) {
  return (
    <div className="card upgradewall">
      <div className="upgradeicon">🔐</div>
      <h3>{title}</h3>
      <p className="dim">{description}</p>
      <p className="dim">
        Alle Privacy-Module sind Teil des <b>Pro</b>- oder <b>Family</b>-Abos: einmalig
        aktivieren, dauerhaft nutzen — solange die Subscription läuft.
      </p>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={onUpgrade}>
          Pro aktivieren
        </button>
      </div>
    </div>
  )
}