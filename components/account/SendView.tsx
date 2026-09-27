'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type ShareSummary } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { shareMessages } from '@/lib/i18n/messages/share'
import type { VaultEntry } from '@/lib/vault'

/** Übersicht aller Secure-Send-Links des Kontos mit Widerrufen. */
export default function SendView({ files }: { files: VaultEntry[] }) {
  const t = useMessages(appMessages).send
  const m = useMessages(shareMessages).dialog
  const { fmtDate } = useI18n()
  const [shares, setShares] = useState<ShareSummary[] | null>(null)

  const load = useCallback(async () => {
    try {
      setShares((await api.listShares()).shares)
    } catch {
      setShares([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nameOf = (objectId: string) => files.find(f => f.objectId === objectId)?.name ?? t.deleted

  return (
    <div className="card">
      <h3>
        {t.title} <span>{t.badge}</span>
      </h3>
      <p className="dim">{t.body}</p>
      <div className="navsection" style={{ padding: '16px 0 6px' }}>
        {t.notice}
      </div>
      {shares?.length === 0 && <span className="hint">{t.empty}</span>}
      <div className="sharelist">
        {shares?.map(s => (
          <div className="sharerow" key={s.id}>
            <span className={`badge${s.active ? ' ok' : ''}`}>{s.active ? m.active : m.inactive}</span>
            <span className="sharename" title={s.objectIds.map(nameOf).join(', ')}>
              {nameOf(s.objectId)}
              {s.objectIds.length > 1 && <span className="dim"> +{s.objectIds.length - 1}</span>}
            </span>
            <span className="hint">
              {s.expiresAt ? fmt(m.until, { date: fmtDate(s.expiresAt) }) : m.forever} ·{' '}
              {s.maxDownloads ? fmt(m.used, { n: s.downloads, max: s.maxDownloads }) : fmt(m.usedUnlimited, { n: s.downloads })}
            </span>
            {s.active && (
              <button className="small" onClick={() => void api.revokeShare(s.id).then(load)}>
                {m.revoke}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
