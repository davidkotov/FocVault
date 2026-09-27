'use client'

import { useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { deriveFromPassphrase, unwrapMasterKeyRaw, wrapMasterKey } from '@/features/keys/kdf'
import { createPasskey, deviceLabel, passkeyKek, passkeySupported } from '@/features/keys/passkey'
import { appMessages } from '@/lib/i18n/messages/app'

/** Passkeys verwalten: einrichten (mit Passphrase bestätigen), auflisten, entfernen. */
export default function PasskeysPanel() {
  const t = useMessages(appMessages)
  const m = t.passkeys
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const { account, refreshAccount } = useAccount()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState(deviceLabel())
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [remove, setRemove] = useState<{ id: string; label: string } | null>(null)
  if (!account) return null
  const supported = passkeySupported()

  const add = async () => {
    setBusy(true)
    setMsg(null)
    let raw: Uint8Array | null = null
    try {
      const env = account.envelopes.find(e => e.kekType === 'passphrase')!
      const { kek } = await deriveFromPassphrase(pass, account.kdf)
      raw = await unwrapMasterKeyRaw(env, kek)
      const pk = await createPasskey({ id: account.id, name: account.label })
      try {
        const wrapped = await wrapMasterKey(raw as Uint8Array<ArrayBuffer>, await passkeyKek(pk.prf, pk.credentialId), 'passkey')
        await api.addPasskey({ credentialId: pk.credentialId, label: label.trim() || deviceLabel(), salt: pk.salt, iv: wrapped.iv, cipher: wrapped.cipher })
      } finally {
        pk.prf.fill(0)
      }
      await refreshAccount()
      setAdding(false)
      setPass('')
      setMsg({ ok: true, text: m.added })
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      raw?.fill(0)
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3>
        {m.title} <span>{account.passkeys.length}</span>
      </h3>
      <p className="dim">{m.lead}</p>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      {!supported && <div className="errorbox">{m.unsupported}</div>}

      <div className="trashlist">
        {account.passkeys.length === 0 && <span className="hint">{m.none}</span>}
        {account.passkeys.map(p => (
          <div className="trashrow" key={p.credentialId}>
            <div className="trashinfo">
              <strong>🔑 {p.label}</strong>
              <span className="hint">{fmt(m.since, { date: fmtDate(p.createdAt) })}</span>
            </div>
            <button className="small danger" onClick={() => setRemove({ id: p.credentialId, label: p.label })}>
              {m.remove}
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <form
          className="passkeyform"
          onSubmit={e => {
            e.preventDefault()
            if (pass && !busy) void add()
          }}
        >
          <div className="formgrid">
            <label className="field">
              <span>{m.name}</span>
              <input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
            </label>
            <label className="field">
              <span>{m.confirm}</span>
              <input type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <button className="primary small" type="submit" disabled={!pass || busy}>
              {busy ? m.adding : m.save}
            </button>
            <button className="small" type="button" disabled={busy} onClick={() => setAdding(false)}>
              {m.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button className="primary small" style={{ marginTop: 14 }} disabled={!supported} onClick={() => setAdding(true)}>
          + {m.add}
        </button>
      )}

      {remove && (
        <ConfirmDialog
          title={`${m.remove}: ${remove.label}?`}
          body={m.removeBody}
          confirmLabel={m.remove}
          cancelLabel={m.cancel}
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            const r = remove
            setRemove(null)
            try {
              await api.removePasskey(r.id)
              await refreshAccount()
              setMsg({ ok: true, text: m.removed })
            } catch (e) {
              setMsg({ ok: false, text: errText(e) })
            }
          }}
        />
      )}
    </div>
  )
}
