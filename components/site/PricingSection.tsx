'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LocaleSwitch from '@/components/LocaleSwitch'
import { api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { landingMessages } from '@/lib/i18n/messages/landing'
import { landing2Messages } from '@/lib/i18n/messages/landing2'
import { Icon, type IconName } from '@/components/site/Icons'
import { DEFAULT_PRICING, type Interval, type PricingConfig } from '@/lib/pricing'

type Offer = Pick<PricingConfig, 'free' | 'payg' | 'plans' | 'addons' | 'business'>

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
  )
}

/** Preise (Landing, neue Landing): Free, Pro, Family, Business – Währung und Intervall wählbar. */
export default function PricingSection() {
  const router = useRouter()
  const { path, currency, fmtMoney, fmtNumber } = useI18n()
  const t = useMessages(landingMessages)
  const mods = useMessages(landing2Messages).modules
  const [interval, setIntervalState] = useState<Interval>('year')
  const [offer, setOffer] = useState<Offer>(DEFAULT_PRICING)
  useEffect(() => {
    api.offer().then(setOffer).catch(() => undefined)
  }, [])
  const goRegister = () => router.push(path('/registrieren'))
  const gb = offer.free.quotaGb
  const payg = fmtMoney(offer.payg.perGbMonth[currency], currency, 2)
  const perMonth = (item: { monthly: Record<string, number>; yearly: Record<string, number> }) =>
    interval === 'year' ? item.yearly[currency] / 12 : item.monthly[currency]
  const tb = (quota: number) => fmtNumber(quota / 1000, 1)
  const cheapestAddon = Math.min(...offer.addons.map(a => (interval === 'year' ? a.yearly[currency] / 12 : a.monthly[currency])))
  return (
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
              <div className="price">
                <span className="pricefrom">{t.pricing.from}</span> {fmtMoney(perMonth(offer.business.starter), currency, 0)}
                <span>{t.pricing.perMonth}</span>
              </div>
              <div className="billednote">{fmt(t.pricing.businessSeats, { seats: offer.business.starter.seats, price: fmtMoney(offer.business.seat.monthly[currency], currency, 0) })}</div>
              <div className="desc">{t.pricing.businessDesc}</div>
              <ul>
                {t.pricing.businessFeatures.map(f => (
                  <li key={f}>
                    <CheckIcon />
                    {f}
                  </li>
                ))}
              </ul>
              <button className="full" onClick={() => router.push(path('/support?topic=business'))}>
                {t.pricing.businessCta}
              </button>
            </div>
          </div>
          <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
            {t.pricing.vat}
          </p>
          <details className="cmpall">
            <summary>
              <span>{mods.compareOpen}</span>
              <Icon name="arrow" size={15} />
            </summary>
            <div className="cmpwrap">
              <table className="cmptable">
                <thead>
                  <tr>
                    <th />
                    {['Free', 'Pro', 'Family', 'Business'].map(p => (
                      <th key={p}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mods.items.map(x => {
                    const rank: Record<string, number> = { Free: 0, Alle: 0, Pro: 1, Family: 2, Business: 3, Enterprise: 3 }
                    const r = rank[x.p] ?? 0
                    const cell = (col: number) => {
                      if (x.p === 'Enterprise') return col === 3 ? <span className="cmpnote">Enterprise</span> : <span className="cmpno">—</span>
                      if (x.p === 'Family') return col >= 2 ? <span className="cmpyes">✓</span> : <span className="cmpno">—</span>
                      if (x.p === 'Business') return col === 3 ? <span className="cmpyes">✓</span> : <span className="cmpno">—</span>
                      return col >= r ? <span className="cmpyes">✓</span> : <span className="cmpno">—</span>
                    }
                    return (
                      <tr key={x.t}>
                        <th scope="row">
                          <Icon name={x.i as IconName} size={15} />
                          <span>
                            <b>{x.t}</b>
                            <small>{x.d}</small>
                          </span>
                        </th>
                        {[0, 1, 2, 3].map(c => (
                          <td key={c}>{cell(c)}</td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>
  )
}
