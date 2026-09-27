'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar, { type ViewId } from '@/components/Sidebar'
import Topbar from '@/components/Topbar'
import FileList from '@/components/FileList'
import UpgradeWall from '@/components/UpgradeWall'
import PasswordsPanel from '@/components/PasswordsPanel'
import NotesPanel from '@/components/NotesPanel'
import TotpPanel from '@/components/TotpPanel'
import AuthShell, { Working } from '@/components/account/AuthShell'
import AccountMenu from '@/components/account/AccountMenu'
import AccountUpload from '@/components/account/AccountUpload'
import PlansView from '@/components/account/PlansView'
import ShareDialog from '@/components/account/ShareDialog'
import SendView from '@/components/account/SendView'
import TrashView from '@/components/account/TrashView'
import ConfirmDialog from '@/components/ConfirmDialog'
import PreviewModal from '@/components/account/PreviewModal'
import VersionsDialog from '@/components/account/VersionsDialog'
import FamilyPanel from '@/components/account/FamilyPanel'
import ProofDialog from '@/components/account/ProofDialog'
import PasskeysPanel from '@/components/account/PasskeysPanel'
import FamilyFolderView from '@/components/account/FamilyFolderView'
import StorageApiView from '@/components/account/StorageApiView'
import { storageApiMessages } from '@/lib/i18n/messages/storage-api'
import { passkeySupported } from '@/features/keys/passkey'
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import { useAccount } from '@/features/account/AccountProvider'
import { ApiClientError, api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { buildPassphraseChange, deriveFromPassphrase, unwrapMasterKeyRaw } from '@/features/keys/kdf'
import { downloadFile } from '@/features/objects/transfer'
import { appMessages } from '@/lib/i18n/messages/app'
import { formatBytes, type FileVersion, type SecretEntry, type TierName, type TrashEntry, type VaultEntry } from '@/lib/vault'

const TIER: Record<string, TierName> = { free: 'FREE', pro: 'PRO', family: 'FAMILY', business: 'BUSINESS' }
const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', family: 'Family', business: 'Business' }

function UnlockScreen() {
  const { account, unlock, unlockWithPasskey, logout } = useAccount()
  const pk = useMessages(appMessages).passkeys
  const [pkBusy, setPkBusy] = useState(false)
  const canPasskey = !!account?.passkeys.length && passkeySupported()
  const { path } = useI18n()
  const m = useMessages(appMessages).unlock
  const errText = useErrorText()
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <AuthShell>
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (!pass || busy) return
          setBusy(true)
          setError(null)
          try {
            await unlock(pass)
          } catch (err) {
            setError(errText(err))
            setBusy(false)
          }
        }}
      >
        <h2>{m.title}</h2>
        <p className="lead">{fmt(m.lead, { name: account?.label ?? '' })}</p>
        {error && <div className="errorbox">{error}</div>}
        {canPasskey && (
          <>
            <button
              type="button"
              className="primary full passkeybtn"
              disabled={pkBusy || busy}
              onClick={async () => {
                setPkBusy(true)
                setError(null)
                try {
                  await unlockWithPasskey()
                } catch (err) {
                  setError(errText(err))
                  setPkBusy(false)
                }
              }}
            >
              🔑 {pkBusy ? pk.unlocking : pk.unlock}
            </button>
            <div className="ordivider">{pk.or}</div>
          </>
        )}
        <div className="field">
          <label htmlFor="unlock">{m.passphrase}</label>
          <input id="unlock" type="password" autoFocus={!canPasskey} autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        {busy ? (
          <Working label={m.working} />
        ) : (
          <button className={canPasskey ? 'full' : 'primary full'} type="submit" disabled={!pass}>
            {m.submit}
          </button>
        )}
        <div className="authlinks">
          <Link href={path('/wiederherstellen')}>{m.forgot}</Link>
          <a
            href="#"
            onClick={e => {
              e.preventDefault()
              void logout()
            }}
          >
            {m.logout}
          </a>
        </div>
      </form>
    </AuthShell>
  )
}

function ChangePassphraseCard() {
  const { account, refreshAccount } = useAccount()
  const m = useMessages(appMessages).changePass
  const errText = useErrorText()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!account) return null
  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const env = account.envelopes.find(e => e.kekType === 'passphrase')
      if (!env) throw new Error('passphrase envelope missing')
      const { kek } = await deriveFromPassphrase(current, account.kdf)
      const raw = await unwrapMasterKeyRaw(env, kek)
      try {
        await api.setPassphrase(await buildPassphraseChange(raw, next))
      } finally {
        raw.fill(0)
      }
      await refreshAccount()
      setCurrent('')
      setNext('')
      setNext2('')
      setMsg({ ok: true, text: m.done })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiClientError && e.code === 'REAUTH_REQUIRED' ? m.reauth : errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <h3>{m.title}</h3>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <form
        onSubmit={e => {
          e.preventDefault()
          if (current && passphraseReady(next, next2) && !busy) void submit()
        }}
      >
        <div className="field">
          <label htmlFor="cur">{m.current}</label>
          <input id="cur" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <PassphraseFields value={next} confirm={next2} onChange={setNext} onConfirmChange={setNext2} label={m.newLabel} />
        {busy ? (
          <Working label={m.working} />
        ) : (
          <button className="primary" type="submit" disabled={!current || !passphraseReady(next, next2)}>
            {m.submit}
          </button>
        )}
      </form>
    </div>
  )
}

export default function AppPage() {
  const router = useRouter()
  const { path, fmtDate, fmtNumber } = useI18n()
  const t = useMessages(appMessages)
  const errText = useErrorText()
  const { status, account, masterKey, vault, mutate, refreshAccount, syncError, bootError } = useAccount()
  const sApi = useMessages(storageApiMessages)
  const [view, setView] = useState<ViewId>('cloud')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [undo, setUndo] = useState<TrashEntry | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<VaultEntry | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [versionsId, setVersionsId] = useState<string | null>(null)
  const [proofId, setProofId] = useState<string | null>(null)
  const [versionRules, setVersionRules] = useState({ days: 30, max: 10 })
  const [versionPurge, setVersionPurge] = useState<Record<string, string>>({})
  const [joinInvite, setJoinInvite] = useState<{ token: string; owner: string } | null>(null)

  useEffect(() => {
    if (status !== 'ready') return
    const token = sessionStorage.getItem('fv_join')
    if (!token) return
    api
      .familyInviteInfo(token)
      .then(i => setJoinInvite({ token, owner: i.ownerLabel }))
      .catch(e => {
        sessionStorage.removeItem('fv_join')
        setError(errText(e))
      })
    if (window.location.search.includes('join=')) window.history.replaceState(null, '', window.location.pathname)
  }, [status, errText])
  const [trashDays, setTrashDays] = useState(30)
  const [freeGb, setFreeGb] = useState(5)
  const [purgeAt, setPurgeAt] = useState<Record<string, string>>({})
  const [sharing, setSharing] = useState<VaultEntry | null>(null)
  const [onFilecoin, setOnFilecoin] = useState<Record<string, { copies: number }>>({})
  useEffect(() => {
    if (status !== 'ready') return
    const load = () => api.filecoinStatus().then(r => setOnFilecoin(r.objects)).catch(() => undefined)
    void load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [status, vault.files.length])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dl, setDl] = useState<{ name: string; pct: number } | null>(null)
  const dlAbort = useRef<AbortController | null>(null)
  const [devPro, setDevPro] = useState(false)

  useEffect(() => {
    // Family-Einladung überlebt Anmeldung/Registrierung (nur in diesem Tab)
    const join = new URLSearchParams(window.location.search).get('join')
    if (join && /^[A-Za-z0-9_-]{20,64}$/.test(join)) sessionStorage.setItem('fv_join', join)
    if (status === 'signedOut') router.replace(path(sessionStorage.getItem('fv_join') ? '/registrieren' : '/anmelden'))
  }, [status, router, path])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setDevPro(process.env.NODE_ENV !== 'production' && q.get('pro') === '1')
    const v = q.get('view')
    if (v === 'plans' || v === 'account' || v === 'send' || v === 'trash') setView(v)
    api
      .offer()
      .then(o => {
        setTrashDays(o.trashDays)
        setFreeGb(o.free.quotaGb)
        setVersionRules(o.versions)
      })
      .catch(() => undefined)
  }, [])

  // Papierkorb mit dem Server abgleichen: Löschfristen holen, abgelaufene (endgültig gelöschte) Einträge entfernen.
  const trashLen = vault.trash?.length ?? 0
  useEffect(() => {
    if (status !== 'ready' || (!trashLen && view !== 'trash')) return
    let cancelled = false
    api
      .listTrash()
      .then(({ items }) => {
        if (cancelled) return
        const map = Object.fromEntries(items.map(i => [i.objectId, i.purgeAfter]))
        setPurgeAt(map)
        const cutoff = Date.now() - 60_000
        mutate(c => {
          const trash = c.trash ?? []
          const keep = trash.filter(e => !e.objectId || map[e.objectId] || e.trashedAt > cutoff)
          return keep.length === trash.length ? c : { ...c, trash: keep }
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [status, view, trashLen, mutate])

  const paidAccount = !!account && account.plan !== 'free'

  /**
   * Neue Datei gespeichert. Pro/Family: gleicher Name im selben Ordner → neue Version,
   * die bisherige Fassung bleibt als Version erhalten. Free: beide Dateien bleiben nebeneinander.
   */
  const onStored = useCallback(
    async (entry: VaultEntry) => {
      const prev = paidAccount
        ? vault.files.find(f => f.objectId && f.folder === entry.folder && f.name.toLowerCase() === entry.name.toLowerCase())
        : undefined
      if (prev?.objectId) {
        try {
          await api.keepVersion(prev.objectId)
          const asVersion: FileVersion = {
            objectId: prev.objectId,
            size: prev.size,
            type: prev.type,
            wrappedKey: prev.wrappedKey,
            wrapIv: prev.wrapIv,
            chunks: prev.chunks,
            pieceSize: prev.pieceSize,
            storedAt: prev.storedAt
          }
          const all = [asVersion, ...(prev.versions ?? [])]
          const keep = all.slice(0, versionRules.max)
          for (const extra of all.slice(versionRules.max)) void api.deleteObject(extra.objectId).catch(() => undefined)
          mutate(c => ({ ...c, files: [{ ...entry, versions: keep }, ...c.files.filter(f => f.id !== entry.id && f.id !== prev.id)] }))
          setNotice(fmt(t.versions.saved, { name: entry.name, days: versionRules.days }))
          void refreshAccount()
          return
        } catch {
          // Version konnte nicht angelegt werden → wie Free: als eigene Datei behalten
        }
      }
      mutate(c => ({ ...c, files: [entry, ...c.files.filter(f => f.id !== entry.id)] }))
      void refreshAccount()
    },
    [paidAccount, vault.files, versionRules, mutate, refreshAccount, t]
  )

  // Abgelaufene Versionen (vom Server endgültig gelöscht) aus dem Index entfernen
  const versionCount = vault.files.reduce((n, f) => n + (f.versions?.length ?? 0), 0)
  useEffect(() => {
    if (status !== 'ready' || !versionCount) return
    let cancelled = false
    api
      .listVersions()
      .then(({ items }) => {
        if (cancelled) return
        const map = Object.fromEntries(items.map(i => [i.objectId, i.purgeAfter]))
        setVersionPurge(map)
        mutate(c => {
          let changed = false
          const files = c.files.map(f => {
            if (!f.versions?.length) return f
            const v = f.versions.filter(x => map[x.objectId])
            if (v.length === f.versions.length) return f
            changed = true
            return { ...f, versions: v }
          })
          return changed ? { ...c, files } : c
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [status, versionCount, mutate])

  const restoreVersion = useCallback(
    async (entry: VaultEntry, v: FileVersion) => {
      if (!entry.objectId) return
      setBusyId(entry.id)
      setError(null)
      try {
        await api.promoteVersion(v.objectId, entry.objectId)
        const current: FileVersion = {
          objectId: entry.objectId,
          size: entry.size,
          type: entry.type,
          wrappedKey: entry.wrappedKey,
          wrapIv: entry.wrapIv,
          chunks: entry.chunks,
          pieceSize: entry.pieceSize,
          storedAt: entry.storedAt
        }
        const next: VaultEntry = {
          ...entry,
          ...v,
          id: entry.id,
          name: entry.name,
          folder: entry.folder,
          // Zeitstempel = Änderung (gewinnt beim Abgleich zwischen Geräten)
          storedAt: Date.now(),
          versions: [current, ...(entry.versions ?? []).filter(x => x.objectId !== v.objectId)]
        }
        mutate(c => ({ ...c, files: c.files.map(f => (f.id === entry.id ? next : f)) }))
        setNotice(fmt(t.versions.restored, { date: new Date(v.storedAt).toLocaleString() }))
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusyId(null)
      }
    },
    [mutate, errText, t]
  )

  const onDownload = useCallback(
    async (entry: VaultEntry) => {
      if (!masterKey) return
      setBusyId(entry.id)
      setError(null)
      const abort = new AbortController()
      dlAbort.current = abort
      setDl({ name: entry.name, pct: 0 })
      try {
        await downloadFile(entry, masterKey, {
          signal: abort.signal,
          onProgress: p => setDl({ name: entry.name, pct: p.total ? Math.round((p.done / p.total) * 100) : 100 })
        })
      } catch (e) {
        setError(errText(e) || t.download.failed)
      } finally {
        setBusyId(null)
        setDl(null)
        dlAbort.current = null
      }
    },
    [masterKey, errText, t]
  )

  const paidPlan = account?.plan !== undefined && account.plan !== 'free'

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 12_000)
    return () => clearTimeout(timer)
  }, [undo])

  /** Endgültig löschen (Free, oder aus dem Papierkorb). */
  const deleteForever = useCallback(
    async (entry: VaultEntry) => {
      setBusyId(entry.id)
      setError(null)
      try {
        for (const id of [entry.objectId, ...(entry.versions ?? []).map(v => v.objectId)]) {
          if (!id) continue
          try {
            await api.deleteObject(id)
          } catch (e) {
            if (!(e instanceof ApiClientError && e.code === 'NOT_FOUND')) throw e
          }
        }
        mutate(c => ({ ...c, files: c.files.filter(f => f.id !== entry.id), trash: (c.trash ?? []).filter(f => f.id !== entry.id) }))
        void refreshAccount()
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusyId(null)
      }
    },
    [mutate, refreshAccount, errText]
  )

  /** Pro/Family: in den Papierkorb (mit Rückgängig), Free: nach Bestätigung endgültig. */
  const onDelete = useCallback(
    async (id: string) => {
      const entry = vault.files.find(f => f.id === id)
      if (!entry) return
      if (!paidPlan || !entry.objectId) return setConfirmDelete(entry)
      setBusyId(id)
      setError(null)
      try {
        await api.trashObject(entry.objectId)
        const trashed: TrashEntry = { ...entry, trashedAt: Date.now() }
        mutate(c => ({ ...c, files: c.files.filter(f => f.id !== id), trash: [trashed, ...(c.trash ?? []).filter(f => f.id !== id)] }))
        setUndo(trashed)
        setNotice(null)
      } catch (e) {
        if (e instanceof ApiClientError && e.code === 'PLAN_REQUIRED') setConfirmDelete(entry)
        else setError(errText(e))
      } finally {
        setBusyId(null)
      }
    },
    [vault.files, paidPlan, mutate, errText]
  )

  const onRestore = useCallback(
    async (entry: TrashEntry) => {
      setBusyId(entry.id)
      setError(null)
      try {
        if (entry.objectId) await api.restoreObject(entry.objectId)
        const { trashedAt: _t, ...file } = entry
        mutate(c => ({ ...c, trash: (c.trash ?? []).filter(f => f.id !== entry.id), files: [file, ...c.files.filter(f => f.id !== entry.id)] }))
        setUndo(null)
        setNotice(fmt(t.trash.restored, { name: entry.name }))
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusyId(null)
      }
    },
    [mutate, errText, t]
  )

  const emptyTrash = useCallback(async () => {
    for (const e of vault.trash ?? []) await deleteForever(e)
  }, [vault.trash, deleteForever])

  const upsertSecret = useCallback(
    (s: SecretEntry) => mutate(c => ({ ...c, secrets: [s, ...c.secrets.filter(x => x.id !== s.id)] })),
    [mutate]
  )
  const upsertSecrets = useCallback(
    (list: SecretEntry[]) =>
      mutate(c => {
        const ids = new Set(list.map(s => s.id))
        return { ...c, secrets: [...list, ...c.secrets.filter(x => !ids.has(x.id))] }
      }),
    [mutate]
  )
  const deleteSecret = useCallback((id: string) => mutate(c => ({ ...c, secrets: c.secrets.filter(x => x.id !== id) })), [mutate])

  if (status === 'loading' || status === 'signedOut') {
    return <AuthShell>{bootError ? <div className="errorbox">{bootError}</div> : <Working label={t.loadingAccount} />}</AuthShell>
  }
  if (status === 'locked' || !account || !masterKey) return <UnlockScreen />

  const tier = TIER[account.plan]
  const isPro = account.plan !== 'free' || devPro
  const freeBytes = Math.max(0, account.quotaBytes - account.usedBytes)
  const titles: Record<ViewId, string> = {
    cloud: t.nav.cloud,
    send: t.nav.send,
    trash: t.nav.trash,
    plans: t.nav.plans,
    account: t.nav.account,
    passwords: t.nav.passwords,
    notes: t.nav.notes,
    '2fa': t.nav.totp,
    passkeys: t.nav.passkeys,
    familyFolder: t.nav.familyFolder,
    storageApi: sApi.nav
  }

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onNavigate={setView}
        usedBytes={account.usedBytes}
        quotaBytes={account.quotaBytes}
        tierLabel={PLAN_LABEL[account.plan]}
        tier={tier}
        showPlans
        pro={isPro}
        storageApi={account.plan === 'business'}
        storageApiLabel={sApi.nav}
      />
      <div className="main">
        <Topbar title={titles[view]} search={search} onSearchChange={setSearch} showSearch={view === 'cloud'} right={<AccountMenu />} />
        <div className="content">
          {error && (
            <div className="errorbox" onClick={() => setError(null)}>
              {error}
            </div>
          )}
          {undo && (
            <div className="notice undonotice">
              <span>{fmt(t.files.movedToTrash, { name: undo.name })}</span>
              <button className="small" onClick={() => void onRestore(undo)}>
                {t.files.undo}
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
          {syncError && <div className="errorbox">{fmt(t.syncError, { error: syncError })}</div>}

          {view === 'cloud' && (
            <>
              <AccountUpload masterKey={masterKey} freeBytes={freeBytes} onStored={e => void onStored(e)} onError={msg => setError(msg)} />
              {dl && (
                <div className="dlbar">
                  <span className="dlbar-name" title={dl.name}>
                    ⬇ {dl.name}
                  </span>
                  <div className="dlbar-track">
                    <div className="dlbar-fill" style={{ width: `${dl.pct}%` }} />
                  </div>
                  <span className="dlbar-pct">{dl.pct}%</span>
                  <button className="small" onClick={() => dlAbort.current?.abort()}>
                    {t.download.cancel}
                  </button>
                </div>
              )}
              <FileList
                entries={vault.files}
                busyId={busyId}
                canDecrypt
                searchQuery={search}
                onDownload={e => void onDownload(e)}
                onDelete={id => void onDelete(id)}
                onShare={e => setSharing(e)}
                onPreview={e => setPreviewId(e.id)}
                onVersions={e => setVersionsId(e.id)}
                onProof={e => setProofId(e.id)}
                onFilecoin={onFilecoin}
                headerAction={
                  <>
                  <button className="small trashbtn" onClick={() => setView('send')}>
                    <SendIcon />
                    {t.nav.send}
                  </button>
                  {account.plan === 'family' && (
                    <button className="small trashbtn familybtn" onClick={() => setView('familyFolder')}>
                      <FamilyIcon />
                      {t.nav.familyFolder}
                    </button>
                  )}
                  {paidPlan || (vault.trash?.length ?? 0) > 0 ? (
                    <button className="small trashbtn" onClick={() => setView('trash')}>
                      <TrashIcon />
                      {t.trash.button}
                      {(vault.trash?.length ?? 0) > 0 && <b className="trashcount">{vault.trash!.length}</b>}
                    </button>
                  ) : (
                    <button className="small trashbtn locked" data-tip={t.trash.lockedTip} aria-label={`${t.trash.button} – ${t.trash.lockedTip}`} onClick={() => setView('plans')}>
                      <LockIcon />
                      {t.trash.button}
                    </button>
                  )}
                  </>
                }
                deleteNote={fmt(paidPlan ? t.files.deleteNote : t.files.deleteNoteFree, { days: trashDays })}
              />
            </>
          )}

          {previewId &&
            (() => {
              const i = vault.files.findIndex(f => f.id === previewId)
              if (i < 0) return null
              const files = vault.files
              return (
                <PreviewModal
                  entry={files[i]}
                  masterKey={masterKey}
                  onClose={() => setPreviewId(null)}
                  onDownload={e => void onDownload(e)}
                  onPrev={i > 0 ? () => setPreviewId(files[i - 1].id) : undefined}
                  onNext={i < files.length - 1 ? () => setPreviewId(files[i + 1].id) : undefined}
                />
              )
            })()}
          {versionsId &&
            (() => {
              const entry = vault.files.find(f => f.id === versionsId)
              if (!entry) return null
              return (
                <VersionsDialog
                  entry={entry}
                  purgeAt={versionPurge}
                  days={versionRules.days}
                  max={versionRules.max}
                  busy={busyId === entry.id}
                  onClose={() => setVersionsId(null)}
                  onRestore={v => void restoreVersion(entry, v)}
                  onDownload={v => void onDownload({ ...entry, ...v, id: `${entry.id}:${v.objectId}`, versions: undefined })}
                />
              )
            })()}
          {proofId &&
            (() => {
              const entry = vault.files.find(f => f.id === proofId)
              return entry ? <ProofDialog entry={entry} onClose={() => setProofId(null)} /> : null
            })()}
          {view === 'send' && (
            <>
              <button className="small backbtn" onClick={() => setView('cloud')}>
                ← {t.trash.back}
              </button>
              <SendView files={vault.files} />
            </>
          )}
          {view === 'trash' && (
            <TrashView
              entries={vault.trash ?? []}
              purgeAt={purgeAt}
              paid={paidPlan}
              days={trashDays}
              busyId={busyId}
              onRestore={e => void onRestore(e)}
              onDeleteForever={e => void deleteForever(e)}
              onEmpty={emptyTrash}
              onUpgrade={() => setView('plans')}
              onBack={() => setView('cloud')}
            />
          )}
          {confirmDelete && (
            <ConfirmDialog
              title={fmt(t.files.confirmDelete, { name: confirmDelete.name })}
              body={t.files.confirmDeleteBody}
              confirmLabel={t.confirm.delete}
              cancelLabel={t.confirm.cancel}
              onCancel={() => setConfirmDelete(null)}
              onConfirm={() => {
                const e = confirmDelete
                setConfirmDelete(null)
                void deleteForever(e)
              }}
            />
          )}
          {sharing && <ShareDialog entry={sharing} masterKey={masterKey} onClose={() => setSharing(null)} />}

          {view === 'plans' && <PlansView />}

          {view === 'storageApi' && account.plan === 'business' && <StorageApiView />}

          {view === 'familyFolder' && account.plan === 'family' && (
            <>
              <button className="small backbtn" onClick={() => setView('cloud')}>
                ← {t.trash.back}
              </button>
              <FamilyFolderView freeBytes={freeBytes} />
            </>
          )}

          {(view === 'passwords' || view === 'notes' || view === '2fa') &&
            (!isPro ? (
              <UpgradeWall
                title={titles[view]}
                description={
                  view === 'passwords' ? t.upgradeWall.passwordsDesc : view === 'notes' ? t.upgradeWall.notesDesc : t.upgradeWall.totpDesc
                }
                onUpgrade={() => setView('plans')}
              />
            ) : view === 'passwords' ? (
              <PasswordsPanel
                entries={vault.secrets.filter(s => s.kind === 'password')}
                onSave={upsertSecret}
                onSaveMany={upsertSecrets}
                onDelete={deleteSecret}
              />
            ) : view === 'notes' ? (
              <NotesPanel entries={vault.secrets.filter(s => s.kind === 'note')} onSave={upsertSecret} onDelete={deleteSecret} />
            ) : (
              <TotpPanel entries={vault.secrets.filter(s => s.kind === 'totp')} onSave={upsertSecret} onDelete={deleteSecret} />
            ))}

          {joinInvite && (
            <ConfirmDialog
              title={t.family.joinTitle}
              body={fmt(t.family.joinBody, { owner: joinInvite.owner })}
              confirmLabel={t.family.join}
              cancelLabel={t.family.decline}
              danger={false}
              onCancel={() => {
                sessionStorage.removeItem('fv_join')
                setJoinInvite(null)
              }}
              onConfirm={async () => {
                const inv = joinInvite
                setJoinInvite(null)
                sessionStorage.removeItem('fv_join')
                try {
                  await api.familyJoin(inv.token)
                  await refreshAccount()
                  setNotice(fmt(t.family.joined, { owner: inv.owner }))
                } catch (e) {
                  setError(errText(e))
                }
              }}
            />
          )}
          {view === 'account' && (
            <>
              <FamilyPanel freeGb={freeGb} />
              <div className="grid2">
                <div className="card">
                  <h3>{t.account.title}</h3>
                  <div className="stat">
                    <span className="k">{account.email ? t.account.email : t.account.account}</span>
                    <span className="v">{account.email ?? account.label}</span>
                  </div>
                  {account.wallets.map(w => (
                    <div className="stat" key={w}>
                      <span className="k">{t.account.login}</span>
                      <span className="v mono">
                        {w.slice(0, 10)}…{w.slice(-6)}
                      </span>
                    </div>
                  ))}
                  <div className="stat">
                    <span className="k">{t.account.plan}</span>
                    <span className="v">{PLAN_LABEL[account.plan]}</span>
                  </div>
                  <div className="stat">
                    <span className="k">{t.account.storage}</span>
                    <span className="v">
                      {formatBytes(account.usedBytes)} / {formatBytes(account.quotaBytes)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">{t.account.entries}</span>
                    <span className="v">
                      {fmtNumber(vault.files.length)} · {fmtNumber(vault.secrets.length)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">{t.account.since}</span>
                    <span className="v">{fmtDate(account.createdAt)}</span>
                  </div>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="primary" onClick={() => setView('plans')}>
                      {t.account.managePlan}
                    </button>
                  </div>
                </div>
                <div className="card">
                  <h3>{t.security.title}</h3>
                  <p className="dim">{t.security.body}</p>
                  <div className="stat">
                    <span className="k">{t.security.kdf}</span>
                    <span className="v">
                      Argon2id · {Math.round(account.kdf.m / 1024)} MiB · t={account.kdf.t}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">{t.security.autolock}</span>
                    <span className="v">{t.security.autolockValue}</span>
                  </div>
                  <div className="stat">
                    <span className="k">{t.security.kit}</span>
                    <span className="v">{t.security.kitValue}</span>
                  </div>
                </div>
              </div>
              <ChangePassphraseCard />
              {isPro ? (
                <PasskeysPanel />
              ) : (
                <div className="card lockedcard">
                  <h3>
                    {t.passkeys.title}
                    <span className="navlock" data-tip={t.nav.proOnly} aria-label={t.nav.proOnly}>
                      <LockIcon />
                    </span>
                  </h3>
                  <p className="dim">{t.passkeys.lead}</p>
                  <button className="small trashbtn locked" data-tip={t.nav.proOnly} onClick={() => setView('plans')}>
                    <LockIcon />
                    {t.passkeys.add}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TrashIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function FamilyIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="10" cy="13" r="1.6" />
      <circle cx="15" cy="13" r="1.6" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
    </svg>
  )
}
