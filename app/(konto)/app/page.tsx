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
import PassphraseFields, { passphraseReady } from '@/components/account/PassphraseFields'
import StorageOptions from '@/components/account/StorageOptions'
import { useAccount } from '@/features/account/AccountProvider'
import { ApiClientError, api, errorMessage } from '@/features/api/client'
import { buildPassphraseChange, deriveFromPassphrase, unwrapMasterKeyRaw } from '@/features/keys/kdf'
import { downloadFile } from '@/features/objects/transfer'
import { formatBytes, type SecretEntry, type TierName, type VaultEntry } from '@/lib/vault'

const TIER: Record<string, TierName> = { free: 'FREE', pro: 'PRO', family: 'FAMILY', business: 'BUSINESS' }
const TITLES: Record<ViewId, string> = {
  cloud: 'Meine Cloud',
  send: 'Secure Send',
  account: 'Konto & Sicherheit',
  passwords: 'Passwörter',
  notes: 'Notizen',
  '2fa': '2FA-Authenticator'
}

function UnlockScreen() {
  const { account, unlock, logout } = useAccount()
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
            setError(errorMessage(err, 'Entsperren fehlgeschlagen.'))
            setBusy(false)
          }
        }}
      >
        <h2>Tresor entsperren</h2>
        <p className="lead">
          Angemeldet als <strong>{account?.label}</strong>. Dein Schlüssel wird nur im Arbeitsspeicher gehalten und nach 30
          Minuten Inaktivität verworfen.
        </p>
        {error && <div className="errorbox">{error}</div>}
        <div className="field">
          <label htmlFor="unlock">Passphrase</label>
          <input id="unlock" type="password" autoFocus autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        {busy ? (
          <Working label="Schlüssel wird abgeleitet …" />
        ) : (
          <button className="primary full" type="submit" disabled={!pass}>
            Entsperren
          </button>
        )}
        <div className="authlinks">
          <Link href="/wiederherstellen">Passphrase vergessen?</Link>
          <a
            href="#"
            onClick={e => {
              e.preventDefault()
              void logout()
            }}
          >
            Abmelden
          </a>
        </div>
      </form>
    </AuthShell>
  )
}

function ChangePassphraseCard() {
  const { account, refreshAccount } = useAccount()
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
      if (!env) throw new Error('Kein Passphrase-Schlüssel gefunden.')
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
      setMsg({ ok: true, text: 'Passphrase geändert. Andere Geräte wurden abgemeldet.' })
    } catch (e) {
      const text =
        e instanceof ApiClientError && e.code === 'REAUTH_REQUIRED'
          ? 'Aus Sicherheitsgründen bitte kurz ab- und wieder anmelden, dann erneut versuchen.'
          : errorMessage(e, 'Änderung fehlgeschlagen.')
      setMsg({ ok: false, text })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <h3>Passphrase ändern</h3>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      <form
        onSubmit={e => {
          e.preventDefault()
          if (current && passphraseReady(next, next2) && !busy) void submit()
        }}
      >
        <div className="field">
          <label htmlFor="cur">Aktuelle Passphrase</label>
          <input id="cur" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <PassphraseFields value={next} confirm={next2} onChange={setNext} onConfirmChange={setNext2} label="Neue Passphrase" />
        {busy ? (
          <Working label="Wird neu verschlüsselt …" />
        ) : (
          <button className="primary" type="submit" disabled={!current || !passphraseReady(next, next2)}>
            Passphrase ändern
          </button>
        )}
      </form>
    </div>
  )
}

export default function AppPage() {
  const router = useRouter()
  const { status, account, masterKey, vault, mutate, refreshAccount, syncError, bootError } = useAccount()
  const [view, setView] = useState<ViewId>('cloud')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dl, setDl] = useState<{ name: string; pct: number } | null>(null)
  const dlAbort = useRef<AbortController | null>(null)
  const [devPro, setDevPro] = useState(false)

  useEffect(() => {
    if (status === 'signedOut') router.replace('/anmelden')
  }, [status, router])

  useEffect(() => {
    setDevPro(process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('pro') === '1')
  }, [])

  const onStored = useCallback(
    (entry: VaultEntry) => {
      mutate(c => ({ ...c, files: [entry, ...c.files.filter(f => f.id !== entry.id)] }))
      void refreshAccount()
    },
    [mutate, refreshAccount]
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
        setError(errorMessage(e, 'Download fehlgeschlagen.'))
      } finally {
        setBusyId(null)
        setDl(null)
        dlAbort.current = null
      }
    },
    [masterKey]
  )

  const onDelete = useCallback(
    async (id: string) => {
      const entry = vault.files.find(f => f.id === id)
      if (!entry) return
      if (!window.confirm(`„${entry.name}" endgültig löschen?`)) return
      setBusyId(id)
      setError(null)
      try {
        if (entry.objectId) {
          try {
            await api.deleteObject(entry.objectId)
          } catch (e) {
            if (!(e instanceof ApiClientError && e.code === 'NOT_FOUND')) throw e
          }
        }
        mutate(c => ({ ...c, files: c.files.filter(f => f.id !== id) }))
        void refreshAccount()
      } catch (e) {
        setError(errorMessage(e, 'Löschen fehlgeschlagen.'))
      } finally {
        setBusyId(null)
      }
    },
    [vault.files, mutate, refreshAccount]
  )

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
  const deleteSecret = useCallback(
    (id: string) => mutate(c => ({ ...c, secrets: c.secrets.filter(x => x.id !== id) })),
    [mutate]
  )

  if (status === 'loading' || status === 'signedOut') {
    return (
      <AuthShell>
        {bootError ? <div className="errorbox">{bootError}</div> : <Working label="Lade Konto …" />}
      </AuthShell>
    )
  }
  if (status === 'locked' || !account || !masterKey) return <UnlockScreen />

  const tier = TIER[account.plan]
  const isPro = account.plan !== 'free' || devPro
  const freeBytes = Math.max(0, account.quotaBytes - account.usedBytes)

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onNavigate={setView}
        usedBytes={account.usedBytes}
        quotaBytes={account.quotaBytes}
        tierLabel={account.plan === 'free' ? 'Free' : account.plan[0].toUpperCase() + account.plan.slice(1)}
        tier={tier}
      />
      <div className="main">
        <Topbar
          title={TITLES[view]}
          search={search}
          onSearchChange={setSearch}
          showSearch={view === 'cloud'}
          right={<AccountMenu />}
        />
        <div className="content">
          {error && (
            <div className="errorbox" onClick={() => setError(null)} title="Schließen">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" onClick={() => setNotice(null)} title="Schließen">
              {notice}
            </div>
          )}
          {syncError && <div className="errorbox">Tresor nicht synchronisiert: {syncError}</div>}

          {view === 'cloud' && (
            <>
              <AccountUpload
                masterKey={masterKey}
                freeBytes={freeBytes}
                onStored={onStored}
                onError={msg => setError(msg)}
              />
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
                    Abbrechen
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
                deleteNote="„Entfernen“ löscht die verschlüsselten Daten sofort aus dem Speicher und gibt den Platz frei. Ein Papierkorb folgt in Phase 2."
                onShare={() =>
                  setNotice(
                    'Secure Send für Konto-Dateien kommt in Phase 2: Links, die sich jederzeit widerrufen lassen, mit echter serverseitiger Einmal- und Download-Grenze.'
                  )
                }
              />
            </>
          )}

          {view === 'send' && (
            <div className="card">
              <h3>
                Secure Send <span>Phase 2</span>
              </h3>
              <p className="dim">
                Im Konto-Modus werden Share-Links vom Backend abgesichert: Ablauf, Einmal-Link und Download-Limit gelten global
                und jeder Link lässt sich sofort widerrufen. Empfänger brauchen weder Konto noch Wallet. Der Schlüssel bleibt wie
                bisher im URL-Fragment und erreicht nie den Server.
              </p>
            </div>
          )}

          {(view === 'passwords' || view === 'notes' || view === '2fa') &&
            (!isPro ? (
              <UpgradeWall
                title={TITLES[view]}
                description={
                  view === 'passwords'
                    ? 'Speichere Logins, Passwörter und Zugänge – Ende-zu-Ende-verschlüsselt in deinem Tresor.'
                    : view === 'notes'
                      ? 'Verschlüsselte Notizen für PINs, Recovery-Hinweise, Ideen – niemand sonst liest mit.'
                      : '2FA-Codes direkt hier: TOTP-Secrets sicher speichern und Codes im Browser erzeugen.'
                }
                onUpgrade={() => setView('account')}
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

          {view === 'account' && (
            <>
              <div className="grid2">
                <div className="card">
                  <h3>Konto</h3>
                  <div className="stat">
                    <span className="k">{account.email ? 'E-Mail' : 'Konto'}</span>
                    <span className="v">{account.email ?? account.label}</span>
                  </div>
                  {account.wallets.map(w => (
                    <div className="stat" key={w}>
                      <span className="k">Login per Reown</span>
                      <span className="v" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {w.slice(0, 10)}…{w.slice(-6)}
                      </span>
                    </div>
                  ))}
                  <div className="stat">
                    <span className="k">Plan</span>
                    <span className="v">{tier}</span>
                  </div>
                  <div className="stat">
                    <span className="k">Speicher</span>
                    <span className="v">
                      {formatBytes(account.usedBytes)} von {formatBytes(account.quotaBytes)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">Dateien · Einträge</span>
                    <span className="v">
                      {vault.files.length} · {vault.secrets.length}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">Mitglied seit</span>
                    <span className="v">{new Date(account.createdAt).toLocaleDateString('de-CH')}</span>
                  </div>
                </div>
                <StorageOptions />
              </div>
              <div className="grid2">
                <ChangePassphraseCard />
                <div className="card">
                  <h3>Sicherheit</h3>
                  <p className="dim">
                    Deine Dateien werden im Browser mit AES-256-GCM verschlüsselt. Der Master-Key ist zufällig und nur doppelt
                    gewrappt gespeichert: mit deiner Passphrase (Argon2id) und mit deinem Recovery-Kit. FocVault und Fil One sehen
                    ausschließlich verschlüsselte Daten – keine Dateinamen, keine Inhalte.
                  </p>
                  <div className="stat">
                    <span className="k">Schlüsselableitung</span>
                    <span className="v">
                      Argon2id · {Math.round(account.kdf.m / 1024)} MiB · t={account.kdf.t}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">Auto-Sperre</span>
                    <span className="v">nach 30 Min. Inaktivität</span>
                  </div>
                  <div className="stat">
                    <span className="k">Recovery-Kit</span>
                    <span className="v">bei Registrierung erstellt · neu erzeugen folgt in Phase 2</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
