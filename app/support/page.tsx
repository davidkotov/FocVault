'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { api, type StatusOverview } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { siteMessages } from '@/lib/i18n/messages/site'

const CATS = ['product', 'billing', 'general', 'feature', 'storage', 'business'] as const
type Cat = (typeof CATS)[number]

/** Support: Dokumentation, Status, häufige Fragen und Anfrageformular. */
export default function SupportPage() {
  const m = useMessages(siteMessages).support
  const s = useMessages(siteMessages).status
  const { path } = useI18n()
  const errText = useErrorText()
  const [open, setOpen] = useState<number | null>(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', company: '', message: '', website: '' })
  const [cats, setCats] = useState<Set<Cat>>(new Set())
  const [topic, setTopic] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusOverview['overall'] | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const t = q.get('topic')
    if (t === 'storage' || t === 'business') {
      setTopic(t)
      setCats(new Set([t]))
      if (t === 'storage') setForm(f => ({ ...f, message: fmt(m.storageTemplate, { plan: q.get('plan') ?? '—' }) }))
    }
    api.status().then(o => setStatus(o.overall)).catch(() => undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = form.firstName.trim() && form.lastName.trim() && /.+@.+\..+/.test(form.email) && form.message.trim().length >= 10 && cats.size > 0

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.supportTicket({ ...form, company: form.company || undefined, categories: [...cats], topic, website: form.website || undefined })
      setSent(true)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="landing sitepage">
      <SiteHeader />
      <main className="supportwrap" id="main">
        <div className="kicker">{m.eyebrow}</div>
        <h1>{m.title}</h1>
        <p className="lead">{m.lead}</p>

        <div className="supportcards">
          <Link className="supportcard" href={path('/docs')}>
            <strong>{m.docs} ↗</strong>
            <span>{m.docsSub}</span>
          </Link>
          <Link className="supportcard" href={path('/status')}>
            <strong>
              {m.status} ↗ {status && <span className={`statusdot ${status}`} title={s.overall[status]} />}
            </strong>
            <span>{status ? s.overall[status] : m.statusSub}</span>
          </Link>
        </div>

        <div className="kicker mono">{m.faqTitle}</div>
        <div className="faqlist">
          {m.faq.map((f, i) => (
            <div className={`faqitem${open === i ? ' open' : ''}`} key={i}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <span>{f.q}</span>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {open === i && <p>{f.a}</p>}
            </div>
          ))}
        </div>

        <div className="kicker mono" id="anfrage">
          {m.formTitle}
        </div>
        {sent ? (
          <div className="supportsent">
            <p>✓ {m.sent}</p>
            <button
              className="small"
              onClick={() => {
                setSent(false)
                setForm({ firstName: form.firstName, lastName: form.lastName, email: form.email, company: form.company, message: '', website: '' })
                setCats(new Set())
              }}
            >
              {m.another}
            </button>
          </div>
        ) : (
          <form
            className="supportform"
            onSubmit={e => {
              e.preventDefault()
              if (ready && !busy) void submit()
            }}
          >
            {error && <div className="errorbox">{error}</div>}
            <div className="grid2f">
              <label>
                <span>
                  {m.firstName} <span className="req">*</span>
                </span>
                <input autoComplete="given-name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="Anna" />
              </label>
              <label>
                <span>
                  {m.lastName} <span className="req">*</span>
                </span>
                <input autoComplete="family-name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Muster" />
              </label>
              <label>
                <span>
                  {m.email} <span className="req">*</span>
                </span>
                <input type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="anna@firma.ch" />
              </label>
              <label>
                <span>{m.company}</span>
                <input autoComplete="organization" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Firma AG" />
              </label>
            </div>
            <label>
              <span>
                {m.message} <span className="req">*</span>
              </span>
              <textarea rows={6} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder={m.messagePlaceholder} />
            </label>
            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} name="website" />
            <fieldset>
              <legend>
                {m.category} <span className="req">*</span>
              </legend>
              {CATS.map(c => (
                <label key={c} className="checkline">
                  <input
                    type="checkbox"
                    checked={cats.has(c)}
                    onChange={e =>
                      setCats(prev => {
                        const n = new Set(prev)
                        if (e.target.checked) n.add(c)
                        else n.delete(c)
                        return n
                      })
                    }
                  />
                  {m.categories[c]}
                </label>
              ))}
            </fieldset>
            <p className="hint">
              {m.privacy} <a href="#">{m.privacyLink}</a>.
            </p>
            <div className="responsepill">
              <span className="statusdot operational" />
              <span>
                {m.response} <strong>{m.responseTime}</strong>.
              </span>
            </div>
            <button className="outline full" type="submit" disabled={!ready || busy}>
              {busy ? m.sending : m.submit}
            </button>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
