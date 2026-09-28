'use client'

import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { Icon } from '@/components/site/Icons'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { teamMessages } from '@/lib/i18n/messages/team'

const initials = (n: string) => (n.startsWith('[') ? '' : n.split(' ').map(x => x[0]).join('').slice(0, 2))
const ph = (s: string) => (s.startsWith('[') ? <mark className="legalph">{s}</mark> : s)

/** Gründer & Team (Fotos und Namen folgen – Platzhalter markiert). */
export default function TeamPage() {
  const m = useMessages(teamMessages)
  const { path } = useI18n()
  return (
    <div className="landing v2 sitepage">
      <SiteHeader />
      <main id="main">
        <section className="v2section">
          <div className="wrap">
            <div className="v2kicker center">{m.kicker}</div>
            <h1 className="v2title">{m.title}</h1>
            <p className="v2sub">{m.lead}</p>
            <div className="v2three">
              {m.people.map((p, i) => (
                <div className="v2card teamcard" key={i}>
                  <div className="teamphoto" aria-hidden="true">
                    {initials(p.name) || <Icon name="users" size={30} />}
                    <span>{m.photoHint}</span>
                  </div>
                  <strong>{ph(p.name)}</strong>
                  <span className="teamrole">{ph(p.role)}</span>
                  <p>{ph(p.bio)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="v2section tinted">
          <div className="wrap">
            <h2 className="v2title">{m.valuesTitle}</h2>
            <div className="v2three">
              {m.values.map(v => (
                <div className="v2card" key={v.t}>
                  <strong>{v.t}</strong>
                  <p>{v.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="v2section">
          <div className="wrap teamcontact">
            <div className="v2card">
              <strong>
                <Icon name="pin" size={16} /> {m.locTitle}
              </strong>
              <p>{ph(m.loc)}</p>
            </div>
            <div className="v2card">
              <strong>
                <Icon name="mail" size={16} /> {m.contactTitle}
              </strong>
              {m.contacts.map(c => (
                <p key={c.v}>
                  <span className="dim">{c.t}:</span> <a href={`mailto:${c.v}`}>{c.v}</a>
                </p>
              ))}
              <Link href={path('/support')} className="v2more">
                {m.support} <Icon name="arrow" size={14} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
