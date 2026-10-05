'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi'
import { api, errorMessage, type FocAdminStatus, type FocSettings } from '@/features/api/client'
import {
  CHAIN_ID,
  allowancesFor,
  authorizeSessionKey,
  deposit,
  depositAndApprove,
  withdraw,
  type Network
} from '@/features/foc/wallet'
import { formatBytes } from '@/lib/vault'

const usd = (n: number | undefined | null, d = 2) => (n === undefined || n === null ? '–' : `${n.toFixed(d)} USDFC`)
const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '–')
const LEVEL: Record<FocAdminStatus['health']['level'], { cls: string; label: string }> = {
  off: { cls: '', label: 'Aus' },
  ok: { cls: 'ok', label: 'In Ordnung' },
  warn: { cls: 'warn', label: 'Nachladen' },
  critical: { cls: 'bad', label: 'Kritisch' },
  unknown: { cls: 'warn', label: 'Unbekannt' }
}

/**
 * Filecoin Onchain Cloud: Einrichtung mit der Betreiber-Wallet (MetaMask) und Live-Betrieb.
 * Ablauf: Netz + Wallet → USDFC einzahlen & Speicherdienst freigeben → Server-Schlüssel
 * autorisieren → einschalten. Danach sichert der Server alle Dateien gebündelt auf Filecoin.
 */
export default function FocPanel() {
  const [st, setSt] = useState<FocAdminStatus | null>(null)
  const [form, setForm] = useState<FocSettings | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState(20)
  const [budgetTib, setBudgetTib] = useState(1)
  const [days, setDays] = useState(180)

  const { address, chainId, connector, isConnected } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { data: wallet } = useWalletClient()

  const load = useCallback(async () => {
    try {
      const s = await api.adminFoc()
      setSt(s)
      setForm(s.settings)
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setMsg(null)
    try {
      const text = await fn()
      setMsg({ ok: true, text: text || 'Erledigt.' })
      await load()
    } catch (e) {
      const t = (e as Error)?.message ?? ''
      setMsg({ ok: false, text: /reject|denied|abgelehnt/i.test(t) ? 'In der Wallet abgelehnt.' : errorMessage(e, t.split('\n')[0].slice(0, 240)) })
    } finally {
      setBusy(null)
    }
  }

  if (!st || !form) return msg ? <div className="errorbox">{msg.text}</div> : <div className="card">Lade …</div>

  const network = form.network as Network
  const onChain = chainId === CHAIN_ID[network]
  const walletMatches = !!address && !!form.payer && address.toLowerCase() === form.payer.toLowerCase()
  const c = st.chain
  const a = allowancesFor(budgetTib, form.copies)
  const lvl = LEVEL[st.health.level]

  const save = (next: FocSettings, text = 'Gespeichert.') => run('save', async () => {
    await api.adminSaveFoc(next)
    return text
  })

  const connectMetaMask = () =>
    run('connect', async () => {
      const preferred =
        connectors.find(x => x.id === 'io.metamask') ??
        connectors.find(x => x.id === 'metaMaskSDK') ??
        connectors.find(x => x.id === 'injected') ??
        connectors.find(x => x.type === 'injected')
      if (!preferred) throw new Error('Keine Browser-Wallet gefunden. Bitte MetaMask installieren.')
      if (isConnected) await disconnectAsync()
      await connectAsync({ connector: preferred, chainId: CHAIN_ID[network] })
      return 'Wallet verbunden.'
    })

  const needWallet = !wallet || !onChain
  const ensureChain = async () => {
    if (!onChain) await switchChainAsync({ chainId: CHAIN_ID[network] })
  }

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}

      <div className="card">
        <h3>
          Filecoin Onchain Cloud <span>verifizierbarer Speicher, bezahlt mit USDFC</span>
        </h3>
        <div className="admintiles">
          <div className="admintile">
            <span className="k">Status</span>
            <span className={`v health ${lvl.cls}`}>{lvl.label}</span>
            <span className="hint">{st.health.message}</span>
          </div>
          <div className="admintile">
            <span className="k">Guthaben Filecoin Pay</span>
            <span className="v">{usd(c.account?.funds)}</span>
            <span className="hint">frei {usd(c.account?.available)} · Reserve {usd(c.account?.lockup)}</span>
          </div>
          <div className="admintile">
            <span className="k">Kosten</span>
            <span className="v">{usd(c.account?.perMonth)}</span>
            <span className="hint">pro Monat · reicht {c.account?.runwayDays === null ? '∞' : `${c.account?.runwayDays ?? '–'} Tage`}</span>
          </div>
          <div className="admintile">
            <span className="k">Auf Filecoin gesichert</span>
            <span className="v">{formatBytes(st.stats.liveBytes)}</span>
            <span className="hint">
              {st.stats.liveKeys} Teile · wartet {formatBytes(st.stats.backlog.bytes)}
              {st.stats.superSafe.keys > 0 && ` · Super Safe (${st.stats.superSafe.target} Kopien) wartet ${formatBytes(st.stats.superSafe.bytes)}`}
            </span>
          </div>
        </div>
        {c.error && <div className="errorbox" style={{ marginTop: 12 }}>{c.error}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="small" disabled={!!busy || !form.enabled} onClick={() => run('sync', async () => (await api.adminFocSync()).message)}>
            {busy === 'sync' ? 'Sichere …' : 'Jetzt sichern'}
          </button>
          <button className="small" disabled={!!busy} onClick={() => void load()}>
            Aktualisieren
          </button>
          {st.lastRun && (
            <span className="hint" style={st.lastRun.ok ? undefined : { color: 'var(--red)' }}>
              Letzter Lauf {new Date(st.lastRun.at).toLocaleString('de-CH')}: {st.lastRun.message}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <h3>
          1 · Netz und zahlende Wallet <span>das USDFC bleibt in deiner Wallet bzw. in Filecoin Pay</span>
        </h3>
        <div className="formgrid">
          <label className="field">
            <span>Netz</span>
            <select value={form.network} disabled={form.enabled} onChange={e => setForm({ ...form, network: e.target.value as Network })}>
              <option value="calibration">Calibration (Testnetz, kostenlos)</option>
              <option value="mainnet">Mainnet (echtes USDFC)</option>
            </select>
          </label>
          <div className="field">
            <span>Verbundene Wallet</span>
            <div className="row">
              <span className="mono">{address ? `${short(address)} · ${connector?.name ?? ''}` : 'keine'}</span>
              <button className="small" disabled={!!busy} onClick={connectMetaMask}>
                {isConnected ? 'Andere Wallet' : 'MetaMask verbinden'}
              </button>
              {isConnected && !onChain && (
                <button className="small" disabled={!!busy} onClick={() => run('chain', async () => void (await ensureChain()))}>
                  Zu {network === 'mainnet' ? 'Filecoin Mainnet' : 'Calibration'} wechseln
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="row">
          <span className="hint">
            Zahlende Wallet: <span className="mono">{form.payer || 'nicht festgelegt'}</span>
            {c.wallet && ` · in der Wallet: ${usd(c.wallet.usdfc)} · ${c.wallet.fil.toFixed(3)} FIL (für Gebühren)`}
          </span>
          {address && !walletMatches && (
            <button className="small primary" disabled={!!busy || form.enabled} onClick={() => save({ ...form, payer: address }, 'Wallet als Zahler hinterlegt.')}>
              Diese Wallet als Zahler verwenden
            </button>
          )}
        </div>
        {form.network === 'calibration' && (
          <p className="hint">
            Test-Guthaben: tFIL über den{' '}
            <a href="https://faucet.calibnet.chainsafe-fil.io/funds.html" target="_blank" rel="noreferrer">
              Calibration-Faucet
            </a>
            , tUSDFC über den{' '}
            <a href="https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc" target="_blank" rel="noreferrer">
              USDFC-Faucet
            </a>
            .
          </p>
        )}
      </div>

      <div className="card">
        <h3>
          2 · USDFC einzahlen und Speicherdienst freigeben <span>eine Transaktion, in MetaMask bestätigen</span>
        </h3>
        <div className="formgrid">
          <label className="field">
            <span>Einzahlung (USDFC)</span>
            <input type="number" min={1} step={1} value={amount} onChange={e => setAmount(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Speicherbudget (TiB)</span>
            <input type="number" min={0.1} step={0.5} value={budgetTib} onChange={e => setBudgetTib(Number(e.target.value))} />
          </label>
        </div>
        <p className="hint">
          Obergrenze für den Speicherdienst: höchstens {a.monthlyUsd.toFixed(2)} USDFC pro Monat ({budgetTib} TiB × {form.copies} Kopien × 2.50 $ + 0.12 $ je
          Datensatz). Mehr kann er nicht abbuchen, auch wenn mehr eingezahlt ist. Aktuelle Freigabe:{' '}
          {c.approval?.approved ? `${usd(c.approval.rateAllowancePerMonth)} / Monat, Reserve bis ${usd(c.approval.lockupAllowance)}` : 'keine'}.
        </p>
        <div className="row">
          <button
            className="primary small"
            disabled={!!busy || needWallet || !walletMatches || amount <= 0}
            onClick={() => run('deposit', async () => {
              await depositAndApprove(wallet!, network, amount, budgetTib, form.copies)
              return `${amount} USDFC eingezahlt, Speicherdienst freigegeben.`
            })}
          >
            {busy === 'deposit' ? 'Bitte in MetaMask bestätigen …' : 'Einzahlen & freigeben'}
          </button>
          <button
            className="small"
            disabled={!!busy || needWallet || !walletMatches || amount <= 0}
            onClick={() => run('topup', async () => {
              await deposit(wallet!, network, amount)
              return `${amount} USDFC nachgeladen.`
            })}
          >
            Nur nachladen
          </button>
          <button
            className="small"
            disabled={!!busy || needWallet || !walletMatches || !c.account || c.account.available <= 0}
            onClick={() => run('withdraw', async () => {
              const v = Math.floor((c.account!.available) * 100) / 100
              await withdraw(wallet!, network, v)
              return `${v} USDFC zurück in die Wallet.`
            })}
          >
            Freies Guthaben auszahlen
          </button>
        </div>
        {!walletMatches && <p className="hint">Zuerst die zahlende Wallet verbinden (Schritt 1).</p>}
      </div>

      <div className="card">
        <h3>
          3 · Server-Schlüssel autorisieren <span>darf speichern und löschen – nicht an dein Guthaben</span>
        </h3>
        <p className="hint">
          Der Server erzeugt einen eigenen Schlüssel; der private Teil verlässt den Server nie. Deine Wallet erlaubt ihm befristet genau vier Aktionen: Datensatz
          anlegen, Pieces hinzufügen, Pieces entfernen, Datensatz beenden. Auszahlungen oder Überweisungen kann er nicht auslösen.
        </p>
        <div className="row">
          <span className="mono">{c.sessionKey ? short(c.sessionKey.address) : 'noch keiner'}</span>
          {c.sessionKey && (
            <span className={`badge ${c.sessionKey.authorized ? 'ok' : ''}`}>
              {c.sessionKey.authorized ? `autorisiert bis ${new Date(c.sessionKey.expiresAt!).toLocaleDateString('de-CH')}` : 'nicht autorisiert'}
            </span>
          )}
          <button className="small" disabled={!!busy || form.enabled} onClick={() => run('key', async () => `Neuer Schlüssel ${short((await api.adminFocSessionKey(network)).address)}.`)}>
            {c.sessionKey ? 'Neu erzeugen' : 'Schlüssel erzeugen'}
          </button>
        </div>
        <div className="formgrid">
          <label className="field">
            <span>Gültig für (Tage)</span>
            <input type="number" min={1} max={730} value={days} onChange={e => setDays(Number(e.target.value))} />
          </label>
        </div>
        <button
          className="primary small"
          disabled={!!busy || needWallet || !walletMatches || !c.sessionKey}
          onClick={() => run('auth', async () => {
            await authorizeSessionKey(wallet!, network, c.sessionKey!.address as `0x${string}`, days)
            return 'Server-Schlüssel autorisiert.'
          })}
        >
          {busy === 'auth' ? 'Bitte in MetaMask bestätigen …' : 'In MetaMask autorisieren'}
        </button>
      </div>

      <div className="card">
        <h3>
          4 · Betrieb <span>Bündelung, Kopien, Warnschwellen</span>
        </h3>
        <div className="formgrid">
          <label className="field">
            <span>Kopien bei unabhängigen Anbietern</span>
            <input type="number" min={1} max={10} value={form.copies} onChange={e => setForm({ ...form, copies: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Paket hochladen ab (MiB)</span>
            <input type="number" min={1} value={form.packMinMb} onChange={e => setForm({ ...form, packMinMb: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Paket höchstens (MiB)</span>
            <input type="number" min={8} max={1000} value={form.packMaxMb} onChange={e => setForm({ ...form, packMaxMb: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>spätestens nach (Stunden)</span>
            <input type="number" min={0} value={form.packMaxWaitHours} onChange={e => setForm({ ...form, packMaxWaitHours: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Warnen unter (Tage Guthaben)</span>
            <input type="number" min={1} value={form.warnRunwayDays} onChange={e => setForm({ ...form, warnRunwayDays: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Uploads stoppen unter (Tage)</span>
            <input type="number" min={0} value={form.blockRunwayDays} onChange={e => setForm({ ...form, blockRunwayDays: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Schnelle Kopie entfernen nach (Stunden, leer = behalten)</span>
            <input
              type="number"
              min={1}
              value={form.evictAfterHours ?? ''}
              onChange={e => setForm({ ...form, evictAfterHours: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="hint">
          FOC berechnet pro hochgeladenem Piece eine kleine Gebühr (0.003 $ + 0.008 $ je Vorgang) – deshalb bündeln wir viele verschlüsselte Teile zu einem Paket.
          Alle Nutzer teilen sich {form.copies} Datensätze (0.12 $/Monat je Datensatz statt pro Konto). Ohne schnelle Kopie wird direkt von den Filecoin-Anbietern
          gelesen: günstiger, aber langsamer.
        </p>
        <div className="row">
          <button className="small" disabled={!!busy} onClick={() => save(form)}>
            Einstellungen speichern
          </button>
          {form.enabled ? (
            <button className="small" disabled={!!busy} onClick={() => save({ ...form, enabled: false }, 'Filecoin-Sicherung pausiert.')}>
              Ausschalten
            </button>
          ) : (
            <button
              className="primary small"
              disabled={!!busy || !form.payer || !c.sessionKey?.authorized || !c.approval?.approved}
              onClick={() => save({ ...form, enabled: true }, 'Filecoin-Sicherung eingeschaltet – der erste Abgleich startet in wenigen Minuten.')}
            >
              Einschalten
            </button>
          )}
        </div>
        {!form.enabled && (!c.sessionKey?.authorized || !c.approval?.approved) && (
          <p className="hint">Einschalten geht, sobald Schritt 2 (Freigabe) und Schritt 3 (Schlüssel) erledigt sind.</p>
        )}
        <p className="hint">
          {st.dataSets.length > 0 && (
            <>
              Datensätze:{' '}
              {st.dataSets.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <a href={`https://pdp.filecoin.cloud/${form.network}/dataset/${id}`} target="_blank" rel="noreferrer">
                    #{id} ↗
                  </a>
                </span>
              ))}{' '}
              ·{' '}
            </>
          )}
          <a href={`https://pdp.filecoin.cloud/${form.network}`} target="_blank" rel="noreferrer">
            PDP-Explorer ↗
          </a>{' '}
          ·{' '}
          <a href={`https://pay.filecoin.cloud/${form.network}`} target="_blank" rel="noreferrer">
            Filecoin-Pay-Explorer ↗
          </a>
        </p>
      </div>
    </>
  )
}
