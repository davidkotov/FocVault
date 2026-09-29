'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { api, type SsoConfigView, type TeamAdminView as View, type TeamAuditEvent } from '@/features/api/client'
import { ensureKeypair } from '@/features/emergency/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { createTeamRecoveryKey, distributeTeamKey, openRecoveredVault } from '@/features/team/client'
import { buildComplianceReport } from '@/features/team/report'
import { toCsv, downloadText } from '@/lib/csv'
import type { TeamPolicy } from '@/lib/api-types'
import { teamAdminMessages } from '@/lib/i18n/messages/team-admin'
import ReadOnlyVaultView from './ReadOnlyVaultView'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/site/Icons'
import { formatBytes } from '@/lib/vault'

type Tab = 'members' | 'policies' | 'audit' | 'recovery' | 'sso'

/** Business-Admin-Konsole: Mitglieder & Rollen, Richtlinien, Protokoll & PDF-Bericht, Notfallzugriff, SSO. */
export default function TeamAdminView({ onInvite }: { onInvite?: () => void } = {}) {
  const m = useMessages(teamAdminMessages)
  const { fmtDate, locale } = useI18n()
  const fmtDT = useCallback((d: string) => new Date(d).toLocaleString(locale === 'en' ? 'en-GB' : 'de-CH', { dateStyle: 'short', timeStyle: 'short' }), [locale])
  const errText = useErrorText()
  const { account, vault, mutate } = useAccount()
  const [view, setView] = useState<View | null>(null)
  const [tab, setTab] = useState<Tab>('members')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<TeamPolicy | null>(null)
  const [events, setEvents] = useState<TeamAuditEvent[] | null>(null)
  const [filter, setFilter] = useState({ member: '', kind: '', days: 30 })
  const [req, setReq] = useState({ target: '', reason: '' })
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null)
  const [sso, setSso] = useState<SsoConfigView | null>(null)
  const [recent, setRecent] = useState<TeamAuditEvent[] | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('pageactions-slot')), [])
  const [ssoForm, setSsoForm] = useState({ issuer: '', clientId: '', clientSecret: '', domains: '', enforce: false, autoJoin: true })

  const keypair = useCallback(async () => {
    const ov = await api.emergency()
    return ensureKeypair(ov.myPublicKey, vault.familyKey, k => mutate(c => (c.familyKey ? c : { ...c, familyKey: k })))
  }, [vault.familyKey, mutate])

  const load = useCallback(async () => {
    try {
      let v = await api.team()
      // Schlüsselpaar für Admins sicherstellen und Team-Schlüssel an andere Admins weitergeben
      if (v.role !== 'member') {
        const kp = await keypair()
        if (await distributeTeamKey(v, kp).catch(() => false)) v = await api.team()
      }
      setView(v)
      setPolicy(p => p ?? v.policy)
      if (v.role !== 'member') api.teamAudit({ from: new Date(Date.now() - 30 * 86_400_000).toISOString(), limit: 4 }).then(r => setRecent(r.events)).catch(() => setRecent([]))
    } catch (e) {
      setError(errText(e))
    }
  }, [keypair, errText])

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (ok) setNotice(ok)
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const loadAudit = useCallback(async () => {
    try {
      const from = new Date(Date.now() - filter.days * 86_400_000).toISOString()
      setEvents((await api.teamAudit({ from, member: filter.member || undefined, kind: filter.kind || undefined, limit: 1000 })).events)
    } catch (e) {
      setError(errText(e))
    }
  }, [filter, errText])

  useEffect(() => {
    if (tab === 'audit') void loadAudit()
    if (tab === 'sso' && view?.tier === 'enterprise')
      api
        .sso()
        .then(r => {
          setSso(r.config)
          if (r.config) setSsoForm({ issuer: r.config.issuer, clientId: r.config.clientId, clientSecret: '', domains: r.config.domains.join(', '), enforce: r.config.enforce, autoJoin: r.config.autoJoin })
        })
        .catch(e => setError(errText(e)))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = useCallback((kind: string) => m.events[kind] ?? kind, [m])
  const detail = (e: TeamAuditEvent) => {
    const x = e.meta
    const name = (id: unknown) => view?.members.find(p => p.id === id)?.label ?? ''
    const parts: string[] = []
    if (typeof x.member === 'string') parts.push(name(x.member))
    if (typeof x.role === 'string') parts.push(m.roles[x.role as 'admin'] ?? String(x.role))
    if (Array.isArray(x.changed) && x.changed.length) parts.push((x.changed as string[]).map(k => (m.p as Record<string, string>)[k] ?? k).join(', '))
    if (typeof x.files === 'number') parts.push(`${x.files}×`)
    if (typeof x.expiresInHours === 'number') parts.push(`${Math.round((x.expiresInHours as number) / 24) || 1} d`)
    return parts.filter(Boolean).join(' · ')
  }

  const exportCsv = () => {
    if (!events) return
    downloadText(
      `focvault-protokoll-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([[m.audit.when, m.audit.who, m.audit.what, 'kind', m.audit.details], ...events.map(e => [e.at, e.actor, label(e.kind), e.kind, detail(e)])])
    )
  }

  const exportPdf = () =>
    run(async () => {
      const d = await api.teamReport(Math.max(30, filter.days))
      const bytes = buildComplianceReport(d, m, fmtDT, label)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `FocVault-Compliance-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    })

  const summary = useMemo(() => (view ? { ok: view.members.filter(x => x.compliant).length, n: view.members.length } : null), [view])

  if (!account) return null
  if (error && !view)
    return (
      <div className="card">
        <h3>{m.title}</h3>
        <div className="errorbox">{error}</div>
      </div>
    )
  if (!view) return <div className="card"><p className="dim">…</p></div>

  if (opened)
    return (
      <ReadOnlyVaultView
        title={fmt(m.rec.vaultTitle, { name: opened.name })}
        lead={m.rec.vaultLead}
        onBack={() => setOpened(null)}
        fetchPieces={oid => api.recoveryDownload(opened.id, oid)}
        load={async () => openRecoveredVault(opened.id, view.owner, view.me, await keypair())}
      />
    )

  const admins = view.members.filter(x => x.role !== 'member').length
  const tabs: Tab[] = ['members', 'policies', 'audit', 'recovery', 'sso']

  const compliant = view.members.filter(x => x.compliant).length
  const pending = view.recovery?.requests.filter(q => q.status === 'pending').length ?? 0
  return (
    <>
    <div className="kpis">
      <div className="kpi">
        <div className="k"><Icon name="users" size={14} /> {m.kpi.people}</div>
        <div className="v">{view.members.length}</div>
        <div className="s">{m.roles[view.role]}</div>
      </div>
      <div className="kpi">
        <div className="k"><Icon name="shield" size={14} /> {m.kpi.compliant}</div>
        <div className="v">
          {compliant} / {view.members.length}
        </div>
        <div className="s">{compliant === view.members.length ? m.ok : `${view.members.length - compliant} ${m.kpi.open}`}</div>
      </div>
      <div className="kpi">
        <div className="k"><Icon name="lifebuoy" size={14} /> {m.kpi.recovery}</div>
        <div className="v">{view.recovery ? `${view.members.filter(x => x.escrowed).length} / ${view.members.length}` : '–'}</div>
        <div className="s">{pending ? `${pending} ${m.kpi.pending}` : view.recovery ? m.kpi.escrowed : m.kpi.noKey}</div>
      </div>
      <div className="kpi">
        <div className="k"><Icon name="database" size={14} /> {m.kpi.storage}</div>
        <div className="v">
          {formatBytes(account.usedBytes)} / {formatBytes(account.quotaBytes)}
        </div>
        <div className="planbar" style={{ marginTop: 10 }}>
          <b style={{ width: `${account.quotaBytes ? Math.min(100, (account.usedBytes / account.quotaBytes) * 100) : 0}%`, background: 'var(--dk-bar-1, #0b1220)' }} />
        </div>
      </div>
    </div>
    {slot &&
      createPortal(
        <>
          {view.role !== 'member' && (
            <button className="small" disabled={busy} onClick={() => void exportPdf()}>
              <Icon name="file" size={14} /> {m.headPdf}
            </button>
          )}
          {onInvite && view.role === 'owner' && (
            <button className="primary small" onClick={onInvite}>
              {m.headInvite}
            </button>
          )}
        </>,
        slot
      )}
    <div className="admingrid">
    <div className="card teamadmin">
      <div className="teamadmin-head">
        <div className="tabs pilltabs" role="tablist">
          {tabs.map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {m.tabs[t]}
            </button>
          ))}
        </div>
        <span className="dim">{view.role === 'owner' ? m.ownerHint : m.roles[view.role]}</span>
      </div>
      {error && <div className="errorbox">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {tab === 'members' && (
        <>
          {summary && <p className="hint">{fmt(m.compliantSummary, summary)}</p>}
          <div className="tablewrap">
            <table className="datatable">
              <thead>
                <tr>
                  {(['person', 'role', 'passkeys', 'passphrase', 'escrow', 'active', 'status'] as const).map(c => (
                    <th key={c}>{m.cols[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.members.map(p => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>
                      {view.role === 'owner' && p.role !== 'owner' ? (
                        <select
                          aria-label={`${m.cols.role}: ${p.label}`}
                          value={p.role}
                          disabled={busy}
                          onChange={e => void run(() => api.setTeamRole(p.id, e.target.value as 'admin' | 'member'))}
                        >
                          <option value="member">{m.roles.member}</option>
                          <option value="admin">{m.roles.admin}</option>
                        </select>
                      ) : (
                        m.roles[p.role]
                      )}
                    </td>
                    <td>{p.passkeys}</td>
                    <td>{p.passphraseChars ? fmt(m.chars, { n: p.passphraseChars }) : m.unknown}</td>
                    <td>{view.recovery ? (p.escrowed ? m.yes : m.no) : '—'}</td>
                    <td>{p.lastActive ? fmtDT(p.lastActive) : '—'}</td>
                    <td>
                      {p.compliant ? (
                        <span className="badge ok">{m.ok}</span>
                      ) : (
                        p.issues.map(i => (
                          <span key={i} className="badge warn">
                            {m.issues[i]}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{m.roleHint}</p>
          <p className="hint">{m.attestHint}</p>
        </>
      )}

      {tab === 'policies' && policy && (
        <form
          className="policyform"
          onSubmit={e => {
            e.preventDefault()
            void run(() => api.setTeamPolicy(policy), m.saved)
          }}
        >
          {(['passkeyRequired', 'allowShareLinks', 'recoveryRequired'] as const).map(k => (
            <label key={k} className="policyrow">
              <input type="checkbox" checked={policy[k]} onChange={e => setPolicy({ ...policy, [k]: e.target.checked })} />
              <span>
                <strong>{m.p[k]}</strong>
                <span className="hint">{m.p[`${k}Hint` as const]}</span>
              </span>
            </label>
          ))}
          <label className="policyrow num">
            <span>
              <strong>{m.p.minPassphraseChars}</strong>
              <span className="hint">{m.p.minPassphraseCharsHint}</span>
            </span>
            <input type="number" min={12} max={64} value={policy.minPassphraseChars} onChange={e => setPolicy({ ...policy, minPassphraseChars: Number(e.target.value) })} />
          </label>
          <label className="policyrow num">
            <span>
              <strong>{m.p.autoLockMinutes}</strong>
              <span className="hint">{m.p.autoLockMinutesHint}</span>
            </span>
            <input type="number" min={1} max={480} value={policy.autoLockMinutes} onChange={e => setPolicy({ ...policy, autoLockMinutes: Number(e.target.value) })} />
          </label>
          <label className="policyrow num">
            <span>
              <strong>{m.p.maxShareDays}</strong>
              <span className="hint">{m.p.maxShareDaysHint}</span>
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={policy.maxShareDays ?? ''}
              onChange={e => setPolicy({ ...policy, maxShareDays: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {m.save}
          </button>
        </form>
      )}

      {tab === 'audit' && (
        <>
          <p className="dim">{m.audit.lead}</p>
          <div className="row auditfilters">
            <select aria-label={m.audit.filterPerson} value={filter.member} onChange={e => setFilter({ ...filter, member: e.target.value })}>
              <option value="">
                {m.audit.filterPerson}: {m.audit.all}
              </option>
              {view.members.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select aria-label={m.audit.filterKind} value={filter.kind} onChange={e => setFilter({ ...filter, kind: e.target.value })}>
              <option value="">
                {m.audit.filterKind}: {m.audit.all}
              </option>
              {Object.entries(m.audit.kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select aria-label={m.audit.period} value={filter.days} onChange={e => setFilter({ ...filter, days: Number(e.target.value) })}>
              {[7, 30, 90, 365].map(d => (
                <option key={d} value={d}>
                  {fmt(m.audit.days, { n: d })}
                </option>
              ))}
            </select>
            <button className="small" onClick={() => void loadAudit()}>
              {m.audit.load}
            </button>
            <span style={{ flex: 1 }} />
            <button className="small" disabled={!events?.length} onClick={exportCsv}>
              {m.audit.csv}
            </button>
            <button className="primary small" disabled={busy} onClick={() => void exportPdf()}>
              {busy ? m.audit.generating : m.audit.pdf}
            </button>
          </div>
          {events?.length === 0 && <p className="dim">{m.audit.empty}</p>}
          {!!events?.length && (
            <div className="tablewrap">
              <table className="datatable">
                <thead>
                  <tr>
                    <th>{m.audit.when}</th>
                    <th>{m.audit.who}</th>
                    <th>{m.audit.what}</th>
                    <th>{m.audit.details}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id}>
                      <td className="nowrap">{fmtDT(e.at)}</td>
                      <td>{e.actor}</td>
                      <td>{label(e.kind)}</td>
                      <td className="dim">{detail(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'recovery' && (
        <>
          <p className="dim">{m.rec.lead}</p>
          {admins < 2 && <div className="notice warn">{m.rec.needTwo}</div>}
          {view.recovery ? (
            <p className="hint">
              {fmt(m.rec.ready, { n: view.recovery.generation, escrowed: view.members.filter(x => x.escrowed).length, total: view.members.length })}
            </p>
          ) : null}
          {view.recovery && !view.recovery.myWrapped && <div className="notice">{m.rec.noKeyYet}</div>}
          {view.role === 'owner' ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <button className={view.recovery ? 'small' : 'primary'} disabled={busy} onClick={() => void run(async () => createTeamRecoveryKey(view, await keypair()))}>
                {view.recovery ? m.rec.rotate : m.rec.setup}
              </button>
              {view.recovery && <span className="hint">{m.rec.rotateHint}</span>}
            </div>
          ) : (
            !view.recovery && <p className="hint">{m.rec.ownerOnly}</p>
          )}

          {view.recovery && (
            <>
              <div className="navsection" style={{ padding: '16px 0 6px' }}>
                {m.rec.newRequest}
              </div>
              <form
                className="recform"
                onSubmit={e => {
                  e.preventDefault()
                  void run(async () => {
                    await api.recoveryRequest(req.target, req.reason)
                    setReq({ target: '', reason: '' })
                  })
                }}
              >
                <select aria-label={m.rec.target} value={req.target} onChange={e => setReq({ ...req, target: e.target.value })}>
                  <option value="">{m.rec.target} …</option>
                  {view.members
                    .filter(p => p.id !== view.me && p.escrowed)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
                <input aria-label={m.rec.reason} placeholder={m.rec.reason} value={req.reason} maxLength={500} onChange={e => setReq({ ...req, reason: e.target.value })} />
                <button className="small" type="submit" disabled={busy || !req.target || req.reason.trim().length < 10}>
                  {m.rec.submit}
                </button>
              </form>
              <div className="navsection" style={{ padding: '16px 0 6px' }}>
                {m.rec.requests}
              </div>
              {view.recovery.requests.length === 0 && <p className="hint">{m.rec.none}</p>}
              {view.recovery.requests.map(q => (
                <div className={`emrow${q.status === 'pending' ? ' alert' : ''}`} key={q.id}>
                  <div className="emmain">
                    <strong>
                      {q.targetLabel} · <span className="dim">{m.report.status[q.status]}</span>
                    </strong>
                    <span className="hint">
                      {fmtDT(q.createdAt)} · {fmt(m.rec.by, { a: q.requestedByLabel })}
                      {q.approvedByLabel && ` · ${fmt(m.rec.approvedBy, { b: q.approvedByLabel })}`}
                      {q.accessUntil && ` · ${fmt(m.rec.until, { date: fmtDT(q.accessUntil) })}`}
                    </span>
                    <span className="hint">„{q.reason}“</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {q.status === 'pending' && q.requestedBy !== view.me && q.target !== view.me && (
                      <>
                        <button className="small" disabled={busy} onClick={() => void run(() => api.recoveryDecide(q.id, false))}>
                          {m.rec.reject}
                        </button>
                        <button className="primary small" disabled={busy} onClick={() => void run(() => api.recoveryDecide(q.id, true))}>
                          {m.rec.approve}
                        </button>
                      </>
                    )}
                    {q.status === 'pending' && q.requestedBy === view.me && <span className="hint">{m.rec.waitingOther}</span>}
                    {q.status === 'approved' && (q.requestedBy === view.me || q.approvedBy === view.me) && (
                      <button className="primary small" onClick={() => setOpened({ id: q.id, name: q.targetLabel })}>
                        {m.rec.open}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === 'sso' && (
        <>
          <p className="dim">{m.sso.lead}</p>
          {view.tier !== 'enterprise' ? (
            <div className="notice">{m.sso.enterpriseOnly}</div>
          ) : (
            <>
            {view.role !== 'owner' && <div className="notice">{m.sso.ownerOnly}</div>}
            <form
              className="ssoform"
              onSubmit={e => {
                e.preventDefault()
                void run(async () => {
                  const r = await api.setSso({
                    issuer: ssoForm.issuer.trim(),
                    clientId: ssoForm.clientId.trim(),
                    clientSecret: ssoForm.clientSecret || undefined,
                    domains: ssoForm.domains.split(',').map(d => d.trim()).filter(Boolean),
                    enforce: ssoForm.enforce,
                    autoJoin: ssoForm.autoJoin
                  })
                  setSso(r.config)
                  setSsoForm(f => ({ ...f, clientSecret: '' }))
                }, m.sso.saved)
              }}
            >
              <fieldset disabled={view.role !== 'owner'} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
              <label>
                {m.sso.issuer}
                <input value={ssoForm.issuer} onChange={e => setSsoForm({ ...ssoForm, issuer: e.target.value })} placeholder="https://accounts.google.com" />
                <span className="hint">{m.sso.issuerHint}</span>
              </label>
              <label>
                {m.sso.clientId}
                <input value={ssoForm.clientId} onChange={e => setSsoForm({ ...ssoForm, clientId: e.target.value })} />
              </label>
              <label>
                {m.sso.clientSecret}
                <input type="password" autoComplete="off" value={ssoForm.clientSecret} placeholder={sso?.hasSecret ? m.sso.secretSet : ''} onChange={e => setSsoForm({ ...ssoForm, clientSecret: e.target.value })} />
              </label>
              <label>
                {m.sso.domains}
                <input value={ssoForm.domains} onChange={e => setSsoForm({ ...ssoForm, domains: e.target.value })} placeholder="firma.ch, firma.de" />
              </label>
              <label>
                {m.sso.redirect}
                <input readOnly value={`${typeof window === 'undefined' ? '' : window.location.origin}/api/v1/auth/sso/callback`} onFocus={e => e.currentTarget.select()} />
              </label>
              {(['enforce', 'autoJoin'] as const).map(k => (
                <label key={k} className="policyrow">
                  <input type="checkbox" checked={ssoForm[k]} onChange={e => setSsoForm({ ...ssoForm, [k]: e.target.checked })} />
                  <span>
                    <strong>{m.sso[k]}</strong>
                    <span className="hint">{m.sso[`${k}Hint` as const]}</span>
                  </span>
                </label>
              ))}
              <div className="row" style={{ gap: 8 }}>
                <button className="primary" type="submit" disabled={busy || !ssoForm.issuer || !ssoForm.clientId || !ssoForm.domains}>
                  {m.save}
                </button>
                {sso && (
                  <button
                    type="button"
                    className="small danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.deleteSso()
                        setSso(null)
                      })
                    }
                  >
                    {m.sso.remove}
                  </button>
                )}
              </div>
              </fieldset>
            </form>
            {sso && sso.domainStatus.length > 0 && (
              <div className="ssodomains" style={{ marginTop: 20 }}>
                <h4>{m.sso.domainsTitle}</h4>
                <p className="hint">{m.sso.domainsLead}</p>
                <table className="datatable">
                  <tbody>
                    {sso.domainStatus.map(d => (
                      <tr key={d.domain}>
                        <td>
                          <strong>{d.domain}</strong>
                          <div className="dim">{d.verified ? m.sso.verified : m.sso.unverified}</div>
                        </td>
                        <td>
                          {!d.verified && (
                            <>
                              <div className="hint">
                                {m.sso.txtName}: <code>{d.txtName}</code>
                              </div>
                              <div className="hint">
                                {m.sso.txtValue}: <code>{d.txtValue}</code>
                              </div>
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!d.verified && view.role === 'owner' && (
                            <button
                              type="button"
                              className="small"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const r = await api.verifySsoDomain(d.domain)
                                  setSso(r.config)
                                }, fmt(m.sso.domainVerified, { domain: d.domain }))
                              }
                            >
                              {m.sso.check}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>
          )}
        </>
      )}
    </div>
    {view.role !== 'member' && (
      <aside className="adminside">
        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.tabs.policies}</h3>
            <button className="linkish" onClick={() => setTab('policies')}>
              {m.edit}
            </button>
          </div>
          {(
            [
              ['passkey', m.p.passkeyRequired, view.policy.passkeyRequired ? <span className="strongbadge">{m.side.on}</span> : <span className="dim">{m.side.off}</span>],
              ['key', m.side.minChars, <b key="c">{fmt(m.chars, { n: view.policy.minPassphraseChars })}</b>],
              ['lock', m.side.autoLock, <b key="a">{fmt(m.side.minutes, { n: view.policy.autoLockMinutes })}</b>],
              ['send', m.side.links, <b key="l">{!view.policy.allowShareLinks ? m.side.off : view.policy.maxShareDays ? fmt(m.side.maxDays, { n: view.policy.maxShareDays }) : m.side.free}</b>],
              ['lifebuoy', m.side.recovery, view.policy.recoveryRequired ? <span className="strongbadge">{m.side.required}</span> : <span className="dim">{m.side.off}</span>]
            ] as const
          ).map(([i, l, v]) => (
            <div className="adminrow" key={l}>
              <Icon name={i} size={15} />
              <span>{l}</span>
              {v}
            </div>
          ))}
        </div>
        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.side.recent}</h3>
            <button className="linkish" onClick={() => setTab('audit')}>
              {m.side.all}
            </button>
          </div>
          {(recent ?? []).map((e, i) => (
            <div className="adminevent" key={i}>
              <b>{label(e.kind)}</b>
              <span className="dim">
                {[e.actor, detail(e), fmtDT(e.at)].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
          {recent && recent.length === 0 && <p className="dim" style={{ padding: '12px 18px', margin: 0 }}>{m.side.none}</p>}
        </div>
      </aside>
    )}
    </div>
    </>
  )
}
