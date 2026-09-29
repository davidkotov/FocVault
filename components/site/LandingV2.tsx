'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import PricingSection from '@/components/site/PricingSection'
import { EncryptVisual, ProofVisual, ReplicaVisual } from '@/components/site/BridgeVisuals'
import { Icon, PlatformIcon, type IconName } from '@/components/site/Icons'
import { api, type PublicStats } from '@/features/api/client'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { landing2Messages } from '@/lib/i18n/messages/landing2'

type M = (typeof landing2Messages)['de']

/** Dashboard-Vorschau (statisch) im Hero – echte Navigation, Linien-Icons. */
function DashboardPreview() {
  const nav: Array<[IconName, string, boolean?]> = [
    ['cloud', 'Meine Cloud', true],
    ['send', 'Secure Send'],
    ['key', 'Passwörter'],
    ['note', 'Notizen'],
    ['otp', '2FA'],
    ['vault', 'Geteilte Tresore'],
    ['admin', 'Admin-Konsole']
  ]
  const files: Array<[IconName, string, string, string]> = [
    ['file', 'Vertrag_Mieter.pdf', '1.2 MB', 'var(--dk-blue-soft, #e8f3ff)'],
    ['image', 'Ferien_Zermatt.jpg', '4.8 MB', 'var(--dk-red-soft, #fdecec)'],
    ['archive', 'Backup_Server.tar', '2.3 GB', 'var(--dk-green-soft, #eaf8ef)'],
    ['note', 'Steuern_2026.xlsx', '860 KB', 'var(--dk-yellow-soft, #fff4e0)']
  ]
  return (
    <div className="v2preview" aria-hidden="true">
      <div className="v2chrome">
        <i />
        <i />
        <i />
        <span className="v2url">
          <Icon name="lock" size={11} /> focvault.app/app
        </span>
      </div>
      <div className="v2app">
        <div className="v2side">
          {nav.map(([i, l, on]) => (
            <div key={l} className={on ? 'on' : undefined}>
              <Icon name={i} size={15} />
              {l}
            </div>
          ))}
        </div>
        <div className="v2main">
          <div className="v2mh">
            <strong>Meine Cloud</strong>
            <span className="v2btn">+ Hochladen</span>
          </div>
          <div className="v2chips">
            <span className="on">Alle</span>
            <span>Dokumente</span>
            <span>Fotos</span>
            <span>Backups</span>
          </div>
          <div className="v2files">
            {files.map(([i, n, s, c]) => (
              <div className="v2file" key={n}>
                <div className="v2thumb" style={{ background: c }}>
                  <Icon name={i} size={20} />
                </div>
                <div className="v2fn">{n}</div>
                <div className="v2fs">
                  {s} · <span className="v2ok">Filecoin ✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Live-Ablauf im Dashboard: Datei → verschlüsselt → EU → Filecoin → Beweis → Secure-Send-Link. */
function Mark({ v }: { v: string }) {
  if (v === 'yes')
    return (
      <span className="cmp yes">
        <Icon name="check" size={16} />
      </span>
    )
  if (v === 'part') return <span className="cmp part">◐</span>
  return (
    <span className="cmp no">
      <Icon name="x" size={14} />
    </span>
  )
}

/** Neue Landingpage (v2): seriös, Privacy-/Swiss-Stil, orientiert an fil.one. */
export default function LandingV2() {
  const m = useMessages(landing2Messages)
  const router = useRouter()
  const { path, locale } = useI18n()
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [group, setGroup] = useState<'all' | 'private' | 'family' | 'business'>('all')
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  useEffect(() => {
    api.publicStats().then(setStats).catch(() => undefined)
  }, [])
  const go = (p: string) => router.push(path(p))
  const inGroup = (p: string) =>
    group === 'all' ||
    (group === 'private' && ['Free', 'Pro', 'Alle', 'All'].includes(p)) ||
    (group === 'family' && p === 'Family') ||
    (group === 'business' && ['Business', 'Enterprise'].includes(p))
  const num = (n: number) => n.toLocaleString(locale === 'en' ? 'en-GB' : 'de-CH')

  const [deleted, setDeleted] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('konto') === 'geloescht') setDeleted(true)
  }, [])

  return (
    <div className="landing v2">
      <SiteHeader />

      {deleted && (
        <div className="v2deleted" role="status">
          <Icon name="check" size={15} /> {m.deleted}
          <button className="linkish" onClick={() => setDeleted(false)} aria-label="OK">
            ×
          </button>
        </div>
      )}
      <header className="v2hero alpshero">
        <div className="wrap">
          <div className="v2kicker">{m.hero.kicker}</div>
          <h1>{m.hero.title}</h1>
          <p className="v2lead">{m.hero.lead}</p>
          <div className="v2ctas">
            <button className="primary lg" onClick={() => go('/registrieren')}>
              {m.hero.cta}
            </button>
            <button className="lg" onClick={() => go('/sicherheit')}>
              {m.hero.ctaSecondary}
            </button>
          </div>
          <div className="v2trust">{m.hero.trust}</div>
          <DashboardPreview />
        </div>
      </header>

      <div className="v2trustbar">
        <div className="wrap">
          {m.trustbar.map(t => (
            <span key={t}>
              <Icon name="check" size={14} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <section className="v2bridge" id="sicherheit">
        <div className="wrap">
          <div className="v2bridge-head">
            <div className="v2kicker">{m.alps.kicker}</div>
            <h2>{m.alps.title}</h2>
            <p className="v2lead">{m.alps.lead}</p>
          </div>
          <div className="v2bridge-facts">
            {m.alps.facts.map((f, i) => (
              <div className="v2bridge-fact" key={f.t}>
                {i === 0 ? (
                  <EncryptVisual label={m.alps.viz.enc} />
                ) : i === 1 ? (
                  <ReplicaVisual nodes={m.alps.viz.nodes as [string, string, string]} />
                ) : (
                  <ProofVisual steps={m.alps.viz.steps as [string, string, string]} next={m.alps.viz.next} />
                )}
                <div className="ic">
                  <Icon name={(['lock', 'database', 'proof'] as IconName[])[i]} size={20} />
                </div>
                <strong>{f.t}</strong>
                <span>{f.d}</span>
              </div>
            ))}
          </div>
          <div className="v2bridge-stats">
            {m.alps.stats.map(x => (
              <div key={x.l}>
                <b>{x.v}</b>
                <span>{x.l}</span>
              </div>
            ))}
            <div>
              <b>{stats?.uptimePct != null ? `${num(stats.uptimePct)} %` : '—'}</b>
              <span>{m.live.uptime}</span>
            </div>
            <div>
              <b>{stats ? num(stats.filesOnFilecoin) : '—'}</b>
              <span>{m.live.onFilecoin}</span>
            </div>
            <Link href={path('/status')} className="v2livelink">
              <span className="livedot" /> {m.live.status} <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="v2section tinted" id="produkt">
        <div className="wrap">
          <div className="v2kicker center">{m.security.kicker}</div>
          <h2 className="v2title">{m.security.title}</h2>
          <p className="v2sub">{m.security.lead}</p>
          <div className="v2flow">
            {m.security.flow.map((f, i) => (
              <div className="v2flowstep" key={f.t}>
                <div className="v2flowicon">
                  <Icon name={(['lock', 'admin', 'database', 'proof'] as IconName[])[i]} size={22} />
                </div>
                <strong>{f.t}</strong>
                <span>{f.d}</span>
                {i < 3 && <div className="v2flowarrow" aria-hidden="true" />}
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Link href={path('/sicherheit')} className="button">
              {m.security.cta} <Icon name="arrow" size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section className="v2section">
        <div className="wrap">
          <div className="v2kicker center">{m.why.kicker}</div>
          <h2 className="v2title">{m.why.title}</h2>
          <div className="v2three">
            {m.why.items.map(x => (
              <div className="v2card" key={x.t}>
                <span className="v2modicon">
                  <Icon name={x.i as IconName} size={20} />
                </span>
                <strong>{x.t}</strong>
                <p>{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="v2section tinted">
        <div className="wrap">
          <div className="v2kicker center">{m.compare.kicker}</div>
          <h2 className="v2title">{m.compare.title}</h2>
          <p className="v2sub">{m.compare.lead}</p>
          <div className="tablewrap">
            <table className="v2compare">
              <thead>
                <tr>
                  <th />
                  {m.compare.cols.map((c, i) => (
                    <th key={c} className={i === 0 ? 'us' : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.compare.rows.map(r => (
                  <tr key={r.t}>
                    <td>{r.t}</td>
                    {r.v.map((v, i) => (
                      <td key={i} className={i === 0 ? 'us' : undefined} title={m.compare.legend[v as 'yes']}>
                        <Mark v={v} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="v2note">{m.compare.note}</p>
        </div>
      </section>

      <section className="v2section">
        <div className="wrap">
          <div className="v2kicker center">{m.proof.kicker}</div>
          <h2 className="v2title">{m.proof.title}</h2>
          <div className="v2four">
            {m.proof.items.map(x => {
              const ext = x.href.startsWith('http') || x.href.startsWith('/.well-known')
              const href = ext ? x.href : path(x.href)
              return (
                <a className="v2card link" key={x.t} href={href} target={x.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                  <span className="v2modicon">
                    <Icon name={x.i as IconName} size={20} />
                  </span>
                  <strong>{x.t}</strong>
                  <p>{x.d}</p>
                  <span className="v2more">
                    {x.l} <Icon name="arrow" size={14} />
                  </span>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      <PricingSection />

      <section className="v2section" id="apps">
        <div className="wrap">
          <div className="v2kicker center">{m.apps.kicker}</div>
          <h2 className="v2title">{m.apps.title}</h2>
          <p className="v2sub">{m.apps.lead}</p>
          <div className="v2stores">
            <Link className="v2store live" href={path('/registrieren')}>
              <PlatformIcon name="web" />
              <span>
                <small>{m.apps.webSub}</small>
                {m.apps.web}
              </span>
            </Link>
            {m.apps.platforms.map(p => (
              <Link className="v2store" key={p.t} href={path('/support?topic=general')} title={m.apps.notify}>
                <PlatformIcon name={p.k as 'apple'} />
                <span>
                  <small>{m.apps.soon}</small>
                  {p.t}
                  <em>{p.s}</em>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="v2section tinted" id="faq">
        <div className="wrap narrow">
          <div className="v2kicker center">{m.faq.kicker}</div>
          <h2 className="v2title">{m.faq.title}</h2>
          <div className="faqlist">
            {m.faq.items.map((f, i) => (
              <div className={`faqitem${openFaq === i ? ' open' : ''}`} key={f.q}>
                <button type="button" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{f.q}</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {openFaq === i && <p>{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="v2section">
        <div className="wrap v2teamteaser">
          <div>
            <div className="v2kicker">{m.team.kicker}</div>
            <h2 className="v2title left">{m.team.title}</h2>
            <p className="v2sub left">{m.team.lead}</p>
          </div>
          <Link href={path('/team')} className="button">
            {m.team.cta} <Icon name="arrow" size={15} />
          </Link>
        </div>
      </section>

      <section className="v2final">
        <div className="wrap">
          <h2>{m.final.title}</h2>
          <p>{m.final.lead}</p>
          <div className="v2ctas">
            <button className="lg light" onClick={() => go('/registrieren')}>
              {m.final.cta}
            </button>
            <button className="lg ghost" onClick={() => go('/support?topic=business')}>
              {m.final.contact}
            </button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
