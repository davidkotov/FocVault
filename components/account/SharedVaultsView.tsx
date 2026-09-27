'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import NotesPanel from '@/components/NotesPanel'
import PasswordsPanel from '@/components/PasswordsPanel'
import TotpPanel from '@/components/TotpPanel'
import { Icon } from '@/components/site/Icons'
import { useAccount } from '@/features/account/AccountProvider'
import { api, type VaultAuditEvent, type VaultRole } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { SharedVaultsClient, type OpenVault } from '@/features/vaults/client'
import { vaultsMessages } from '@/lib/i18n/messages/vaults'
import type { SecretEntry, SecretKind } from '@/lib/vault'

type Tab = 'passwords' | 'notes' | 'totp' | 'people' | 'audit'
const ROLES: VaultRole[] = ['view', 'edit', 'manage']
const KIND: Record<'passwords' | 'notes' | 'totp', SecretKind> = { passwords: 'password', notes: 'note', totp: 'totp' }

/** Geteilte Tresore (Business): Liste, Tresor mit Passwörtern/Notizen/2FA, Personen und Protokoll. */
export default function SharedVaultsView() {
  const m = useMessages(vaultsMessages)
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const { vault, mutate } = useAccount()
  const familyKeyRef = useRef(vault.familyKey)
  familyKeyRef.current = vault.familyKey
  const client = useRef<SharedVaultsClient | null>(null)
  if (!client.current) {
    client.current = new SharedVaultsClient(
      () => familyKeyRef.current,
      k => mutate(c => (c.familyKey ? c : { ...c, familyKey: k }))
    )
  }
  const c = client.current
  const [loaded, setLoaded] = useState(false)
  const [vaults, setVaults] = useState<OpenVault[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('passwords')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null)
  const [addId, setAddId] = useState('')
  const [addRole, setAddRole] = useState<VaultRole>('view')
  const [copyId, setCopyId] = useState('')
  const [audit, setAudit] = useState<VaultAuditEvent[] | null>(null)

  const sync = useCallback(() => setVaults([...c.vaults]), [c])
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null)
      setBusy(true)
      try {
        await fn()
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusy(false)
        sync()
      }
    },
    [errText, sync]
  )

  useEffect(() => {
    void run(() => c.load()).then(() => setLoaded(true))
  }, [c, run])

  const current = vaults.find(v => v.id === openId) ?? null
  const me = c.overview?.me

  useEffect(() => {
    if (tab !== 'audit' || !current || current.role !== 'manage') return
    setAudit(null)
    api
      .vaultAudit(current.id)
      .then(r => setAudit(r.events))
      .catch(e => setError(errText(e)))
  }, [tab, current?.id, current?.role, current?.state.version, current?.state.members.length, errText]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) {
    return (
      <div className="card">
        <p className="dim">{m.loading}</p>
        {error && <div className="errorbox">{error}</div>}
      </div>
    )
  }

  // ---------- Liste ----------
  if (!current) {
    return (
      <div className="card">
        <h3>
          {m.title} <span>{m.badge}</span>
        </h3>
        <p className="dim">{m.lead}</p>
        {error && <div className="errorbox">{error}</div>}
        <form
          className="row vaultcreate"
          onSubmit={e => {
            e.preventDefault()
            const n = name.trim()
            if (!n) return
            void run(async () => {
              const id = await c.create(n)
              setName('')
              setOpenId(id)
              setTab('passwords')
            })
          }}
        >
          <input value={name} onChange={e => setName(e.target.value)} placeholder={m.newPlaceholder} aria-label={m.newName} maxLength={80} />
          <button className="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? m.creating : m.create}
          </button>
        </form>
        {vaults.length === 0 && <p className="dim">{m.empty}</p>}
        <div className="vaultlist">
          {vaults.map(v => (
            <button key={v.id} type="button" className="vaultrow" onClick={() => (setOpenId(v.id), setTab('passwords'), setAudit(null))}>
              <span className="vaulticon" aria-hidden="true">
                <Icon name="vault" size={20} />
              </span>
              <span className="vaultmain">
                <strong>{v.data ? v.data.name || '—' : m.waiting}</strong>
                <span className="hint">
                  {v.data ? `${fmt(m.items, { n: v.data.secrets.length })} · ` : ''}
                  {fmt(m.people, { n: v.state.members.length })}
                </span>
              </span>
              <span className={`badge role-${v.role}`}>{m.roles[v.role]}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ---------- Tresor ----------
  const role = current.role
  const canEdit = role !== 'view'
  const manage = role === 'manage'
  const data = current.data
  const secrets = data?.secrets ?? []
  const of = (k: SecretKind) => secrets.filter(s => s.kind === k)
  const members = current.state.members
  const addable = (c.overview?.team ?? []).filter(t => !members.some(x => x.accountId === t.accountId))
  const managers = members.filter(x => x.role === 'manage').length
  const lastManager = manage && managers <= 1
  const mineOfKind = tab === 'passwords' || tab === 'notes' || tab === 'totp' ? vault.secrets.filter(s => s.kind === KIND[tab]) : []

  const save = (s: SecretEntry) => void run(() => c.saveSecret(current.id, s))
  const del = (id: string) => void run(() => c.deleteSecret(current.id, id))

  return (
    <div className="vaultsplit">
      <aside className="vaultside">
        {vaults.map(v => (
          <button key={v.id} type="button" className={`vaultrow${v.id === current.id ? ' on' : ''}`} onClick={() => (setOpenId(v.id), setTab('passwords'), setAudit(null))}>
            <span className="vaulticon" aria-hidden="true">
              <Icon name="vault" size={18} />
            </span>
            <span className="vaultmain">
              <strong>{v.data ? v.data.name || '—' : m.waiting}</strong>
              <span className="hint">
                {v.data ? `${fmt(m.items, { n: v.data.secrets.length })} · ` : ''}
                {fmt(m.people, { n: v.state.members.length })}
              </span>
            </span>
            <span className={`badge role-${v.role}`}>{m.roles[v.role]}</span>
          </button>
        ))}
      </aside>
      <div className="vaultmaincol">
      <div className="card">
        <div className="vaulthead">
          <button className="small" onClick={() => setOpenId(null)}>
            {m.back}
          </button>
          <span className={`badge role-${role}`}>{m.roles[role]}</span>
        </div>
        {renaming !== null ? (
          <form
            className="row vaultcreate"
            onSubmit={e => {
              e.preventDefault()
              if (renaming.trim()) void run(() => c.rename(current.id, renaming.trim())).then(() => setRenaming(null))
            }}
          >
            <input value={renaming} onChange={e => setRenaming(e.target.value)} aria-label={m.rename} maxLength={80} autoFocus />
            <button className="primary" type="submit" disabled={busy || !renaming.trim()}>
              {m.save}
            </button>
            <button type="button" onClick={() => setRenaming(null)}>
              {m.cancel}
            </button>
          </form>
        ) : (
          <h3 className="vaulttitle">
            <Icon name="vault" size={20} className="inlineicon" /> {data ? data.name : m.waiting}
            {data && canEdit && (
              <button className="linkish small-link" onClick={() => setRenaming(data.name)}>
                {m.rename}
              </button>
            )}
          </h3>
        )}
        {error && <div className="errorbox">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {!data && <p className="dim">{m.waitingLead}</p>}
        {data && role === 'view' && <p className="hint">{m.viewOnly}</p>}

        <div className="tabs" role="tablist">
          {(['passwords', 'notes', 'totp', 'people', ...(manage ? ['audit'] : [])] as Tab[]).map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tab${tab === t ? ' active' : ''}`}
              disabled={!data && t !== 'people'}
              onClick={() => {
                setTab(t)
                setCopyId('')
                setNotice(null)
              }}
            >
              {m.tabs[t]}
              {t !== 'audit' && (
                <span className="dim">
                  {' '}
                  {t === 'people' ? members.length : t === 'passwords' ? of('password').length : t === 'notes' ? of('note').length : of('totp').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {data && canEdit && mineOfKind.length > 0 && (tab === 'passwords' || tab === 'notes' || tab === 'totp') && (
          <div className="row vaultcopy">
            <span className="hint">{m.copyFromMine}:</span>
            <select value={copyId} onChange={e => setCopyId(e.target.value)} aria-label={m.copyFromMine}>
              <option value="">{m.copyPick}</option>
              {mineOfKind.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              className="small"
              disabled={!copyId || busy}
              onClick={() => {
                const src = vault.secrets.find(s => s.id === copyId)
                if (!src) return
                const now = Date.now()
                const { attachments: _a, shareIds: _s, ...rest } = src
                void run(() => c.saveSecret(current.id, { ...rest, id: crypto.randomUUID(), createdAt: now, updatedAt: now })).then(() => {
                  setCopyId('')
                  setNotice(fmt(m.copied, { title: src.title }))
                })
              }}
            >
              {m.copy}
            </button>
          </div>
        )}

        {tab === 'people' && (
          <div className="vaultpeople">
            {members.map(p => {
              const hasKey = p.generations.includes(current.state.generation)
              return (
                <div className="sharerow" key={p.accountId}>
                  <span className="sharename">
                    {p.label}
                    {p.accountId === me && <span className="dim"> ({m.you})</span>}
                  </span>
                  {!hasKey && (
                    <span className="badge" title={m.noKeyTip}>
                      {m.noKey}
                    </span>
                  )}
                  {manage ? (
                    <select
                      value={p.role}
                      aria-label={`${m.tabs.people}: ${p.label}`}
                      disabled={busy || (p.role === 'manage' && managers <= 1)}
                      onChange={e => void run(() => c.setRole(current.id, p.accountId, e.target.value as VaultRole))}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>
                          {m.roles[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge role-${p.role}`}>{m.roles[p.role]}</span>
                  )}
                  {manage && p.accountId !== me && (
                    <button className="small danger" disabled={busy || (p.role === 'manage' && managers <= 1)} onClick={() => void run(() => c.removeMember(current.id, p.accountId))}>
                      {m.remove}
                    </button>
                  )}
                </div>
              )
            })}
            {manage && (
              <div className="vaultadd">
                <div className="navsection" style={{ padding: '14px 0 6px' }}>
                  {m.addPerson}
                </div>
                {addable.length === 0 ? (
                  <p className="hint">{m.allAdded}</p>
                ) : (
                  <div className="row">
                    <select value={addId} onChange={e => setAddId(e.target.value)} aria-label={m.addPerson}>
                      <option value="">—</option>
                      {addable.map(t => (
                        <option key={t.accountId} value={t.accountId}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select value={addRole} onChange={e => setAddRole(e.target.value as VaultRole)} aria-label={m.roles.view}>
                      {ROLES.map(r => (
                        <option key={r} value={r}>
                          {m.roles[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary"
                      disabled={!addId || busy}
                      onClick={() => void run(() => c.addMember(current.id, addId, addRole)).then(() => setAddId(''))}
                    >
                      {m.add}
                    </button>
                  </div>
                )}
              </div>
            )}
            <ul className="rolehelp">
              {ROLES.map(r => (
                <li key={r}>
                  <strong>{m.roles[r]}:</strong> {m.roleHelp[r]}
                </li>
              ))}
            </ul>
            <p className="hint">{m.removedNote}</p>
            <p className="hint">{m.limit}</p>
          </div>
        )}

        {tab === 'audit' && manage && (
          <div className="vaultaudit">
            {audit === null ? (
              <p className="dim">…</p>
            ) : audit.length === 0 ? (
              <p className="dim">{m.auditEmpty}</p>
            ) : (
              <ul>
                {audit.map((e, i) => (
                  <li key={i}>
                    <span className="dim">{fmtDate(e.at)}</span>
                    <span>
                      {fmt(m.events[e.kind] ?? e.kind, {
                        actor: e.actor,
                        member: e.member ?? '',
                        role: e.role ? (m.roles[e.role as VaultRole] ?? e.role) : ''
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="row vaultfoot">
          {!lastManager && (
            <button className="small" disabled={busy} onClick={() => setConfirm('leave')}>
              {m.leave}
            </button>
          )}
          {manage && (
            <button className="small danger" disabled={busy} onClick={() => setConfirm('delete')}>
              {m.delete}
            </button>
          )}
        </div>
      </div>

      {data && tab === 'passwords' && (
        <PasswordsPanel
          heading={m.tabs.passwords}
          entries={of('password')}
          readOnly={!canEdit}
          onSave={save}
          onSaveMany={list => void run(() => c.saveSecrets(current.id, list))}
          onDelete={del}
        />
      )}
      {data && tab === 'notes' && <NotesPanel heading={m.tabs.notes} entries={of('note')} readOnly={!canEdit} onSave={save} onDelete={del} />}
      {data && tab === 'totp' && <TotpPanel heading={m.tabs.totp} entries={of('totp')} readOnly={!canEdit} onSave={save} onDelete={del} />}

      {confirm && (
        <ConfirmDialog
          title={fmt(confirm === 'delete' ? m.deleteTitle : m.leaveTitle, { name: data?.name ?? '' })}
          body={confirm === 'delete' ? m.deleteBody : m.leaveBody}
          confirmLabel={confirm === 'delete' ? m.delete : m.leave}
          cancelLabel={m.cancel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const which = confirm
            setConfirm(null)
            void run(async () => {
              if (which === 'delete') await c.remove(current.id)
              else await c.removeMember(current.id, me!)
              setOpenId(null)
            })
          }}
        />
      )}
      </div>
    </div>
  )
}
