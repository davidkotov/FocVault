'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import AuthShell, { Working } from '@/components/account/AuthShell'
import { ApiClientError } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { SharePasswordError, downloadShared, fragmentNeedsPassword, openShareLink, type OpenedShare } from '@/features/shares/share'
import { shareMessages } from '@/lib/i18n/messages/share'
import { formatBytes } from '@/lib/vault'

type Phase = 'loading' | 'password' | 'ready' | 'downloading' | 'done' | 'invalid' | 'gone' | 'error'

/** Empfängerseite von Secure Send – ohne Konto. Entschlüsselt ausschließlich im Browser. */
export default function SharePage() {
  const { id } = useParams<{ id: string }>()
  const m = useMessages(shareMessages).page
  const { fmtDate, path } = useI18n()
  const errText = useErrorText()
  const [phase, setPhase] = useState<Phase>('loading')
  const [share, setShare] = useState<OpenedShare | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState(false)
  const [pct, setPct] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(
    async (pw?: string) => {
      const fragment = window.location.hash.slice(1)
      if (!fragment) return setPhase('invalid')
      try {
        setShare(await openShareLink(id, fragment, pw))
        setPhase('ready')
      } catch (e) {
        if (e instanceof SharePasswordError) {
          setPwError(!!pw)
          return setPhase('password')
        }
        if (e instanceof ApiClientError && (e.code === 'GONE' || e.code === 'NOT_FOUND')) return setPhase('gone')
        if (e instanceof ApiClientError) {
          setError(errText(e))
          return setPhase('error')
        }
        setPhase('invalid')
      }
    },
    [id, errText]
  )

  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    if (fragment && fragmentNeedsPassword(fragment)) setPhase('password')
    else void open()
  }, [open])

  const download = async () => {
    if (!share) return
    setPhase('downloading')
    setPct(0)
    try {
      await downloadShared(share, (done, total) => setPct(total ? Math.round((done / total) * 100) : 100))
      setPhase('done')
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'GONE') return setPhase('gone')
      setError(errText(e))
      setPhase('error')
    }
  }

  return (
    <AuthShell foot={m.zk}>
      <h2>{m.title}</h2>
      {phase === 'loading' && <Working label={m.loading} />}

      {phase === 'password' && (
        <form
          onSubmit={e => {
            e.preventDefault()
            if (password) void open(password)
          }}
        >
          <p className="lead">{m.passwordLead}</p>
          {pwError && <div className="errorbox">{m.wrongPassword}</div>}
          <div className="field">
            <label htmlFor="share-pw">{m.password}</label>
            <input id="share-pw" type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button className="primary full" type="submit" disabled={!password}>
            {m.unlock}
          </button>
        </form>
      )}

      {share && (phase === 'ready' || phase === 'downloading' || phase === 'done') && (
        <>
          <div className="sharefile">
            <div className="sharefile-icon" aria-hidden="true">
              📄
            </div>
            <div>
              <strong className="sharefile-name">{share.name}</strong>
              <div className="hint">
                {formatBytes(share.size)} · {share.expiresAt ? fmt(m.expires, { date: fmtDate(share.expiresAt) }) : m.never}
                {share.remaining !== null && ` · ${fmt(m.remaining, { n: share.remaining })}`}
              </div>
            </div>
          </div>
          {phase === 'ready' && (
            <button className="primary full" onClick={() => void download()}>
              {m.download}
            </button>
          )}
          {phase === 'downloading' && <Working label={fmt(m.downloading, { pct })} />}
          {phase === 'done' && <div className="notice">{m.done}</div>}
        </>
      )}

      {phase === 'invalid' && <div className="errorbox">{m.invalid}</div>}
      {phase === 'gone' && <div className="errorbox">{m.gone}</div>}
      {phase === 'error' && <div className="errorbox">{error}</div>}

      <div className="sharecta">
        <span>{m.cta}</span>
        <Link href={path('/registrieren')}>
          <button className="small">{m.ctaButton}</button>
        </Link>
      </div>
    </AuthShell>
  )
}
