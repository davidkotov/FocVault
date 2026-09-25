'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { isSupportedChain } from '@/lib/chains'
import { formatBytes } from '@/lib/vault'
import { downloadSharedFile, isShareExpired, openShare, type ShareRecord } from '@/lib/share'
import {
  decodeShareFragment,
  deriveSharePasswordKey,
  toB64Url,
  unwrapLinkKeyWithPassword,
  type ShareFragment
} from '@/lib/crypto'
import WalletBar from '@/components/WalletBar'

type Phase =
  | 'init'
  | 'password'
  | 'needWallet'
  | 'loading'
  | 'ready'
  | 'expired'
  | 'burned'
  | 'exhausted'
  | 'downloading'
  | 'error'

/**
 * Secure Send v2: burnAfterUse / maxUses werden client-seitig "best effort" über
 * localStorage durchgesetzt – ohne Backend ist das pro Gerät/Profil, nicht global.
 * Ein Browser ohne localStorage (Privacy Mode) fällt auf reine Best-Effort-Durchsetzung
 * zurück; die globale Durchsetzung folgt mit T7/T13 (Backend).
 */
const USE_COUNT_KEY = 'focvault:share:uses:'

function readUseCount(cid: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(USE_COUNT_KEY + cid)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function bumpUseCount(cid: string): number {
  const next = readUseCount(cid) + 1
  try {
    window.localStorage.setItem(USE_COUNT_KEY + cid, String(next))
  } catch {
    /* localStorage nicht verfügbar → nur best effort */
  }
  return next
}

export default function SharePage() {
  const params = useParams()
  const pieceCid = typeof params.cid === 'string' ? params.cid : ''
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()

  const [fragment, setFragment] = useState<ShareFragment | null>(null)
  const [linkKey, setLinkKey] = useState<string | null>(null)
  const [record, setRecord] = useState<ShareRecord | null>(null)
  const [phase, setPhase] = useState<Phase>('init')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  // 1) Fragment aus dem URL-Hash dekodieren (legacy-bare / s. / p.)
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '').trim()
    if (!raw) {
      setError('Kein Schlüssel im Link – der Link ist unvollständig.')
      setPhase('error')
      return
    }
    try {
      const frag = decodeShareFragment(raw)
      setFragment(frag)
      if (frag.kind === 'password') {
        setPhase('password')
      } else {
        // bare (legacy) und key (s.) liefern den Link-Key direkt.
        setLinkKey(toB64Url(frag.linkKey))
        setPhase('needWallet')
      }
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Der Link ist beschädigt.')
      setPhase('error')
    }
  }, [])

  // 2) Passwortgeschützten Link-Key entsperren (PBKDF2 → AES-GCM-Key-Unwrap)
  const unlock = useCallback(async () => {
    if (!fragment || fragment.kind !== 'password' || !password) return
    setUnlocking(true)
    setError(null)
    try {
      const pwdKey = await deriveSharePasswordKey(password, fragment.salt)
      const rawLinkKey = await unwrapLinkKeyWithPassword(pwdKey, fragment.iv, fragment.cipher)
      setLinkKey(toB64Url(rawLinkKey))
      setPhase('needWallet')
    } catch {
      setError('Passwort ist falsch oder der Link ist beschädigt.')
      setPhase('password')
    } finally {
      setUnlocking(false)
    }
  }, [fragment, password])

  // 3) Wallet + Netz → Share öffnen (Record kommt aus dem verschlüsselten Container)
  const load = useCallback(async () => {
    if (!walletClient || !linkKey || !pieceCid) return
    setPhase('loading')
    setError(null)
    try {
      const rec = await openShare(walletClient, pieceCid, linkKey)
      setRecord(rec)
      if (isShareExpired(rec)) {
        setPhase('expired')
        return
      }
      // best-effort clientseitige Durchsetzung von burnAfterUse / maxUses
      const used = readUseCount(pieceCid)
      if (rec.burnAfterUse && used >= 1) {
        setPhase('burned')
      } else if (rec.maxUses && used >= rec.maxUses) {
        setPhase('exhausted')
      } else {
        setPhase('ready')
      }
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Share konnte nicht geladen werden.')
      setPhase('error')
    }
  }, [walletClient, linkKey, pieceCid])

  useEffect(() => {
    if (phase === 'needWallet' && isConnected && isSupportedChain(chainId) && walletClient) {
      void load()
    }
  }, [phase, isConnected, chainId, walletClient, load])

  // 4) Download → nach erfolgreichem Download Use-Counter hochzählen
  const download = async () => {
    if (!walletClient || !record) return
    setPhase('downloading')
    setError(null)
    try {
      await downloadSharedFile(walletClient, record)
      const used = bumpUseCount(pieceCid)
      if (record.burnAfterUse) {
        setPhase('burned')
      } else if (record.maxUses && used >= record.maxUses) {
        setPhase('exhausted')
      } else {
        setPhase('ready')
      }
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Download fehlgeschlagen.')
      setPhase('ready')
    }
  }

  const recordCard = record && (
    <div className="card">
      <h3>
        {phase === 'expired'
          ? 'Link abgelaufen'
          : phase === 'burned'
            ? 'Einmal-Link verbraucht'
            : phase === 'exhausted'
              ? 'Download-Limit erreicht'
              : 'Datei erhalten'}
        {phase === 'ready' || phase === 'downloading' ? (
          <span className={`badge ${phase === 'ready' ? 'ok' : ''}`}>
            {phase === 'downloading' ? 'lädt…' : 'entschlüsselbar'}
          </span>
        ) : null}
      </h3>
      <div className="stat">
        <span className="k">Datei</span>
        <span className="v">{record.name}</span>
      </div>
      <div className="stat">
        <span className="k">Größe</span>
        <span className="v">{formatBytes(record.size)}</span>
      </div>
      <div className="stat">
        <span className="k">Gültig bis</span>
        <span className="v">{new Date(record.expiresAt).toLocaleString('de-DE')}</span>
      </div>
      <div className="stat">
        <span className="k">Chunks</span>
        <span className="v">{record.chunks.length}</span>
      </div>
      {(record.burnAfterUse || record.maxUses) && phase !== 'expired' ? (
        <p className="dim" style={{ marginTop: 12 }}>
          {record.burnAfterUse
            ? 'Einmal-Link: Dieser Download verbraucht den Link auf diesem Gerät.'
            : `Max. ${record.maxUses} Downloads (gerätebasiert).`}
        </p>
      ) : null}
      {phase === 'ready' || phase === 'downloading' ? (
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="primary"
            disabled={phase === 'downloading' || !walletClient}
            onClick={() => void download()}
          >
            {phase === 'downloading' ? 'Entschlüsselt & lädt…' : 'Entschlüsseln & herunterladen'}
          </button>
        </div>
      ) : phase === 'expired' ? (
        <p className="dim" style={{ marginTop: 12 }}>
          Dieser Share-Link ist nicht mehr gültig. Bitte um einen neuen Link beim Absender.
        </p>
      ) : phase === 'burned' ? (
        <p className="dim" style={{ marginTop: 12 }}>
          Dieser Einmal-Link wurde auf diesem Gerät bereits verwendet. Bitte um einen neuen Link
          beim Absender.
        </p>
      ) : phase === 'exhausted' ? (
        <p className="dim" style={{ marginTop: 12 }}>
          Das Download-Limit für diesen Link ist auf diesem Gerät erreicht.
        </p>
      ) : null}
      {(record.burnAfterUse || record.maxUses) ? (
        <p className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Einmal-/Limit-Durchsetzung erfolgt derzeit clientseitig pro Gerät (best effort). Die
          globale Durchsetzung folgt mit dem Backend (T7/T13).
        </p>
      ) : null}
      <p className="dim" style={{ marginTop: 12 }}>
        Entschlüsselung passiert lokal in deinem Browser – der Schlüssel aus dem Link
        verlässt dein Gerät nicht.
      </p>
    </div>
  )

  return (
    <main style={{ maxWidth: 620 }}>
      <header className="site">
        <div className="brand">
          <h1>Foc<span>Vault</span></h1>
          <p>Secure Send – verschlüsselte Datei-Freigabe</p>
        </div>
        <WalletBar />
      </header>

      {error && <div className="errorbox">{error}</div>}

      {phase === 'error' && !isConnected && (
        <div className="card">
          <p className="dim">Wallet verbinden und erneut versuchen.</p>
        </div>
      )}

      {phase === 'password' && (
        <div className="card">
          <h3>Passwortgeschützter Link</h3>
          <p className="dim">
            Dieser Secure-Send-Link ist mit einem Passwort geschützt. Bitte gib es ein, um den
            Schlüssel zu entsperren.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <input
              type="password"
              value={password}
              autoFocus
              placeholder="Passwort"
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void unlock()
              }}
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={!password || unlocking}
              onClick={() => void unlock()}
            >
              {unlocking ? 'Entsperrt…' : 'Entsperren'}
            </button>
          </div>
          <p className="dim" style={{ marginTop: 12 }}>
            Das Passwort verlässt dein Gerät nicht – die Entschlüsselung passiert lokal.
          </p>
        </div>
      )}

      {phase === 'needWallet' && !isConnected && (
        <div className="card">
          <h3>Datei abrufen</h3>
          <p className="dim">
            Jede beliebige Wallet genügt (z.B. MetaMask) – sie wird nur zum Abrufen des
            verschlüsselten Pieces gebraucht. Kein Konto, keine Zahlung, keine Transaktion.
          </p>
        </div>
      )}

      {phase === 'needWallet' && isConnected && !isSupportedChain(chainId) && (
        <div className="notice">
          Wechsle zu Filecoin Calibration (Testnet), um die Datei abzurufen.
        </div>
      )}

      {phase === 'loading' && (
        <div className="card">
          <h3>Lade Share…</h3>
          <p className="dim">Verschlüsselten Datensatz von Filecoin abrufen.</p>
        </div>
      )}

      {recordCard}

      <footer className="footer">
        FocVault Secure Send · Zero-Knowledge · Key via URL-Fragment (#), nie serverseitig
      </footer>
    </main>
  )
}
