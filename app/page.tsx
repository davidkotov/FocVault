'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useChainId,
  useReadContract,
  useSignMessage,
  useWalletClient,
  useWriteContract
} from 'wagmi'
import { SUB_GATE_ADDRESS, isSupportedChain, usdfcFor } from '@/lib/chains'
import { erc20Abi, subscriptionGateAbi } from '@/lib/abis'
import {
  buildSignMessage,
  decryptChunk,
  decryptPieceFrames,
  decryptVaultJsonBytes,
  deriveMasterKey,
  encryptVaultJsonBytes,
  getOrCreateSalt,
  STREAM_BLOCK_SIZE,
  unwrapFileKey
} from '@/lib/crypto'
import { TIERS, EMPTY_CONTAINER, loadVaultContainer, saveVaultContainer, tierFor, usedBytes, parseVaultContainer, type VaultContainer, type VaultEntry, type SecretEntry } from '@/lib/vault'
import { downloadPiece, getSynapse, getVaultContexts, openPieceStream, prepareStorage, uploadPiecesBatched } from '@/lib/synapse'
import { clearParts, getPart, listPartKeys, savePart } from '@/lib/idb'
import { createShareUrl } from '@/lib/share'
import Landing from '@/components/Landing'
import Sidebar, { type ViewId } from '@/components/Sidebar'
import Topbar from '@/components/Topbar'
import VaultUnlock from '@/components/VaultUnlock'
import UploadZone from '@/components/UploadZone'
import FileList from '@/components/FileList'
import ProPanel from '@/components/ProPanel'
import AccountPanel from '@/components/AccountPanel'
import TopUpPanel from '@/components/TopUpPanel'
import ShareDialog from '@/components/ShareDialog'
import PasswordsPanel from '@/components/PasswordsPanel'
import NotesPanel from '@/components/NotesPanel'
import TotpPanel from '@/components/TotpPanel'
import UpgradeWall from '@/components/UpgradeWall'

const AUTO_LOCK_MINUTES = 30

function mergeContainer(remote: VaultContainer, local: VaultContainer): VaultContainer {
  const fileIds = new Set(local.files.map(e => e.id))
  const secretIds = new Set(local.secrets.map(e => e.id))
  return {
    v: 3,
    files: [...remote.files.filter(e => !fileIds.has(e.id)), ...local.files],
    secrets: [...remote.secrets.filter(e => !secretIds.has(e.id)), ...local.secrets]
  }
}

export default function Home() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  const { signMessageAsync, isPending: signing } = useSignMessage()
  const { writeContractAsync } = useWriteContract()

  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [vault, setVault] = useState<VaultContainer>(EMPTY_CONTAINER)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dlJob, setDlJob] = useState<{ name: string; pct: number } | null>(null)
  const dlAbortRef = useRef<AbortController | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [focRefresh, setFocRefresh] = useState(0)
  const [shareEntry, setShareEntry] = useState<VaultEntry | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [view, setView] = useState<ViewId>('cloud')
  const [search, setSearch] = useState('')
  const [devPro, setDevPro] = useState(false)

  // Dev/Praesentations-Hilfe: ?pro=1 schaltet die Pro-Module ohne Abo frei.
  useEffect(() => {
    setDevPro(typeof window !== 'undefined' && window.location.search.includes('pro=1'))
  }, [])

  const supported = isSupportedChain(chainId)
  const usdfc = usdfcFor(chainId)
  const gateEnabled = !!SUB_GATE_ADDRESS && supported

  useEffect(() => {
    if (address) {
      setVault(loadVaultContainer(address))
    } else {
      setVault(EMPTY_CONTAINER)
      setMasterKey(null)
    }
  }, [address])

  useEffect(() => {
    if (!masterKey) return
    const ms = AUTO_LOCK_MINUTES * 60 * 1000
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setMasterKey(null), ms)
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach(e => window.addEventListener(e, arm, { passive: true }))
    arm()
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, arm))
    }
  }, [masterKey])

  const { data: usdfcBalance } = useReadContract({
    abi: erc20Abi,
    address: usdfc,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!address && !!usdfc && supported }
  })

  const { data: proActive, refetch: refetchPro } = useReadContract({
    abi: subscriptionGateAbi,
    address: SUB_GATE_ADDRESS || undefined,
    functionName: 'isSubscribed',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: gateEnabled && !!address }
  })

  const { data: syncCid, refetch: refetchSyncCid } = useReadContract({
    abi: subscriptionGateAbi,
    address: SUB_GATE_ADDRESS || undefined,
    functionName: 'syncIndex',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: gateEnabled && !!address }
  })

  const isPro = devPro || (gateEnabled ? !!proActive : false)
  const tier = tierFor(isPro)
  const used = usedBytes(vault.files)
  const quota = TIERS[tier].maxBytes
  const quotaRemaining = Math.max(0, quota - used)

  const unlockVault = useCallback(async () => {
    if (!address) return
    setUnlocking(true)
    setError(null)
    try {
      const salt = getOrCreateSalt(address)
      const sig = await signMessageAsync({ message: buildSignMessage(salt) })
      const key = await deriveMasterKey(sig, salt)
      setMasterKey(key)
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Signatur abgelehnt')
    } finally {
      setUnlocking(false)
    }
  }, [address, signMessageAsync])

  const lockVault = useCallback(() => {
    setMasterKey(null)
    setShareEntry(null)
    setShareUrl(null)
  }, [])

  const pushSyncQuiet = useCallback(
    async (nextVault: VaultContainer) => {
      if (!address || !masterKey || !walletClient || !gateEnabled) return
      try {
        const container = await encryptVaultJsonBytes(JSON.stringify(nextVault), masterKey)
        const synapse = await getSynapse(walletClient)
        const contexts = await getVaultContexts(synapse, address)
        const prep = await prepareStorage(synapse, [container.byteLength], contexts)
        if (prep.transaction) await prep.transaction.execute()
        const result = await uploadPiecesBatched(synapse, [container], undefined, contexts)
        const cid = result.pieceCids[0]
        await writeContractAsync({
          abi: subscriptionGateAbi,
          address: SUB_GATE_ADDRESS as `0x${string}`,
          functionName: 'setSyncIndex',
          args: [cid]
        })
        window.localStorage.setItem(`focvault:syncCid:${address.toLowerCase()}`, cid)
        await refetchSyncCid()
      } catch {
        void 0
      }
    },
    [address, masterKey, walletClient, gateEnabled, writeContractAsync, refetchSyncCid]
  )

  const pushSync = useCallback(
    async (quiet = false) => {
      if (!address || !masterKey || !walletClient || !gateEnabled) return
      setSyncing('push')
      if (!quiet) setError(null)
      try {
        await pushSyncQuiet(vault)
      } catch (e: any) {
        if (!quiet) setError(e?.shortMessage ?? e?.message ?? 'Sync fehlgeschlagen')
      } finally {
        setSyncing(null)
      }
    },
    [address, masterKey, walletClient, gateEnabled, vault, pushSyncQuiet]
  )

  const pullSync = useCallback(async () => {
    if (!address || !masterKey || !walletClient) return
    const cid = syncCid || window.localStorage.getItem(`focvault:syncCid:${address.toLowerCase()}`)
    if (!cid) {
      setError('Kein Sync-Index auf der Chain gefunden.')
      return
    }
    setSyncing('pull')
    setError(null)
    try {
      const synapse = await getSynapse(walletClient)
      const bytes = await downloadPiece(synapse, cid)
      const json = await decryptVaultJsonBytes(bytes, masterKey)
      const imported = parseVaultContainer(json)
      const merged = mergeContainer(imported, vault)
      setVault(merged)
      saveVaultContainer(address, merged)
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Sync-Laden fehlgeschlagen (anderer Master-Schlüssel?)')
    } finally {
      setSyncing(null)
    }
  }, [address, masterKey, walletClient, syncCid, vault])

  const handleStored = useCallback(
    (entry: VaultEntry) => {
      if (!address) return
      const next: VaultContainer = { v: 3, files: [entry, ...vault.files], secrets: vault.secrets }
      setVault(next)
      saveVaultContainer(address, next)
      void pushSyncQuiet(next)
    },
    [address, vault, pushSyncQuiet]
  )

  const handleDelete = useCallback(
    (id: string) => {
      if (!address) return
      const next: VaultContainer = { v: 3, files: vault.files.filter(e => e.id !== id), secrets: vault.secrets }
      setVault(next)
      saveVaultContainer(address, next)
      void pushSyncQuiet(next)
    },
    [address, vault, pushSyncQuiet]
  )

  const upsertSecret = useCallback(
    (secret: SecretEntry) => {
      if (!address) return
      const idx = vault.secrets.findIndex(s => s.id === secret.id)
      const secrets =
        idx >= 0 ? vault.secrets.map(s => (s.id === secret.id ? secret : s)) : [...vault.secrets, secret]
      const next: VaultContainer = { v: 3, files: vault.files, secrets }
      setVault(next)
      saveVaultContainer(address, next)
      void pushSyncQuiet(next)
    },
    [address, vault, pushSyncQuiet]
  )

  const upsertSecrets = useCallback(
    (secretList: SecretEntry[]) => {
      if (!address || secretList.length === 0) return
      const map = new Map(vault.secrets.map(s => [s.id, s]))
      for (const s of secretList) map.set(s.id, s)
      const secrets = [...map.values()]
      const next: VaultContainer = { v: 3, files: vault.files, secrets }
      setVault(next)
      saveVaultContainer(address, next)
      void pushSyncQuiet(next)
    },
    [address, vault, pushSyncQuiet]
  )

  const deleteSecret = useCallback(
    (id: string) => {
      if (!address) return
      const next: VaultContainer = { v: 3, files: vault.files, secrets: vault.secrets.filter(s => s.id !== id) }
      setVault(next)
      saveVaultContainer(address, next)
      void pushSyncQuiet(next)
    },
    [address, vault, pushSyncQuiet]
  )

  const handleDownload = useCallback(
    async (entry: VaultEntry) => {
      if (!walletClient || !masterKey) return
      setBusyId(entry.id)
      setError(null)
      const abort = new AbortController()
      dlAbortRef.current = abort
      setDlJob({ name: entry.name, pct: 0 })
      const jobId = crypto.randomUUID()
      try {
        const synapse = await getSynapse(walletClient)
        const fileKey = await unwrapFileKey({ wrapped: entry.wrappedKey, iv: entry.wrapIv }, masterKey)
        const report = (loaded: number) => {
          setDlJob(j => (j ? { ...j, pct: Math.min(100, Math.round((loaded / entry.size) * 100)) } : j))
        }
        const framesFor = (chunkIndex: number) => {
          const clearSize =
            chunkIndex === entry.chunks.length - 1
              ? entry.size - chunkIndex * (256 * 1024 * 1024)
              : 256 * 1024 * 1024
          return Math.max(1, Math.ceil(clearSize / STREAM_BLOCK_SIZE))
        }
        const hasFSA =
          typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function'

        if (hasFSA) {
          // Chrome/Edge: direkt auf die Festplatte streamen – RAM-frei.
          const handle = await (window as any).showSaveFilePicker({ suggestedName: entry.name })
          const writable = await handle.createWritable()
          let loaded = 0
          try {
            for (let i = 0; i < entry.chunks.length; i++) {
              const chunk = entry.chunks[i]
              if (abort.signal.aborted) throw new DOMException('Download abgebrochen', 'AbortError')
              if (chunk.fmt === 'frame') {
                const stream = await openPieceStream(synapse, chunk.pieceCid, abort.signal)
                await decryptPieceFrames(stream, fileKey, chunk.iv, framesFor(i), async plain => {
                  await writable.write(plain)
                  loaded += plain.byteLength
                  report(loaded)
                })
              } else {
                const bytes = await downloadPiece(synapse, chunk.pieceCid)
                const plain = await decryptChunk(bytes, chunk.iv, chunk.padLen, fileKey)
                await writable.write(plain)
                loaded += plain.byteLength
                report(loaded)
              }
            }
            await writable.close()
          } catch (e: any) {
            if (abort.signal.aborted) {
              await writable.abort().catch(() => undefined)
              setError('Download abgebrochen.')
              return
            }
            throw e
          }
        } else {
          // Fallback (Firefox/Safari): IndexedDB-Puffer statt RAM-Kumulation.
          await clearParts(jobId)
          let loaded = 0
          let partIndex = 0
          for (let i = 0; i < entry.chunks.length; i++) {
            const chunk = entry.chunks[i]
            if (abort.signal.aborted) throw new DOMException('Download abgebrochen', 'AbortError')
            if (chunk.fmt === 'frame') {
              const stream = await openPieceStream(synapse, chunk.pieceCid, abort.signal)
              await decryptPieceFrames(stream, fileKey, chunk.iv, framesFor(i), async plain => {
                await savePart(jobId, partIndex++, new Blob([plain.buffer as ArrayBuffer]))
                loaded += plain.byteLength
                report(loaded)
              })
            } else {
              const bytes = await downloadPiece(synapse, chunk.pieceCid)
              const plain = await decryptChunk(bytes, chunk.iv, chunk.padLen, fileKey)
              await savePart(jobId, partIndex++, new Blob([plain.buffer as ArrayBuffer]))
              loaded += plain.byteLength
              report(loaded)
            }
          }
          const keys = await listPartKeys(jobId)
          const parts: Blob[] = []
          for (const k of keys) {
            const p = await getPart(jobId, k)
            if (p) parts.push(p)
          }
          const blob = new Blob(parts, { type: entry.type || 'application/octet-stream' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = entry.name
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 10_000)
          await clearParts(jobId)
        }
      } catch (e: any) {
        if (abort.signal.aborted) {
          setError('Download abgebrochen.')
        } else {
          setError(e?.shortMessage ?? e?.message ?? 'Download oder Entschlüsselung fehlgeschlagen')
        }
      } finally {
        setBusyId(null)
        setDlJob(null)
        dlAbortRef.current = null
      }
    },
    [walletClient, masterKey]
  )

  const exportVault = useCallback(async () => {
    if (!address || !masterKey) return
    try {
      const container = await encryptVaultJsonBytes(JSON.stringify(vault), masterKey)
      const blob = new Blob([container.buffer as ArrayBuffer], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `focvault-${address.slice(0, 8)}.vault`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e?.message ?? 'Export fehlgeschlagen')
    }
  }, [address, masterKey, vault])

  const importVault = useCallback(
    async (file: File) => {
      if (!address || !masterKey) return
      setError(null)
      try {
        const bytes = new Uint8Array(new Uint8Array(await file.arrayBuffer()))
        const json = await decryptVaultJsonBytes(bytes, masterKey)
        const imported = parseVaultContainer(json)
        const merged = mergeContainer(imported, vault)
        setVault(merged)
        saveVaultContainer(address, merged)
        void pushSyncQuiet(merged)
      } catch {
        setError('Import fehlgeschlagen – Datei gehört zu einem anderen Master-Schlüssel?')
      }
    },
    [address, masterKey, vault, pushSyncQuiet]
  )

  const openShareDialog = useCallback((entry: VaultEntry) => {
    setShareEntry(entry)
    setShareUrl(null)
  }, [])

  const handleShareCreate = useCallback(
    async (days: number) => {
      if (!walletClient || !masterKey || !shareEntry) return
      setShareBusy(true)
      setError(null)
      try {
        const url = await createShareUrl(walletClient, masterKey, shareEntry, days)
        setShareUrl(url)
      } catch (e: any) {
        setError(e?.shortMessage ?? e?.message ?? 'Share-Link konnte nicht erstellt werden')
      } finally {
        setShareBusy(false)
      }
    },
    [walletClient, masterKey, shareEntry]
  )

  if (!isConnected) {
    return <Landing />
  }

  const viewTitle =
    view === 'cloud'
      ? 'Meine Cloud'
      : view === 'send'
        ? 'Secure Send'
        : view === 'passwords'
          ? 'Passwörter'
          : view === 'notes'
            ? 'Notizen'
            : view === '2fa'
              ? '2FA-Authenticator'
              : 'Konto & Zahlungen'

  const shareDialogNode = shareEntry && (
    <ShareDialog
      entry={shareEntry}
      busy={shareBusy}
      url={shareUrl}
      onCreate={days => void handleShareCreate(days)}
      onClose={() => {
        setShareEntry(null)
        setShareUrl(null)
      }}
    />
  )

  const unlockPrompt = (
    <div className="card">
      <h3>Cloud entsperren</h3>
      <p className="dim">
        Signiere einmalig mit deiner Wallet, um deinen lokalen Verschlüsselungsschlüssel
        abzuleiten (HKDF aus der Signatur). Keine Transaktion, keine Kosten.
      </p>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={unlocking || signing} onClick={() => void unlockVault()}>
          {unlocking || signing ? 'Warte auf Signatur…' : 'Cloud entsperren'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="shell">
      <Sidebar view={view} onNavigate={setView} usedBytes={used} quotaBytes={quota} tierLabel={TIERS[tier].label} tier={tier} />
      <div className="main">
        <Topbar title={viewTitle} search={search} onSearchChange={setSearch} showSearch={view === 'cloud'} />
        <div className="content">
          {error && <div className="errorbox">{error}</div>}

          {!supported && (
            <div className="notice">
              Deine Wallet ist auf einem nicht unterstützten Netz. Nutze den Netzwerk-Wechsel
              oben rechts, um zu Filecoin Calibration oder Mainnet zu wechseln.
            </div>
          )}

          {supported && view === 'cloud' && (
            <>
              {!masterKey ? (
                unlockPrompt
              ) : (
                <>
                  <UploadZone
                    walletClient={walletClient}
                    masterKey={masterKey}
                    quotaRemaining={quotaRemaining}
                    onStored={handleStored}
                    onError={msg => setError(msg)}
                  />
                  {dlJob && (
                    <div className="dlbar">
                      <span className="dlbar-name" title={dlJob.name}>
                        ⬇ {dlJob.name}
                      </span>
                      <div className="dlbar-track">
                        <div className="dlbar-fill" style={{ width: `${dlJob.pct}%` }} />
                      </div>
                      <span className="dlbar-pct">{dlJob.pct}%</span>
                      <button
                        className="small"
                        onClick={() => dlAbortRef.current?.abort()}
                        disabled={!dlJob}
                      >
                        Abbrechen
                      </button>
                    </div>
                  )}
                  <FileList
                    entries={vault.files}
                    busyId={busyId}
                    canDecrypt={!!masterKey}
                    searchQuery={search}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onShare={openShareDialog}
                  />
                  {shareDialogNode}
                </>
              )}

              <div className="grid2">
                <AccountPanel walletClient={walletClient} refreshSignal={focRefresh} onError={msg => setError(msg)} />
                <ProPanel
                  usdfc={usdfc}
                  address={address}
                  isPro={isPro}
                  onSubscribed={() => refetchPro()}
                  onError={msg => setError(msg)}
                />
              </div>

              <div className="card">
                <h3>
                  Weitere Cloud-Module <span>Roadmap</span>
                </h3>
                <div className="modulesgrid">
                  <div className="modulecard">🔐 Passwords</div>
                  <div className="modulecard">🔑 Passkeys</div>
                  <div className="modulecard">📝 Secure Notes</div>
                  <div className="modulecard">💾 Device-Backup</div>
                </div>
              </div>
            </>
          )}

          {supported && view === 'send' && (
            <div className="card">
              <h3>Secure Send</h3>
              {!masterKey ? (
                <>
                  <p className="dim">Entsperre zuerst deine Cloud, um Dateien teilen zu können.</p>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="primary" disabled={unlocking || signing} onClick={() => void unlockVault()}>
                      {unlocking || signing ? 'Warte auf Signatur…' : 'Cloud entsperren'}
                    </button>
                  </div>
                </>
              ) : vault.files.length === 0 ? (
                <p className="dim">Noch keine Dateien zum Teilen. Lade zuerst etwas in „Meine Cloud" hoch.</p>
              ) : (
                <>
                  <p className="dim" style={{ marginBottom: 14 }}>
                    Wähle eine Datei — der Link enthält den Schlüssel im URL-Fragment (#), nie
                    serverseitig. Empfänger brauchen nur eine Wallet zum Abrufen, keine Kosten.
                  </p>
                  {vault.files.map(e => (
                    <div className="stat" key={e.id}>
                      <span className="k">{e.name}</span>
                      <button className="small" onClick={() => openShareDialog(e)}>
                        Teilen
                      </button>
                    </div>
                  ))}
                </>
              )}
              {shareDialogNode && <div style={{ marginTop: 16 }}>{shareDialogNode}</div>}
            </div>
          )}

          {supported && (view === 'passwords' || view === 'notes' || view === '2fa') && (
            <>
              {!isPro ? (
                <UpgradeWall
                  title={view === 'passwords' ? 'Passwörter' : view === 'notes' ? 'Notizen' : '2FA-Authenticator'}
                  description={
                    view === 'passwords'
                      ? 'Speichere Logins, Passwörter und Zugänge – Ende-zu-Ende-verschlüsselt in deinem Vault.'
                      : view === 'notes'
                        ? 'Verschlüsselte Notizen für PINs, Recovery-Hinweise, Ideen – niemand sonst liest mit.'
                        : 'Verwende deine 2FA-Codes direkt hier: TOTP-Secrets sicher speichern und Codes im Browser generieren.'
                  }
                  onUpgrade={() => setView('account')}
                />
              ) : !masterKey ? (
                unlockPrompt
              ) : view === 'passwords' ? (
                <PasswordsPanel
                  entries={vault.secrets.filter(s => s.kind === 'password')}
                  onSave={upsertSecret}
                  onSaveMany={upsertSecrets}
                  onDelete={deleteSecret}
                />
              ) : view === 'notes' ? (
                <NotesPanel
                  entries={vault.secrets.filter(s => s.kind === 'note')}
                  onSave={upsertSecret}
                  onDelete={deleteSecret}
                />
              ) : (
                <TotpPanel
                  entries={vault.secrets.filter(s => s.kind === 'totp')}
                  onSave={upsertSecret}
                  onDelete={deleteSecret}
                />
              )}
            </>
          )}

          {supported && view === 'account' && (
            <>
              <VaultUnlock
                unlocked={!!masterKey}
                busy={unlocking || signing}
                syncing={syncing}
                syncEnabled={gateEnabled}
                onUnlock={() => void unlockVault()}
                onLock={lockVault}
                onExport={() => void exportVault()}
                onImport={f => void importVault(f)}
                onPushSync={() => void pushSync()}
                onPullSync={() => void pullSync()}
                fileCount={vault.files.length}
              />
              <div className="grid2">
                <AccountPanel walletClient={walletClient} refreshSignal={focRefresh} onError={msg => setError(msg)} />
                <TopUpPanel
                  walletClient={walletClient}
                  usdfcBalance={usdfcBalance}
                  onError={msg => setError(msg)}
                  onDone={() => setFocRefresh(n => n + 1)}
                />
              </div>
              <ProPanel
                usdfc={usdfc}
                address={address}
                isPro={isPro}
                onSubscribed={() => refetchPro()}
                onError={msg => setError(msg)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
