'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type ShareSummary } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { shareMessages } from '@/lib/i18n/messages/share'
import { relativeDay } from '@/lib/i18n/relative'
import type { SecretEntry, VaultEntry } from '@/lib/vault'
import { Icon } from '@/components/site/Icons'

type Link = { id: string; url: string; label: string; createdAt: number }

/** Secure Send: alle Links des Kontos – kopieren (Schlüssel aus dem Tresor), Status, Widerrufen. */
export default function SendView({ files, notes = [], links = [], onForget }: { files: VaultEntry[]; notes?: SecretEntry[]; links?: Link[]; onForget?: (id: string) => void }) {
  const t = useMessages(appMessages).send
  const m = useMessages(shareMessages).dialog
  const { fmtDate, locale } = useI18n()
  const [shares, setShares] = useState<ShareSummary[] | null>(null)
  const [filter, setFilter] = useState<'active' | 'all'>('all')
  const [copied, setCopied] = useState<string | null>(null)

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

  const nameOf = (objectId: string) => files.find(f => f.objectId === objectId)?.name ?? notes.flatMap(n => n.attachments ?? []).find(f => f.objectId === objectId)?.name ?? t.deleted
  const labelOf = (s: ShareSummary) => {
    const l = links.find(x => x.id === s.id)
    if (!s.hasPayload) return nameOf(s.objectId ?? s.objectIds[0] ?? '') || l?.label || t.deleted
    const note = notes.find(n => n.shareIds?.includes(s.id))
    return note ? note.title : l?.label ?? t.note
  }
  const all = shares ?? []
  const shown = filter === 'active' ? all.filter(s => s.active) : all
  const activeN = all.filter(s => s.active).length
  const copy = (s: ShareSummary) => {
    const l = links.find(x => x.id === s.id)
    if (!l) return
    void navigator.clipboard?.writeText(l.url).then(() => {
      setCopied(s.id)
      setTimeout(() => setCopied(c => (c === s.id ? null : c)), 1500)
    })
  }

  return (
    <div className="card plansection sendview">
      <div className="plansection-head">
        <span className="dim">{t.body}</span>
        <div className="sm2-seg small" role="group" aria-label={t.filter}>
          <button className={filter === 'active' ? 'active' : ''} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
            {fmt(t.filterActive, { n: activeN })}
          </button>
          <button className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {fmt(t.filterAll, { n: all.length })}
          </button>
        </div>
      </div>
      {shares && shown.length === 0 && <p className="dim" style={{ padding: '14px 18px', margin: 0 }}>{filter === 'active' && all.length ? t.noneActive : t.empty}</p>}
      <div className="sharelist">
        {shown.map(s => {
          const stored = links.some(x => x.id === s.id)
          const extra = s.objectIds.length - (s.hasPayload ? 0 : 1)
          return (
            <div className={`sharerow linkrow${s.active ? '' : ' off'}`} key={s.id}>
              <span className="pwavatar">
                <Icon name={s.hasPayload ? 'note' : 'file'} size={17} />
              </span>
              <div className="invmain">
                <span className="sharename" title={[labelOf(s), ...s.objectIds.map(nameOf)].join(', ')}>
                  <b>{labelOf(s)}</b>
                  {extra > 0 && <span className="dim"> +{extra}</span>}
                </span>
                <span className="dim">
                  {fmt(t.created, { when: relativeDay(new Date(s.createdAt).getTime(), locale) })} · {s.expiresAt ? fmt(m.until, { date: fmtDate(s.expiresAt) }) : m.forever} ·{' '}
                  {s.maxDownloads ? fmt(m.used, { n: s.downloads, max: s.maxDownloads }) : fmt(m.usedUnlimited, { n: s.downloads })}
                </span>
              </div>
              <span className={s.active ? 'strongbadge' : 'pwbadge'}>{s.active ? m.active : m.inactive}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {s.active && (
                  <button className={`small${copied === s.id ? ' done' : ''}`} disabled={!stored} title={stored ? m.copy : t.notStored} onClick={() => copy(s)}>
                    <Icon name={copied === s.id ? 'check' : 'chain'} size={14} /> {copied === s.id ? m.copied : t.copyLink}
                  </button>
                )}
                {s.active ? (
                  <button className="linkish dangerlink" onClick={() => void api.revokeShare(s.id).then(load)}>
                    {m.revoke}
                  </button>
                ) : (
                  stored && onForget && (
                    <button className="linkish" onClick={() => onForget(s.id)}>
                      {t.forget}
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="hint" style={{ padding: '10px 18px 14px', margin: 0 }}>
        {t.keyNote}
      </p>
    </div>
  )
}
