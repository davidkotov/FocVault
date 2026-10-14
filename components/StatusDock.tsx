'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/site/Icons'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { DRAG_MIME, SECRET_MIME, idsFrom } from '@/lib/dnd'
import { formatBytes, type TierName } from '@/lib/vault'

type Panel = 'storage' | 'filecoin' | 'links' | 'trash'

export interface StatusDockProps {
  usedBytes: number
  quotaBytes: number
  tierLabel: string
  tier: TierName
  /** Dateien mit Objekt im Speicher und davon auf Filecoin bestätigte */
  securedCount: number
  objectCount: number
  /** Dateien, deren Sicherung gerade läuft (kürzlich hochgeladen) */
  securingCount: number
  activeLinks: number | null
  trashCount: number
  trashBytes: number
  /** Papierkorb im Paket enthalten */
  trashEnabled: boolean
  /** Paket, das den Papierkorb freischaltet (für den Upgrade-Hinweis) */
  trashPlan: string
  onPlans: () => void
  onLinks: () => void
  onTrash: () => void
  onProofs: () => void
  /** Dateien auf den Papierkorb gezogen */
  onDropFiles?: (ids: string[]) => void
  /** Passwörter, Notizen, 2FA auf den Papierkorb gezogen */
  onDropSecrets?: (ids: string[]) => void
  /** Panel/Menü schliessen (z. B. wenn die Seitenleiste zuklappt) */
  onNavigate?: () => void
}

/** 0–100 %, auch bei fehlender Quota robust */
function pctOf(a: number, b: number): number {
  return b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0
}

/**
 * Status-Block am Fuss der Seitenleiste: vier Symbole, die gleichzeitig Statusanzeige sind
 * (Speicher, Filecoin, aktive Links, Papierkorb). Ein Klick öffnet die Einzelheiten,
 * ein Klick daneben zeigt wieder die Symbole. Der Papierkorb nimmt gezogene Einträge an.
 */
export default function StatusDock(p: StatusDockProps) {
  const t = useMessages(appMessages)
  const m = t.dock
  const [panel, setPanel] = useState<Panel | null>(null)
  const [over, setOver] = useState(false)
  const [hint, setHint] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panel) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanel(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(timer)
  }, [hint])

  const storagePct = pctOf(p.usedBytes, p.quotaBytes)
  const trashPct = p.trashEnabled ? pctOf(p.trashBytes, p.quotaBytes) : 0
  const links = p.activeLinks ?? 0
  // blau = alles gesichert, weiss = Sicherung läuft, grau = offen
  const focState = !p.objectCount ? 'idle' : p.securedCount >= p.objectCount ? 'ok' : p.securingCount > 0 ? 'busy' : 'idle'

  const go = (fn: () => void) => () => {
    setPanel(null)
    p.onNavigate?.()
    fn()
  }

  const dropOnTrash = {
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types
      if (!types.includes(DRAG_MIME) && !types.includes(SECRET_MIME)) return
      if (!p.trashEnabled) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!over) setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      document.body.classList.remove('fv-dragging')
      const files = idsFrom(e.dataTransfer, DRAG_MIME)
      if (files.length) return p.onDropFiles?.(files)
      const secrets = idsFrom(e.dataTransfer, SECRET_MIME)
      if (secrets.length) p.onDropSecrets?.(secrets)
    }
  }

  return (
    <div className={`dock${panel ? ' open' : ''}`} ref={ref}>
      {panel === null && (
        <div className="dockicons" role="group" aria-label={t.nav.storage}>
          <button
            type="button"
            className="dockicon"
            data-tip={fmt(m.storageTip, { used: formatBytes(p.usedBytes), quota: formatBytes(p.quotaBytes) })}
            aria-label={fmt(m.storageTip, { used: formatBytes(p.usedBytes), quota: formatBytes(p.quotaBytes) })}
            onClick={() => setPanel('storage')}
          >
            {storagePct > 0 && <span className="dockfill" style={{ width: `${Math.max(6, storagePct)}%` }} aria-hidden="true" />}
            <Icon name="cloud" size={18} />
          </button>
          <button
            type="button"
            className={`dockicon foc ${focState}`}
            data-tip={fmt(m.securedTip, { n: p.securedCount, total: p.objectCount })}
            aria-label={fmt(m.securedTip, { n: p.securedCount, total: p.objectCount })}
            onClick={() => setPanel('filecoin')}
          >
            <Icon name="check" size={18} />
          </button>
          <button
            type="button"
            className={`dockicon links ${links > 0 ? 'on' : 'off'}`}
            data-tip={fmt(m.linksTip, { n: links })}
            aria-label={fmt(m.linksTip, { n: links })}
            onClick={() => setPanel('links')}
          >
            <Icon name="send" size={17} />
          </button>
          <button
            type="button"
            className={`dockicon trash${p.trashEnabled ? '' : ' off'}${over ? ' over' : ''}`}
            data-tip={p.trashEnabled ? fmt(m.trashTip, { n: p.trashCount }) : m.trashLockedTip}
            aria-label={p.trashEnabled ? fmt(m.trashTip, { n: p.trashCount }) : m.trashLockedTip}
            onClick={() => (p.trashEnabled ? setPanel('trash') : setHint(true))}
            {...dropOnTrash}
          >
            {trashPct > 0 && <span className="dockfill vert" style={{ height: `${Math.max(8, trashPct)}%` }} aria-hidden="true" />}
            <Icon name="trash" size={17} />
          </button>
          {over && <span className="dockdrop">{m.dropToTrash}</span>}
        </div>
      )}

      {panel === 'storage' && (
        <div className="dockpanel">
          <div className="lbl">
            <span>{t.nav.storage}</span>
            <span>
              {formatBytes(p.usedBytes)} / {formatBytes(p.quotaBytes)}
            </span>
          </div>
          <div className="quotabar">
            <div className={storagePct >= 100 ? 'full' : ''} style={{ width: `${storagePct}%` }} />
          </div>
          <div className="lbl foot">
            <span>{p.tier === 'FREE' ? 'Free' : fmt(t.nav.active, { plan: p.tierLabel })}</span>
            <button className="linkish quotalink" onClick={go(p.onPlans)}>
              {p.tier === 'FREE' ? t.nav.upgrade : t.nav.manage}
            </button>
          </div>
        </div>
      )}

      {panel === 'filecoin' && (
        <div className="dockpanel">
          <div className="lbl">
            <span>{t.kpi.filecoin}</span>
            <span>
              {p.securedCount} / {p.objectCount}
            </span>
          </div>
          <div className="quotabar">
            <div style={{ width: `${pctOf(p.securedCount, p.objectCount)}%` }} />
          </div>
          <div className="lbl foot">
            <span>
              {p.securedCount >= p.objectCount
                ? t.kpi.allSecured
                : p.securingCount > 0
                  ? fmt(t.kpi.securing, { n: p.securingCount })
                  : fmt(t.kpi.pendingLong, { n: p.objectCount - p.securedCount })}
            </span>
            <button className="linkish quotalink" onClick={go(p.onProofs)}>
              {m.proofs}
            </button>
          </div>
        </div>
      )}

      {panel === 'links' && (
        <div className="dockpanel">
          <div className="lbl">
            <span>{t.kpi.links}</span>
            <span>{p.activeLinks ?? '–'}</span>
          </div>
          <div className="lbl foot">
            <span>{links > 0 ? t.kpi.linksSub : m.noLinks}</span>
            <button className="linkish quotalink" onClick={go(p.onLinks)}>
              {t.nav.send}
            </button>
          </div>
        </div>
      )}

      {panel === 'trash' && (
        <div className="dockpanel">
          <div className="lbl">
            <span>{t.kpi.trash}</span>
            <span>{fmt(m.filesCount, { n: p.trashCount })}</span>
          </div>
          <div className="lbl foot">
            <span>{formatBytes(p.trashBytes)}</span>
            {p.trashEnabled && (
              <button className="linkish quotalink" onClick={go(p.onTrash)}>
                {m.openTrash}
              </button>
            )}
          </div>
        </div>
      )}

      {hint && (
        <button type="button" className="dockhint" onClick={go(p.onPlans)}>
          {fmt(m.upgrade, { plan: p.trashPlan })}
        </button>
      )}
    </div>
  )
}
