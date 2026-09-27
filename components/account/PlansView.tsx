'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/features/account/AccountProvider'
import ConfirmDialog from '@/components/ConfirmDialog'
import { api, isRedirect, type PublicOffer } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { billingMessages } from '@/lib/i18n/messages/billing'
import { commonMessages } from '@/lib/i18n/messages/common'
import { CURRENCIES, yearlySavingsPct, type Currency, type Interval } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

type PaidPlan = 'pro' | 'family'

/** Pakete, Pay-as-you-go und Zusatzspeicher – verständlich erklärt, in der Kontowährung. */
export default function PlansView() {
  const { account, refreshAccount } = useAccount()
  const { currency: prefCurrency, setCurrency, fmtMoney, fmtNumber, fmtDate } = useI18n()
  const m = useMessages(billingMessages)
  const c = useMessages(commonMessages)
  const errText = useErrorText()
  const [offer, setOffer] = useState<PublicOffer | null>(null)
  const [interval, setIntervalState] = useState<Interval>(account?.billing.interval ?? 'year')
  const [viewCurrency, setViewCurrency] = useState<Currency>(
    account && account.plan !== 'free' ? account.billing.currency : prefCurrency
  )
  const [calcGb, setCalcGb] = useState(100)
  const [capGb, setCapGb] = useState(100)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmFree, setConfirmFree] = useState(false)
  const [segment, setSegment] = useState<'private' | 'business'>(account?.plan === 'business' ? 'business' : 'private')
  // gewählte Zusatz-Nutzer je Stufe (im Elternteil, damit die Auswahl Re-Renders übersteht)
  const [seatChoice, setSeatChoice] = useState<Record<'starter' | 'business', number | undefined>>({ starter: undefined, business: undefined })

  // Rückkehr von Stripe: Hinweis zeigen und Konto neu laden (der Webhook kann ein paar Sekunden brauchen).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const text =
      q.get('checkout') === 'success' ? m.stripe.success : q.get('checkout') === 'cancelled' ? m.stripe.cancelled : q.get('payg') === 'ready' ? m.stripe.paygReady : null
    if (!text) return
    setMsg({ ok: q.get('checkout') !== 'cancelled', text })
    const timers = [1500, 4000, 9000].map(ms => setTimeout(() => void refreshAccount(), ms))
    window.history.replaceState(null, '', window.location.pathname + '?view=plans')
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    api.offer().then(o => {
      setOffer(o)
      setCapGb(c => (account?.billing.payg.enabled ? account.billing.payg.capGb : o.payg.defaultCapGb) || c)
    }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Free-Konten übernehmen die gewählte Währung (PAYG wird darin abgerechnet).
  useEffect(() => {
    if (account && account.plan === 'free' && account.billing.currency !== viewCurrency && !account.billing.addons.length) {
      void api.setCurrency(viewCurrency).then(() => refreshAccount()).catch(() => undefined)
    }
  }, [account, viewCurrency, refreshAccount])

  const isFree = account?.plan === 'free'
  const b = account?.billing

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    setMsg(null)
    try {
      const result = await fn()
      if (isRedirect(result)) {
        setMsg({ ok: true, text: m.stripe.redirecting })
        window.location.assign(result.redirectUrl)
        return
      }
      await refreshAccount()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy(null)
    }
  }

  const calc = useMemo(() => {
    if (!offer) return null
    const perGb = offer.payg.perGbMonth[viewCurrency]
    const cost = Math.round(calcGb * perGb * 100) / 100
    const breakEven = perGb > 0 ? Math.ceil(offer.plans.pro.monthly[viewCurrency] / perGb) : 0
    return { perGb, cost, carry: cost < offer.payg.minInvoice[viewCurrency], breakEven }
  }, [offer, viewCurrency, calcGb])

  if (!account || !b || !offer || !calc) return <div className="card">…</div>

  const tb = (gb: number) => fmtNumber(gb / 1000, 1)
  /** 0.03 → 2 Stellen, 0.035 → 3 Stellen (keine überflüssige Null) */
  const perGbMoney = (amount: number, c: Currency) => fmtMoney(amount, c, Math.round(amount * 1000) % 10 === 0 ? 2 : 3)
  const cur = viewCurrency
  const pct = account.quotaBytes > 0 ? Math.min(100, (account.usedBytes / account.quotaBytes) * 100) : 0

  const biz = b.business
  const BizCard = ({ tier }: { tier: 'starter' | 'business' }) => {
    const t = offer.business[tier]
    const text = m.biz[tier]
    const isCurrentTier = account.plan === 'business' && biz?.tier === tier && b.interval === interval && b.currency === cur
    const extra = seatChoice[tier] ?? (isCurrentTier ? (biz?.extraSeats ?? 0) : 0)
    const setExtra = (n: number) => setSeatChoice(c => ({ ...c, [tier]: n }))
    const unit = interval === 'year' ? offer.business.seat.yearly[cur] / 12 : offer.business.seat.monthly[cur]
    const base = interval === 'year' ? t.yearly[cur] / 12 : t.monthly[cur]
    const perMonth = base + extra * unit
    const yearlyTotal = t.yearly[cur] + extra * offer.business.seat.yearly[cur]
    const unchanged = isCurrentTier && extra === (biz?.extraSeats ?? 0)
    const vars = { tb: tb(t.quotaGb), seats: t.seats }
    return (
      <div className={`plancard ${tier === 'business' ? 'featured' : ''} ${isCurrentTier ? 'current' : ''}`}>
        {tier === 'business' && <span className="plantag">{m.popular}</span>}
        <h4>{text.name}</h4>
        <p className="dim">{text.tagline}</p>
        <div className="planprice">
          <strong>{fmtMoney(perMonth, cur)}</strong>
          <span>{m.perMonth}</span>
        </div>
        <div className="planbilled">
          {interval === 'year' ? fmt(m.billedYearly, { amount: fmtMoney(yearlyTotal, cur) }) : fmt(m.biz.perUser, { price: fmtMoney(unit, cur) })}
        </div>
        <label className="field seatpick">
          <span>{m.biz.users}</span>
          <select value={extra} onChange={e => setExtra(Number(e.target.value))} disabled={!!busy}>
            {[0, 1, 3, 5, 20, 50].map(n => (
              <option key={n} value={n}>
                {t.seats + n} {n === 0 ? `(${fmt(m.biz.usersIncluded, { n: t.seats })})` : `(${fmt(m.biz.extraUsers, { n })})`}
              </option>
            ))}
          </select>
        </label>
        <ul>
          {text.features.map(f => (
            <li key={f}>{fmt(f, vars)}</li>
          ))}
        </ul>
        <button
          className={unchanged ? '' : 'primary'}
          disabled={unchanged || !!busy || !offer.purchasesEnabled || !!biz?.member}
          onClick={() =>
            void run(tier, () => api.changePlan('business', interval, cur, { tier, extraSeats: extra }), isCurrentTier ? fmt(m.biz.seatsSaved, { n: t.seats + extra }) : fmt(m.planChanged, { plan: text.name }))
          }
        >
          {busy === tier ? '…' : unchanged ? m.current : isCurrentTier ? m.save : account.plan === 'business' ? m.switchTo : m.upgrade}
        </button>
      </div>
    )
  }

  const EnterpriseCard = () => {
    const e = offer.business.enterprise
    return (
      <div className={`plancard ${biz?.tier === 'enterprise' ? 'current' : ''}`}>
        <h4>{m.biz.enterprise.name}</h4>
        <p className="dim">{m.biz.enterprise.tagline}</p>
        <div className="planprice">
          <span>{m.biz.from}</span>
          <strong>{fmtMoney(e.fromMonthly[cur], cur, 0)}</strong>
          <span>{m.perMonth}</span>
        </div>
        <div className="planbilled">{m.biz.custom}</div>
        <ul>
          {m.biz.enterprise.features.map(f => (
            <li key={f}>{fmt(f, { tb: tb(e.quotaGb), seats: e.seats })}</li>
          ))}
        </ul>
        <a className="planbtn" href={`mailto:${e.contact}?subject=FocVault%20Enterprise`}>
          <button className="full">{biz?.tier === 'enterprise' ? m.current : m.biz.contact}</button>
        </a>
      </div>
    )
  }

  const PlanCard = ({ plan }: { plan: 'free' | PaidPlan }) => {
    const isCurrent =
      account.plan === plan && (plan === 'free' || (b.interval === interval && b.currency === cur))
    const text = plan === 'free' ? m.free : plan === 'pro' ? m.pro : m.family
    const item = plan === 'free' ? null : offer.plans[plan]
    const vars = { gb: offer.free.quotaGb, tb: item ? tb(item.quotaGb) : 0, seats: offer.plans.family.seats }
    const label = isCurrent ? m.current : plan === 'free' ? m.downgrade : isFree ? m.upgrade : m.switchTo
    return (
      <div className={`plancard ${plan === 'pro' ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}>
        {plan === 'pro' && <span className="plantag">{m.popular}</span>}
        <h4>{text.name}</h4>
        <p className="dim">{fmt(text.tagline, vars)}</p>
        <div className="planprice">
          {item ? (
            <>
              <strong>{fmtMoney(interval === 'year' ? item.yearly[cur] / 12 : item.monthly[cur], cur)}</strong>
              <span>{m.perMonth}</span>
            </>
          ) : (
            <>
              <strong>{fmtMoney(0, cur, 0)}</strong>
              <span>{m.perMonth}</span>
            </>
          )}
        </div>
        <div className="planbilled">
          {item && interval === 'year' ? (
            <>
              {fmt(m.billedYearly, { amount: fmtMoney(item.yearly[cur], cur) })}{' '}
              <span className="badge ok">{fmt(m.savePct, { pct: yearlySavingsPct(item, cur) })}</span>
            </>
          ) : plan === 'free' ? (
            fmt(m.payg.step2Title, { price: perGbMoney(offer.payg.perGbMonth[cur], cur) })
          ) : (
            '\u00a0'
          )}
        </div>
        <ul>
          {text.features.map(f => (
            <li key={f}>{fmt(f, vars)}</li>
          ))}
        </ul>
        <button
          className={isCurrent ? '' : plan === 'free' ? '' : 'primary'}
          disabled={isCurrent || !!busy || !offer.purchasesEnabled}
          onClick={() => {
            if (plan === 'free') return setConfirmFree(true)
            void run(plan, () => api.changePlan(plan, interval, cur), fmt(m.planChanged, { plan: text.name }))
          }}
        >
          {busy === plan ? '…' : label}
        </button>
      </div>
    )
  }

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}

      <div className="card planhead">
        <div>
          <h3 style={{ marginBottom: 6 }}>{m.title}</h3>
          <p className="dim">{m.subtitle}</p>
        </div>
        <div className="planusage">
          <div className="lbl">
            <span>{m.usage}</span>
            <span>
              {formatBytes(account.usedBytes)} {m.of} {formatBytes(account.quotaBytes)}
            </span>
          </div>
          <div className="quotabar">
            <div className={pct >= 100 ? 'full' : ''} style={{ width: `${pct}%` }} />
          </div>
          <div className="lbl" style={{ marginTop: 8 }}>
            <span>{m.monthlyTotal}</span>
            <span>
              <strong>{fmtMoney(b.monthlyTotal, b.currency)}</strong> <span className="dim">{m.monthlyTotalHint}</span>
            </span>
          </div>
        </div>
      </div>

      {b.stripe && (b.subscription.provider === 'stripe' || b.subscription.hasPaymentAccount) && (
        <div className={`card substatus ${b.subscription.status === 'past_due' ? 'warn' : ''}`}>
          <div>
            {b.subscription.status === 'past_due' && <div className="errorbox">{m.stripe.pastDue}</div>}
            {b.subscription.provider === 'stripe' && b.subscription.periodEnd && (
              <strong>
                {fmt(b.subscription.cancelAtPeriodEnd ? m.stripe.ends : m.stripe.renews, { date: fmtDate(b.subscription.periodEnd) })}
              </strong>
            )}
            <div className="hint">{m.stripe.manageHint}</div>
          </div>
          <div className="row">
            {b.subscription.cancelAtPeriodEnd && (
              <button className="primary small" disabled={!!busy} onClick={() => void run('resume', () => api.resumeSubscription(), m.stripe.resumed)}>
                {m.stripe.resume}
              </button>
            )}
            <button className="small" disabled={!!busy} onClick={() => void run('portal', () => api.billingPortal(), '')}>
              {m.stripe.manage}
            </button>
          </div>
        </div>
      )}

      <div className="audienceswitch" role="tablist" aria-label={`${m.segment.private} / ${m.segment.business}`}>
        {(['private', 'business'] as const).map(sg => (
          <button key={sg} role="tab" aria-selected={segment === sg} className={segment === sg ? 'active' : ''} onClick={() => setSegment(sg)}>
            {sg === 'private' ? m.segment.private : m.segment.business}
          </button>
        ))}
      </div>
      {segment === 'business' && <p className="dim audiencelead">{m.biz.lead}</p>}
      {biz?.member && <div className="notice">{m.biz.member}</div>}

      <div className="plancontrols">
        <div className="segmented" role="group" aria-label={m.yearly}>
          {(['month', 'year'] as const).map(i => (
            <button key={i} className={interval === i ? 'active' : ''} aria-pressed={interval === i} onClick={() => setIntervalState(i)}>
              {i === 'month' ? m.monthly : m.yearly}
              {i === 'year' && <span className="savechip">{m.yearlySave}</span>}
            </button>
          ))}
        </div>
        <label className="currencypick">
          <span className="dim">{m.currency}</span>
          <select
            value={cur}
            onChange={e => {
              const c = e.target.value as Currency
              setViewCurrency(c)
              setCurrency(c)
            }}
          >
            {CURRENCIES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {segment === 'private' ? (
        <div className="plancards">
          <PlanCard plan="free" />
          <PlanCard plan="pro" />
          <PlanCard plan="family" />
        </div>
      ) : (
        <div className="plancards">
          <BizCard tier="starter" />
          <BizCard tier="business" />
          <EnterpriseCard />
        </div>
      )}
      <p className="hint" style={{ marginBottom: 18 }}>
        {m.vatNote} {!offer.purchasesEnabled ? m.stripeSoon : b.stripe ? m.stripe.secure : m.devNote}
      </p>

      {confirmFree && (
        <ConfirmDialog
          title={m.downgrade}
          body={b.subscription.provider === 'stripe' ? m.stripe.confirmCancel : fmt(m.confirmDowngrade, { gb: offer.free.quotaGb })}
          confirmLabel={m.downgrade}
          cancelLabel={c.cancel}
          onCancel={() => setConfirmFree(false)}
          onConfirm={() => {
            setConfirmFree(false)
            void run('free', () => api.changePlan('free', interval, cur), b.subscription.provider === 'stripe' ? m.stripe.cancelScheduled : fmt(m.planChanged, { plan: m.free.name }))
          }}
        />
      )}

      {isFree && segment === 'private' && (
        <div className="card">
          <h3>
            {m.payg.title} <span className="badge ok">{m.payg.badge}</span>
          </h3>
          <p className="lead" style={{ marginTop: 0 }}>
            {fmt(m.payg.intro, { gb: offer.free.quotaGb })}
          </p>
          <div className="paygsteps">
            {[
              [fmt(m.payg.step1Title, { gb: offer.free.quotaGb }), m.payg.step1],
              [fmt(m.payg.step2Title, { price: perGbMoney(calc.perGb, cur) }), m.payg.step2],
              [m.payg.step3Title, fmt(m.payg.step3, { min: fmtMoney(offer.payg.minInvoice[cur], cur) })]
            ].map(([title, body], i) => (
              <div className="paygstep" key={i}>
                <span className="stepnum">{i + 1}</span>
                <strong>{title}</strong>
                <p className="dim">{body}</p>
              </div>
            ))}
          </div>

          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="paygcalc">
              <strong>{m.payg.calcTitle}</strong>
              <label className="field" style={{ marginTop: 10 }}>
                <span className="dim">
                  {m.payg.calcExtra}: <strong>{fmtNumber(calcGb)} GB</strong>
                </span>
                <input type="range" min={0} max={1000} step={10} value={calcGb} onChange={e => setCalcGb(Number(e.target.value))} />
              </label>
              <div className="stat">
                <span className="k">{m.payg.calcCost}</span>
                <span className="v">
                  <strong>{fmtMoney(calc.cost, cur)}</strong>
                  {calc.carry && calc.cost > 0 && (
                    <span className="dim"> · {fmt(m.payg.calcCarry, { min: fmtMoney(offer.payg.minInvoice[cur], cur) })}</span>
                  )}
                </span>
              </div>
              <p className="hint" style={{ color: calcGb >= calc.breakEven ? 'var(--accent-dark)' : undefined }}>
                {calcGb >= calc.breakEven
                  ? m.payg.proCheaperNow
                  : fmt(m.payg.proCheaper, { gb: fmtNumber(calc.breakEven), tb: tb(offer.plans.pro.quotaGb) })}
              </p>
            </div>

            <div>
              <div className="stat">
                <span className="k">{m.payg.status}</span>
                <span className="v">{b.payg.enabled ? fmt(m.payg.active, { cap: fmtNumber(b.payg.capGb) }) : m.payg.inactive}</span>
              </div>
              {b.payg.enabled && (
                <div className="stat">
                  <span className="k">{m.payg.thisMonth}</span>
                  <span className="v">
                    {fmtMoney(b.payg.estimate, b.currency)} · {fmt(m.payg.billable, { gb: fmtNumber(b.payg.billableGb, 1) })}
                  </span>
                </div>
              )}
              <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="field" style={{ maxWidth: 160, marginBottom: 0 }}>
                  <span className="hint">{m.payg.cap}</span>
                  <input
                    type="number"
                    min={1}
                    max={offer.payg.maxCapGb}
                    value={capGb}
                    onChange={e => setCapGb(Math.max(1, Math.min(offer.payg.maxCapGb, Number(e.target.value) || 1)))}
                  />
                </label>
                {b.payg.enabled ? (
                  <>
                    <button className="small" disabled={!!busy} onClick={() => void run('payg', () => api.setPayg(true, capGb), m.payg.capSaved)}>
                      {m.payg.saveCap}
                    </button>
                    <button className="small" disabled={!!busy} onClick={() => void run('payg', () => api.setPayg(false), m.payg.disabled)}>
                      {m.payg.disable}
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={!!busy || !offer.purchasesEnabled}
                    onClick={() => void run('payg', () => api.setPayg(true, capGb), m.payg.enabled)}
                  >
                    {m.payg.enable}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isFree && !biz?.member && (account.plan === 'pro' || account.plan === 'family' || account.plan === 'business') && (
        <div className="card">
          <h3>{m.addons.title}</h3>
          <p className="dim" style={{ marginBottom: 12 }}>
            {m.addons.intro}
          </p>
          {b.addons.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <strong>{m.addons.yours}</strong>
              {b.addons.map(a => (
                <div className="stat" key={a.id}>
                  <span className="k">
                    +{a.gb >= 1000 ? `${tb(a.gb)} TB` : `${fmtNumber(a.gb)} GB`} {a.source === 'admin' ? `(${m.addons.grant})` : ''}
                  </span>
                  <span className="v">
                    {fmtMoney(a.price, a.currency)} {a.interval === 'year' ? m.perYear : m.perMonth}{' '}
                    <button className="small" disabled={!!busy} onClick={() => void run(a.id, () => api.cancelAddon(a.id), m.addons.cancelled)}>
                      {m.addons.cancel}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="storeoptions">
            {offer.addons.map(a => {
              const label = a.gb >= 1000 ? `${tb(a.gb)} TB` : `${fmtNumber(a.gb)} GB`
              return (
                <div className="storeoption" key={a.id}>
                  <span className="gb">+{label}</span>
                  <span className="price">
                    {fmtMoney((b.interval === 'year' ? a.yearly : a.monthly)[b.currency], b.currency)}{' '}
                    {b.interval === 'year' ? m.perYear : m.perMonth}
                  </span>
                  <button
                    className="small primary"
                    disabled={!!busy || !offer.purchasesEnabled}
                    onClick={() => void run(a.id, () => api.buyAddon(a.id), fmt(m.addons.booked, { gb: label }))}
                  >
                    {busy === a.id ? '…' : m.addons.book}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
