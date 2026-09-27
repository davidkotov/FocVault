'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LocaleSwitch from '@/components/LocaleSwitch'
import { api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { landingMessages } from '@/lib/i18n/messages/landing'
import { DEFAULT_PRICING, type Interval, type PricingConfig } from '@/lib/pricing'

type Offer = Pick<PricingConfig, 'free' | 'payg' | 'plans' | 'addons'>

export default function Landing() {
  const router = useRouter()
  const { path, currency, fmtMoney, fmtNumber } = useI18n()
  const t = useMessages(landingMessages)
  const [interval, setIntervalState] = useState<Interval>('year')
  const [offer, setOffer] = useState<Offer>(DEFAULT_PRICING)

  useEffect(() => {
    api.offer().then(setOffer).catch(() => undefined)
  }, [])

  const goLogin = () => router.push(path('/anmelden'))
  const goRegister = () => router.push(path('/registrieren'))

  const gb = offer.free.quotaGb
  const payg = fmtMoney(offer.payg.perGbMonth[currency], currency, 2)
  const perMonth = (item: { monthly: Record<string, number>; yearly: Record<string, number> }) =>
    interval === 'year' ? item.yearly[currency] / 12 : item.monthly[currency]
  const tb = (quota: number) => fmtNumber(quota / 1000, 1)
  const cheapestAddon = Math.min(...offer.addons.map(a => (interval === 'year' ? a.yearly[currency] / 12 : a.monthly[currency])))
  const vars = { gb, price: payg, pro: fmtMoney(offer.plans.pro.monthly[currency], currency), family: fmtMoney(offer.plans.family.monthly[currency], currency) }

  return (
    <div className="landing">
      <div className="utilbar">
        <div className="wrap">
          <div className="utillinks">
            <a href="https://docs.fil.one" target="_blank" rel="noreferrer">
              {t.util.docs}
            </a>
            <a href="#sicherheit">{t.util.security}</a>
            <a href="#faq">{t.util.support}</a>
          </div>
          <div className="utilright">
            <LocaleSwitch showCurrency />
          </div>
        </div>
      </div>

      <nav className="mainnav">
        <div className="wrap">
          <div className="brand">
            <svg className="mark" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="20" fill="#0090ff" />
              <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
              <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
              <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
            </svg>
            Foc<span style={{ color: '#0090ff' }}>Vault</span>
          </div>
          <div className="navlinks">
            <a href="#produkt">{t.nav.product}</a>
            <a href="#sicherheit">{t.nav.security}</a>
            <a href="#preise">{t.nav.pricing}</a>
            <a href="#faq">{t.nav.faq}</a>
          </div>
          <div className="navcta">
            <button onClick={goLogin}>
              {t.login}
            </button>
            <button className="primary" onClick={goRegister}>
              {t.register}
            </button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="pill">
            <b>{t.hero.pill}</b> {t.hero.pillText}
          </span>
          <h1>
            {t.hero.title1}
            <br />
            {t.hero.title2}
          </h1>
          <p className="lead">{t.hero.lead}</p>
          <div className="herobtns">
            <button className="primary lg" onClick={goRegister}>
              {t.hero.cta}
            </button>
            <a href="#how">
              <button className="lg">{t.hero.demo}</button>
            </a>
          </div>
          <div className="trustline">{fmt(t.hero.trust, { gb })}</div>

          <div className="preview" aria-hidden="true">
            <div className="barfake">
              <span className="fdot" />
              <span className="fdot" />
              <span className="fdot" />
              <span className="urlfake">focvault.app/cloud</span>
            </div>
            <div className="pvbody">
              <div className="pv-side">
                <div className="pv-navitem active">☁️ {t.preview.cloud}</div>
                <div className="pv-navitem">🔗 {t.preview.send}</div>
                <div className="pv-navitem">💳 {t.preview.account}</div>
                <div className="pv-navitem">🔐 {t.preview.passwords}</div>
                <div className="pv-navitem">📝 {t.preview.notes}</div>
              </div>
              <div className="pv-main">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 15 }}>{t.preview.cloud}</strong>
                  <span className="chip active" style={{ fontSize: 12 }}>
                    {t.preview.upload}
                  </span>
                </div>
                <div style={{ marginTop: 14 }}>
                  <span className="chip active">{t.preview.all}</span>
                  <span className="chip" style={{ marginLeft: 8 }}>
                    📄 {t.preview.docs}
                  </span>
                  <span className="chip" style={{ marginLeft: 8 }}>
                    🖼️ {t.preview.photos}
                  </span>
                </div>
                <div className="pv-grid">
                  {[
                    ['var(--accent-soft)', '1.2 MB', t.preview.today],
                    ['var(--red-soft)', '4.8 MB', t.preview.yesterday],
                    ['var(--green-soft)', '220 MB', t.preview.days],
                    ['var(--yellow-soft)', '4 KB', t.preview.week]
                  ].map(([bg, size, when], i) => (
                    <div className="pv-card" key={i}>
                      <div className="pv-tile" style={{ background: bg }} />
                      <div className="pv-name">{t.preview.files[i]}</div>
                      <div className="pv-meta">
                        {size} · {when}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="trustbar">
        <div className="wrap">
          {['⛓️', '🔒', '🇪🇺', '🧩'].map((icon, i) => (
            <span className="trustbadge" key={i}>
              {icon} {t.trustbar[i]}
            </span>
          ))}
        </div>
      </div>

      <section className="msection" id="produkt">
        <div className="wrap">
          <div className="eyebrow">{t.product.eyebrow}</div>
          <h2 className="sectitle">{t.product.title}</h2>
          <p className="subtitle">{t.product.subtitle}</p>
          <div className="features">
            {t.product.features.map((f, i) => (
              <div className="feature" key={f.title}>
                <div className="fi">
                  <svg className="icon" viewBox="0 0 24 24">
                    {FEATURE_ICONS[i]}
                  </svg>
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="msection" id="how" style={{ background: 'var(--card-soft)' }}>
        <div className="wrap">
          <div className="eyebrow">{t.how.eyebrow}</div>
          <h2 className="sectitle">{t.how.title}</h2>
          <p className="subtitle">{t.how.subtitle}</p>
          <div className="howsteps">
            {t.how.steps.map((s, i) => (
              <div className="howstep" key={s.title}>
                <div className="num">{i + 1}</div>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="msection" id="sicherheit">
        <div className="wrap">
          <div className="eyebrow">{t.compare.eyebrow}</div>
          <h2 className="sectitle">{t.compare.title}</h2>
          <p className="subtitle">{t.compare.subtitle}</p>
          <div className="tablescroll">
            <table className="comptable">
              <tbody>
                <tr>
                  <th>&nbsp;</th>
                  {t.compare.cols.map((c, i) => (
                    <th key={c} className={i === 0 ? 'colhi' : ''}>
                      {c}
                    </th>
                  ))}
                </tr>
                {t.compare.rows.map(row => (
                  <tr key={row[0]}>
                    <td>{row[0]}</td>
                    <td className="colhi">
                      <span className="okc">{row[1]}</span>
                    </td>
                    <td>{row[2]}</td>
                    <td>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="msection" id="preise" style={{ background: 'var(--card-soft)' }}>
        <div className="wrap">
          <div className="eyebrow">{t.pricing.eyebrow}</div>
          <h2 className="sectitle">{t.pricing.title}</h2>
          <p className="subtitle">{fmt(t.pricing.subtitle, { gb })}</p>
          <div className="plancontrols center">
            <div className="segmented" role="group">
              {(['month', 'year'] as const).map(i => (
                <button key={i} className={interval === i ? 'active' : ''} aria-pressed={interval === i} onClick={() => setIntervalState(i)}>
                  {i === 'month' ? t.pricing.monthly : t.pricing.yearly}
                  {i === 'year' && <span className="savechip">{t.pricing.yearlySave}</span>}
                </button>
              ))}
            </div>
            <LocaleSwitch showCurrency />
          </div>
          <div className="pricing">
            <div className="plan">
              <h3>Free</h3>
              <div className="price">
                {fmtMoney(0, currency, 0)}
                <span>{t.pricing.perMonth}</span>
              </div>
              <div className="desc">{fmt(t.pricing.freeDesc, { gb, price: payg })}</div>
              <ul>
                {t.pricing.freeFeatures.map(f => (
                  <li key={f}>
                    <CheckIcon />
                    {fmt(f, { gb })}
                  </li>
                ))}
              </ul>
              <button onClick={goRegister}>{t.pricing.freeCta}</button>
            </div>
            <div className="plan highlight">
              <span className="tag">{t.pricing.popular}</span>
              <h3>{offer.plans.pro.label}</h3>
              <div className="price">
                {fmtMoney(perMonth(offer.plans.pro), currency)}
                <span>{t.pricing.perMonth}</span>
              </div>
              <div className="billednote">
                {interval === 'year' ? fmt(t.pricing.billedYearly, { amount: fmtMoney(offer.plans.pro.yearly[currency], currency) }) : '\u00a0'}
              </div>
              <div className="desc">{t.pricing.proDesc}</div>
              <ul>
                {t.pricing.proFeatures.map(f => (
                  <li key={f}>
                    <CheckIcon />
                    {fmt(f, { tb: tb(offer.plans.pro.quotaGb), addon: fmtMoney(cheapestAddon, currency) })}
                  </li>
                ))}
              </ul>
              <button className="primary" onClick={goRegister}>
                {t.pricing.proCta}
              </button>
            </div>
            <div className="plan">
              <h3>{offer.plans.family.label}</h3>
              <div className="price">
                {fmtMoney(perMonth(offer.plans.family), currency)}
                <span>{t.pricing.perMonth}</span>
              </div>
              <div className="billednote">
                {interval === 'year' ? fmt(t.pricing.billedYearly, { amount: fmtMoney(offer.plans.family.yearly[currency], currency) }) : '\u00a0'}
              </div>
              <div className="desc">{fmt(t.pricing.familyDesc, { seats: offer.plans.family.seats })}</div>
              <ul>
                {t.pricing.familyFeatures.map(f => (
                  <li key={f}>
                    <CheckIcon />
                    {fmt(f, { tb: tb(offer.plans.family.quotaGb), seats: offer.plans.family.seats })}
                  </li>
                ))}
              </ul>
              <button onClick={goRegister}>{t.pricing.familyCta}</button>
            </div>
            <div className="plan">
              <h3>{t.pricing.business}</h3>
              <div className="price">{t.pricing.businessPrice}</div>
              <div className="desc">{t.pricing.businessDesc}</div>
              <ul>
                {t.pricing.businessFeatures.map(f => (
                  <li key={f}>
                    <CheckIcon />
                    {f}
                  </li>
                ))}
              </ul>
              <a href="mailto:hello@focvault.app">
                <button className="full">{t.pricing.businessCta}</button>
              </a>
            </div>
          </div>
          <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
            {t.pricing.vat}
          </p>
        </div>
      </section>

      <section className="msection" id="faq">
        <div className="wrap">
          <div className="eyebrow">FAQ</div>
          <h2 className="sectitle">{t.faq.title}</h2>
          <div className="faq">
            {t.faq.items.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>{item.q}</summary>
                <p>{fmt(item.a, vars)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="msection">
        <div className="wrap">
          <div className="ctaband">
            <h2>{t.cta.title}</h2>
            <p>{fmt(t.cta.body, { gb })}</p>
            <div className="herobtns" style={{ justifyContent: 'center' }}>
              <button className="primary lg" onClick={goRegister}>
                {t.cta.start}
              </button>
              <a href="mailto:hello@focvault.app">
                <button className="lg">{t.cta.talk}</button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="sitefooter">
        <div className="wrap">
          <div className="footgrid">
            <div>
              <div className="footbrand">
                <svg className="mark" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="20" fill="#0090ff" />
                </svg>
                FocVault
              </div>
              <div className="foottag">{t.footer.tag}</div>
            </div>
            <div className="footcol">
              <h5>{t.footer.product}</h5>
              <a href="#produkt">{t.footer.cloud}</a>
              <a href="#produkt">Secure Send</a>
              <a href="#preise">{t.nav.pricing}</a>
            </div>
            <div className="footcol">
              <h5>{t.footer.company}</h5>
              <a href="#sicherheit">{t.nav.security}</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="footcol">
              <h5>{t.footer.legal}</h5>
              <a href="#">{t.footer.privacy}</a>
              <a href="#">{t.footer.terms}</a>
              <a href="#">{t.footer.imprint}</a>
            </div>
          </div>
          <div className="footbottom">
            <span>{t.footer.copy}</span>
            <a className="builton" href="https://www.filecoin.cloud" target="_blank" rel="noreferrer">
              ⛓ {t.footer.builtOn}
            </a>
            <LocaleSwitch />
          </div>
        </div>
      </footer>
    </div>
  )
}

const FEATURE_ICONS = [
  <>
    <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
    <path d="M9 12l2 2 4-4" />
  </>,
  <>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </>,
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
  </>,
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
]

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
  )
}
