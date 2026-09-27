'use client'

import { useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import FileList from '@/components/FileList'
import AccountUpload from '@/components/account/AccountUpload'
import PreviewModal from '@/components/account/PreviewModal'
import ShareDialog from '@/components/account/ShareDialog'
import { Working } from '@/components/account/AuthShell'
import { useAccount } from '@/features/account/AccountProvider'
import { ApiClientError, api } from '@/features/api/client'
import { useFamilySpace } from '@/features/family/useFamilySpace'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { downloadFile } from '@/features/objects/transfer'
import { appMessages } from '@/lib/i18n/messages/app'
import type { VaultEntry } from '@/lib/vault'

/** Familienordner: gemeinsame Dateien aller Mitglieder, verschlüsselt mit dem Ordner-Schlüssel. */
export default function FamilyFolderView({ freeBytes }: { freeBytes: number }) {
  const t = useMessages(appMessages)
  const m = t.familyFolder
  const errText = useErrorText()
  const { account, refreshAccount } = useAccount()
  const space = useFamilySpace(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<VaultEntry | null>(null)
  const [sharing, setSharing] = useState<VaultEntry | null>(null)
  const [confirm, setConfirm] = useState<VaultEntry | null>(null)

  if (!account) return null
  const members = space.state?.members ?? []
  const withAccess = members.filter(p => p.generations.includes(space.state?.generation ?? 0)).length

  const head = (
    <div className="card">
      <h3>
        {m.title}
        {space.state && <span>{fmt(m.members, { ready: withAccess, total: members.length })}</span>}
      </h3>
      <p className="dim">{m.lead}</p>
      {members.some(p => !p.generations.includes(space.state?.generation ?? 0)) && (
        <p className="hint">
          {members
            .filter(p => !p.generations.includes(space.state?.generation ?? 0))
            .map(p => `${p.label} (${m.pending})`)
            .join(' · ')}
        </p>
      )}
    </div>
  )

  if (space.status === 'loading') return (<>{head}<div className="card"><Working label={m.loading} /></div></>)
  if (space.status === 'waiting' || space.status === 'error')
    return (
      <>
        {head}
        <div className="card">
          {space.status === 'error' ? <div className="errorbox">{space.error}</div> : <p>{m.waiting}</p>}
          <button className="small" onClick={() => void space.reload()}>
            {m.retry}
          </button>
        </div>
      </>
    )

  const key = space.currentKey()!
  const keyOf = (e: VaultEntry) => space.keyFor(e.spaceGen)

  return (
    <>
      {head}
      {error && <div className="errorbox" onClick={() => setError(null)}>{error}</div>}
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      <AccountUpload
        masterKey={key}
        space
        freeBytes={freeBytes}
        onError={msg => setError(msg)}
        onStored={entry => {
          const e: VaultEntry = { ...entry, spaceGen: space.generation(), addedBy: account.label }
          void space
            .update(files => [e, ...files.filter(f => f.id !== e.id)])
            .then(() => refreshAccount())
            .catch(err => setError(errText(err)))
        }}
      />
      <FileList
        entries={space.files}
        busyId={busyId}
        canDecrypt
        onDownload={e => {
          const k = keyOf(e)
          if (!k) return
          setBusyId(e.id)
          void downloadFile(e, k)
            .catch(err => setError(errText(err)))
            .finally(() => setBusyId(null))
        }}
        onDelete={id => setConfirm(space.files.find(f => f.id === id) ?? null)}
        onShare={e => (e.addedBy === account.label ? setSharing(e) : setNotice(m.shareOwnOnly))}
        onPreview={e => setPreview(e)}
        deleteNote={m.deleteNote}
      />
      {preview && keyOf(preview) && (
        <PreviewModal entry={preview} masterKey={keyOf(preview)!} onClose={() => setPreview(null)} onDownload={e => void downloadFile(e, keyOf(e)!)} />
      )}
      {sharing && keyOf(sharing) && <ShareDialog entry={sharing} masterKey={keyOf(sharing)!} onClose={() => setSharing(null)} />}
      {confirm && (
        <ConfirmDialog
          title={fmt(m.confirmDelete, { name: confirm.name })}
          body={m.confirmDeleteBody}
          confirmLabel={t.confirm.delete}
          cancelLabel={t.confirm.cancel}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const e = confirm
            setConfirm(null)
            setBusyId(e.id)
            try {
              if (e.objectId) {
                try {
                  await api.deleteObject(e.objectId)
                } catch (err) {
                  if (!(err instanceof ApiClientError && err.code === 'NOT_FOUND')) throw err
                }
              }
              await space.update(files => files.filter(f => f.id !== e.id))
              await refreshAccount()
            } catch (err) {
              setError(errText(err))
            } finally {
              setBusyId(null)
            }
          }}
        />
      )}
    </>
  )
}
