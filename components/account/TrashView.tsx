'use client'

import { useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type TrashEntry } from '@/lib/vault'

interface Props {
  entries: TrashEntry[]
  /** objectId → Löschzeitpunkt laut Server */
  purgeAt: Record<string, string>
  paid: boolean
  days: number
  busyId: string | null
  onRestore: (e: TrashEntry) => void
  onDeleteForever: (e: TrashEntry) => void
  onEmpty: () => Promise<void>
  onUpgrade: () => void
  onBack: () => void
}

const DAY = 86_400_000

export default function TrashView({ entries, purgeAt, paid, days, busyId, onRestore, onDeleteForever, onEmpty, onUpgrade, onBack }: Props) {
  const t = useMessages(appMessages)
  const m = t.trash
  const { fmtDate } = useI18n()
  const [confirm, setConfirm] = useState<null | { kind: 'one'; entry: TrashEntry } | { kind: 'all' }>(null)
  const [busy, setBusy] = useState(false)
  const total = entries.reduce((n, e) => n + e.size, 0)

  if (!paid && entries.length === 0) {
    return (
      <div className="card trashupsell">
        <h3>{m.freeTitle}</h3>
        <p className="dim">{fmt(m.freeBody, { days })}</p>
        <button className="primary" onClick={onUpgrade}>
          {m.upgrade}
        </button>
      </div>
    )
  }

  const left = (e: TrashEntry) => {
    const at = e.objectId ? purgeAt[e.objectId] : undefined
    const until = at ? new Date(at).getTime() : e.trashedAt + days * DAY
    const n = Math.floor((until - Date.now()) / DAY)
    return n < 1 ? m.lastDay : fmt(m.daysLeft, { n })
  }

  return (
    <div className="card">
      <button className="small backbtn" onClick={onBack}>
        ← {m.back}
      </button>
      <h3>
        {m.title} <span>{fmt(m.usage, { n: entries.length, size: formatBytes(total) })}</span>
      </h3>
      <p className="dim">{fmt(m.lead, { days })}</p>
      {entries.length === 0 ? (
        <p className="dim" style={{ marginTop: 16 }}>
          {m.empty}
        </p>
      ) : (
        <>
          <div className="trashlist">
            {entries.map(e => (
              <div className="trashrow" key={e.id}>
                <div className="trashinfo">
                  <strong title={e.name}>{e.name}</strong>
                  <span className="hint">
                    {formatBytes(e.size)} · {fmt(m.deletedOn, { date: fmtDate(e.trashedAt) })} · <b>{left(e)}</b>
                  </span>
                </div>
                <div className="row">
                  <button className="small" disabled={busyId === e.id} onClick={() => onRestore(e)}>
                    {m.restore}
                  </button>
                  <button className="small danger" disabled={busyId === e.id} onClick={() => setConfirm({ kind: 'one', entry: e })}>
                    {m.deleteForever}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="danger small" onClick={() => setConfirm({ kind: 'all' })}>
              {m.emptyAll}
            </button>
          </div>
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'all' ? m.confirmEmpty : fmt(t.files.confirmDelete, { name: confirm.entry.name })}
          body={confirm.kind === 'all' ? fmt(m.confirmEmptyBody, { n: entries.length, size: formatBytes(total) }) : t.files.confirmDeleteBody}
          confirmLabel={t.confirm.delete}
          cancelLabel={t.confirm.cancel}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm.kind === 'one') {
              onDeleteForever(confirm.entry)
              setConfirm(null)
              return
            }
            setBusy(true)
            try {
              await onEmpty()
            } finally {
              setBusy(false)
              setConfirm(null)
            }
          }}
        />
      )}
    </div>
  )
}
