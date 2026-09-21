'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { isSupportedChain } from '@/lib/chains'
import { formatBytes } from '@/lib/vault'
import { downloadSharedFile, isShareExpired, openShare, type ShareRecord } from '@/lib/share'
import WalletBar from '@/components/WalletBar'

type Phase = 'init' | 'needWallet' | 'loading' | 'ready' | 'expired' | 'downloading' | 'error'

export default function SharePage() {
  const params = useParams()
  const pieceCid = typeof params.cid === 'string' ? params.cid : ''
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()

  const [linkKey, setLinkKey] = useState<string | null>(null)
  const [record, setRecord] = useState<ShareRecord | null>(null)
  const [phase, setPhase] = useState<Phase>('init')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '').trim()
    if (h) {
      setLinkKey(h)
      setPhase('needWallet')
    } else {
      setError('Kein Schlüssel im Link – der Link ist unvollständig.')
      setPhase('error')
    }
  }, [])

  const load = useCallback(async () => {
    if (!walletClient || !linkKey || !pieceCid) return
    setPhase('loading')
    setError(null)
    try {
      const rec = await openShare(walletClient, pieceCid, linkKey)
      if (isShareExpired(rec)) {
        setRecord(rec)
        setPhase('expired')
      } else {
        setRecord(rec)
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

  const download = async () => {
    if (!walletClient || !record) return
    setPhase('downloading')
    setError(null)
    try {
      await downloadSharedFile(walletClient, record)
      setPhase('ready')
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Download fehlgeschlagen.')
      setPhase('ready')
    }
  }

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

      {record && (phase === 'ready' || phase === 'downloading' || phase === 'expired') && (
        <div className="card">
          <h3>
            {phase === 'expired' ? 'Link abgelaufen' : 'Datei erhalten'}
            {phase !== 'expired' && (
              <span className={`badge ${phase === 'ready' ? 'ok' : ''}`}>
                {phase === 'downloading' ? 'lädt…' : 'entschlüsselbar'}
              </span>
            )}
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
          {phase !== 'expired' ? (
            <div className="row" style={{ marginTop: 16 }}>
              <button className="primary" disabled={phase === 'downloading' || !walletClient} onClick={() => void download()}>
                {phase === 'downloading' ? 'Entschlüsselt & lädt…' : 'Entschlüsseln & herunterladen'}
              </button>
            </div>
          ) : (
            <p className="dim" style={{ marginTop: 12 }}>
              Dieser Share-Link ist nicht mehr gültig. Bitte um einen neuen Link beim Absender.
            </p>
          )}
          <p className="dim" style={{ marginTop: 12 }}>
            Entschlüsselung passiert lokal in deinem Browser – der Schlüssel aus dem Link
            verlässt dein Gerät nicht.
          </p>
        </div>
      )}

      <footer className="footer">
        FocVault Secure Send · Zero-Knowledge · Key via URL-Fragment (#), nie serverseitig
      </footer>
    </main>
  )
}
