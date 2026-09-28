'use client'

import { useEffect, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { deriveFromRecovery, isValidRecoveryWords } from '@/features/keys/kdf'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { appMessages } from '@/lib/i18n/messages/app'
import { Icon } from '@/components/site/Icons'
import type { SessionListItem } from '@/server/auth/sessions'
import { relativeDay } from '@/lib/i18n/relative'

/** Notfallzugang und Recovery-Kit als Kurzkarten (wie im Mockup). */
export function SafetyCards({ onEmergency, isPro }: { onEmergency: () => void; isPro: boolean }) {
  const m = useMessages(appMessages).safety
  const { account, refreshAccount } = useAccount()
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const [em, setEm] = useState<{ ready: number; label: string | null; waitDays: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    api
      .emergency()
      .then(o => {
        const ok = o.asGrantor.filter(c => c.status === 'confirmed' || c.status === 'requested')
        setEm({ ready: ok.length, label: ok[0]?.label ?? null, waitDays: Math.round((ok[0]?.waitHours ?? 168) / 24) })
      })
      .catch(() => setEm({ ready: 0, label: null, waitDays: 7 }))
  }, [])
  if (!account) return null
  const check = async () => {
    setBusy(true)
    setMsg(null)
    try {
      if (!isValidRecoveryWords(words)) throw new Error(m.invalid)
      const k = await deriveFromRecovery(words)
      await api.checkRecovery(k.authKey)
      setWords('')
      setChecking(false)
      setMsg({ ok: true, text: m.checkedOk })
      await refreshAccount()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message === m.invalid ? m.invalid : errText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid2 safetycards">
      <div className="card safetycard">
        <div className="safetyhead">
          <Icon name="lifebuoy" size={18} />
          <b>{m.emTitle}</b>
          <span className={em?.ready ? 'strongbadge' : 'pwbadge warn'}>{em?.ready ? m.ready : m.open}</span>
        </div>
        <p className="dim">{em?.ready ? fmt(m.emReady, { name: em.label ?? '—', days: em.waitDays }) : isPro ? m.emNone : m.emLocked}</p>
        <button className="small" onClick={onEmergency}>
          {em?.ready ? m.emManage : m.emAdd}
        </button>
      </div>
      <div className="card safetycard">
        <div className="safetyhead">
          <Icon name="key" size={18} />
          <b>{m.kitTitle}</b>
          <span className={account.recoveryCheckedAt ? 'strongbadge' : 'pwbadge warn'}>{account.recoveryCheckedAt ? m.checked : m.unchecked}</span>
        </div>
        <p className="dim">{account.recoveryCheckedAt ? fmt(m.kitChecked, { date: fmtDate(account.recoveryCheckedAt) }) : m.kitUnchecked}</p>
        {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
        {checking ? (
          <form
            onSubmit={e => {
              e.preventDefault()
              void check()
            }}
          >
            <textarea rows={3} value={words} onChange={e => setWords(e.target.value)} aria-label={m.wordsLabel} placeholder={m.wordsPlaceholder} autoComplete="off" spellCheck={false} />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="primary small" type="submit" disabled={busy || words.trim().split(/\s+/).length < 24}>
                {busy ? '…' : m.check}
              </button>
              <button className="small" type="button" onClick={() => setChecking(false)}>
                {m.cancel}
              </button>
            </div>
            <p className="hint">{m.localHint}</p>
          </form>
        ) : (
          <button className="small" onClick={() => setChecking(true)}>
            {m.checkWords}
          </button>
        )}
      </div>
    </div>
  )
}

function deviceLabel(ua: string | null, m: { unknown: string }): { name: string; icon: 'card' | 'idcard' } {
  if (!ua) return { name: m.unknown, icon: 'card' }
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : m.unknown
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Brave/.test(ua) ? 'Brave' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|curl|playwright/i.test(ua) ? 'CLI' : ''
  return { name: br ? `${os} · ${br}` : os, icon: /iPhone|Android/.test(ua) ? 'idcard' : 'card' }
}

/** Geräte & Sitzungen: alle angemeldeten Geräte, einzeln oder gesammelt abmelden. */
export function SessionsCard({ onCount, limit, onMore }: { onCount?: (n: number) => void; limit?: number; onMore?: () => void }) {
  const m = useMessages(appMessages).sessions
  const { locale } = useI18n()
  const errText = useErrorText()
  const [list, setList] = useState<SessionListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    api
      .sessions()
      .then(r => {
        setList(r.sessions)
        onCount?.(r.sessions.length)
      })
      .catch(e => setError(errText(e)))
  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const others = (list ?? []).filter(s => !s.current).length
  return (
    <div className="card plansection sessionscard">
      <div className="plansection-head">
        <h3>{m.title}</h3>
        {others > 0 && (
          <button className="linkish" onClick={() => void api.revokeOtherSessions().then(load).catch(e => setError(errText(e)))}>
            {m.revokeOthers}
          </button>
        )}
      </div>
      {error && <div className="errorbox" style={{ margin: 12 }}>{error}</div>}
      {(list ?? []).slice(0, limit ?? 50).map(s => {
        const d = deviceLabel(s.userAgent, m)
        return (
          <div className="sessionrow" key={s.id}>
            <Icon name={d.icon} size={18} />
            <div className="invmain">
              <b>{d.name}</b>
              <span className="dim">{s.current ? m.activeNow : fmt(m.lastSeen, { when: relativeDay(new Date(s.lastSeenAt).getTime(), locale) })}</span>
            </div>
            {s.current ? (
              <span className="strongbadge">{m.thisDevice}</span>
            ) : (
              <button className="linkish dangerlink" onClick={() => void api.revokeSession(s.id).then(load).catch(e => setError(errText(e)))}>
                {m.revoke}
              </button>
            )}
          </div>
        )
      })}
      {limit && list && list.length > limit && onMore && (
        <button className="linkish sessionsmore" onClick={onMore}>
          {fmt(m.showAll, { n: list.length })}
        </button>
      )}
      {list && list.length === 0 && <p className="dim" style={{ padding: '12px 18px' }}>—</p>}
    </div>
  )
}
