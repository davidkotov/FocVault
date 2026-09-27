'use client'

import { useEffect, useState } from 'react'
import NotesPanel from '@/components/NotesPanel'
import PasswordsPanel from '@/components/PasswordsPanel'
import TotpPanel from '@/components/TotpPanel'
import type { GrantorVault } from '@/features/emergency/client'
import { useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { downloadFile } from '@/features/objects/transfer'
import { emergencyMessages } from '@/lib/i18n/messages/emergency'
import { formatBytes } from '@/lib/vault'
import type { DownloadResult } from '@/lib/api-types'

type Tab = 'files' | 'passwords' | 'notes' | 'totp'
const noop = () => undefined

/** Fremden Tresor nur lesen – Notfallzugang oder Firmen-Notfallzugriff. */
export default function ReadOnlyVaultView({
  title,
  lead,
  load,
  fetchPieces,
  onBack
}: {
  title: string
  lead: string
  load: () => Promise<GrantorVault>
  fetchPieces: (objectId: string) => Promise<DownloadResult>
  onBack: () => void
}) {
  const m = useMessages(emergencyMessages)
  const errText = useErrorText()
  const [data, setData] = useState<GrantorVault | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('files')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await load()
        if (!cancelled) setData(v)
      } catch (e) {
        if (!cancelled) setError(errText(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const secrets = data?.container.secrets ?? []
  const files = data?.container.files ?? []
  const count: Record<Tab, number> = {
    files: files.length,
    passwords: secrets.filter(s => s.kind === 'password').length,
    notes: secrets.filter(s => s.kind === 'note').length,
    totp: secrets.filter(s => s.kind === 'totp').length
  }

  return (
    <>
      <div className="card">
        <div className="vaulthead">
          <button className="small" onClick={onBack}>
            {m.back}
          </button>
        </div>
        <h3>{title}</h3>
        <p className="dim">{lead}</p>
        {error && <div className="errorbox">{error}</div>}
        {!data && !error && <p className="dim">{m.opening}</p>}
        {data && (
          <div className="tabs" role="tablist">
            {(Object.keys(m.tabs) as Tab[]).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {m.tabs[t]} <span className="dim">{count[t]}</span>
              </button>
            ))}
          </div>
        )}
        {data && tab === 'files' && (
          <div className="sharelist">
            {files.length === 0 && <p className="hint">{m.noFiles}</p>}
            {files.map(f => (
              <div className="sharerow" key={f.id}>
                <span className="sharename">{f.name}</span>
                <span className="hint">{formatBytes(f.size)}</span>
                <button
                  className="small"
                  disabled={!!busy || !f.objectId}
                  onClick={async () => {
                    setBusy(f.id)
                    setError(null)
                    try {
                      await downloadFile(f, data.masterKey, { fetchPieces: () => fetchPieces(f.objectId!) })
                    } catch (e) {
                      setError(errText(e))
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  {busy === f.id ? '…' : m.download}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {data && tab === 'passwords' && <PasswordsPanel heading={m.tabs.passwords} entries={secrets.filter(s => s.kind === 'password')} readOnly onSave={noop} onSaveMany={noop} onDelete={noop} />}
      {data && tab === 'notes' && <NotesPanel heading={m.tabs.notes} entries={secrets.filter(s => s.kind === 'note')} readOnly onSave={noop} onDelete={noop} />}
      {data && tab === 'totp' && <TotpPanel heading={m.tabs.totp} entries={secrets.filter(s => s.kind === 'totp')} readOnly onSave={noop} onDelete={noop} />}
    </>
  )
}
