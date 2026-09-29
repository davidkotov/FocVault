'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/site/Icons'
import { useAccount } from '@/features/account/AccountProvider'
import ConfirmDialog from '@/components/ConfirmDialog'
import { api, isRedirect, type PublicOffer } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { billingMessages } from '@/lib/i18n/messages/billing'
import { commonMessages } from '@/lib/i18n/messages/common'
import { CURRENCIES, type Currency, type Interval } from '@/lib/pricing'
import { formatBytes } from '@/lib/vault'

type PaidPlan = 'pro' | 'family'

/** Pakete, Pay-as-you-go und Zusatzspeicher – verständlich erklärt, in der Kontowährung. */
export default function PlansView({ initialSegment, onCredits }: { initialSegment?: 'private' | 'business'; onCredits?: () => void } = {}) {
  const { account, refreshAccount, vault } = useAccount()
  const { currency: prefCurrency, setCurrency, fmtMoney, fmtNumber, fmtDate, path } = useI18n()
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
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('pageactions-slot')), [])
  const [payReady, setPayReady] = useState<boolean | null>(null)
  const [needPay, setNeedPay] = useState(false)
  useEffect(() => {
    // Zahlungsmethode ist Pflicht (ohne Stripe entscheidet der Server, z. B. lokal)
    api.credits().then(c => setPayReady(c.hasPaymentMethod || !c.stripe)).catch(() => setPayReady(false))
  }, [])
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof api.invoices>> | null>(null)
  useEffect(() => {
    api.invoices().then(setInvoices).catch(() => setInvoices({ stripe: false, invoices: [], card: null }))
  }, [])
  const [segment, setSegment] = useState<'private' | 'business'>(initialSegment ?? (account?.plan === 'business' ? 'business' : 'private'))
  // gewählte Zusatz-Nutzer je Stufe (im Elternteil, damit die Auswahl Re-Renders übersteht)
  const [customSeats, setCustomSeats] = useState<Record<'starter' | 'business', boolean>>({ starter: false, business: false })
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
  const planName = account.plan === 'business' && biz ? offer.business[biz.tier].label : account.plan === 'free' ? m.free.name : offer.plans[account.plan as PaidPlan].label
  const packs = account.plan === 'business' ? offer.businessAddons : offer.addons
  const addInterval: Interval = isFree ? interval : b.interval
  const addCur: Currency = isFree ? cur : b.currency
  const canAddons = !isFree && !biz?.member
  const gbLabel = (gb: number) => (gb >= 1000 ? `${tb(gb)} TB` : `${fmtNumber(gb)} GB`)
  const monthPrice = (x: { monthly: Record<Currency, number>; yearly: Record<Currency, number> }) => (interval === 'year' ? x.yearly[cur] / 12 : x.monthly[cur])
  const paygMax = offer.payg.perGbMonth[b.currency] * capGb

  const switchPlan = (plan: PaidPlan, i: Interval, cu: Currency) =>
    void run(plan + i, () => api.changePlan(plan, i, cu), fmt(m.planChanged, { plan: plan === 'pro' ? m.pro.name : m.family.name }))

  const segSwitch = (
    <div className="audienceswitch" role="tablist" aria-label={`${m.segment.private} / ${m.segment.business}`}>
      {(['private', 'business'] as const).map(sg => (
        <button key={sg} role="tab" aria-selected={segment === sg} className={segment === sg ? 'active' : ''} onClick={() => setSegment(sg)}>
          {sg === 'private' ? m.segment.private : m.segment.business}
        </button>
      ))}
    </div>
  )

  return (
    <>
      {slot ? createPortal(segSwitch, slot) : segSwitch}
      {msg && <div className={msg.ok ? 'notice' : 'errorbox'}>{msg.text}</div>}
      {b.subscription.status === 'past_due' && <div className="errorbox">{m.stripe.pastDue}</div>}
      {biz?.member && <div className="notice">{m.biz.member}</div>}

      <div className="planhero">
        <div className="card planhero-main">
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="badge dark">{m.hero.current}</span>
            <b className="planhero-name">
              {planName}
              {account.plan !== 'free' && ` · ${b.interval === 'year' ? m.yearly : m.monthly}`}
            </b>
            <span style={{ flex: 1 }} />
            <span className="dim">
              {b.subscription.periodEnd
                ? fmt(b.subscription.cancelAtPeriodEnd ? m.stripe.ends : m.stripe.renews, { date: fmtDate(b.subscription.periodEnd) })
                : fmt(m.hero.perMonthTotal, { amount: fmtMoney(b.monthlyTotal, b.currency) })}
            </span>
          </div>
          <div className="planhero-used">
            <b>{formatBytes(account.usedBytes)}</b>
            <span className="dim">
              {m.of} {formatBytes(account.quotaBytes)}
              {b.addons.length > 0 && ` (${formatBytes(b.baseBytes)} + ${formatBytes(b.addonBytes)} ${m.hero.extra})`}
            </span>
          </div>
          {(() => {
            const trash = (vault.trash ?? []).reduce((n, f) => n + f.size, 0)
            const ver = vault.files.reduce((n, f) => n + (f.versions ?? []).reduce((x, v) => x + (v.size ?? 0), 0), 0)
            const files = Math.max(0, account.usedBytes - trash - ver)
            const w = (x: number) => `${account.quotaBytes ? Math.min(100, (x / account.quotaBytes) * 100) : 0}%`
            return (
              <>
                <div className={`planbar${pct >= 100 ? ' full' : ''}`}>
                  <b style={{ width: w(files), background: 'var(--dk-bar-1, #0b1220)' }} />
                  <b style={{ width: w(ver), background: 'var(--dk-bar-2, #5b6475)' }} />
                  <b style={{ width: w(trash), background: 'var(--dk-bar-3, #8a93a3)' }} />
                </div>
                <div className="planlegend">
                  <span>
                    <i style={{ background: 'var(--dk-bar-1, #0b1220)' }} />
                    {m.hero.files} {formatBytes(files)}
                  </span>
                  <span>
                    <i style={{ background: 'var(--dk-bar-2, #5b6475)' }} />
                    {m.hero.versions} {formatBytes(ver)}
                  </span>
                  <span>
                    <i style={{ background: 'var(--dk-bar-3, #8a93a3)' }} />
                    {m.hero.trash} {formatBytes(trash)}
                  </span>
                </div>
              </>
            )
          })()}
          <div className="planhero-actions">
            {account.plan === 'free' && (
              <button className="primary small" disabled={!!busy || !offer.purchasesEnabled} onClick={() => switchPlan('pro', interval, cur)}>
                {fmt(m.hero.toPlan, { plan: m.pro.name })}
              </button>
            )}
            {account.plan === 'pro' && (
              <button className="small" disabled={!!busy || !offer.purchasesEnabled} onClick={() => switchPlan('family', b.interval, b.currency)}>
                {fmt(m.hero.toPlan, { plan: m.family.name })}
              </button>
            )}
            {(account.plan === 'pro' || account.plan === 'family') && (
              <button
                className="small"
                disabled={!!busy || !offer.purchasesEnabled}
                onClick={() => switchPlan(account.plan as PaidPlan, b.interval === 'year' ? 'month' : 'year', b.currency)}
              >
                {b.interval === 'year' ? m.hero.payMonthly : m.hero.payYearly}
              </button>
            )}
            {account.plan === 'family' && (
              <button className="small" onClick={() => setSegment('business')}>
                {fmt(m.hero.toPlan, { plan: m.segment.business })}
              </button>
            )}
            <span style={{ flex: 1 }} />
            {b.subscription.cancelAtPeriodEnd ? (
              <button className="small" disabled={!!busy} onClick={() => void run('resume', () => api.resumeSubscription(), m.stripe.resumed)}>
                {m.stripe.resume}
              </button>
            ) : (
              account.plan !== 'free' &&
              !biz?.member && (
                <button className="linkish" disabled={!!busy} onClick={() => setConfirmFree(true)}>
                  {m.hero.cancel}
                </button>
              )
            )}
          </div>
        </div>

        <div className="card planhero-side">
          <b className="planhero-name" style={{ fontSize: 15 }}>
            Pay-as-you-go
          </b>
          <p className="dim" style={{ margin: '6px 0 0' }}>
            {fmt(m.paygSide.lead, { gb: offer.free.quotaGb, price: perGbMoney(offer.payg.perGbMonth[b.currency], b.currency) })}
          </p>
          <div className="planhero-rows">
            <div>
              <span className="dim">{m.paygSide.cap}</span>
              {isFree ? (
                <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input
                    className="capinput"
                    type="number"
                    aria-label={m.payg.cap}
                    min={1}
                    max={offer.payg.maxCapGb}
                    value={capGb}
                    onChange={e => setCapGb(Math.max(1, Math.min(offer.payg.maxCapGb, Number(e.target.value) || 1)))}
                  />
                  <b>GB · max. {fmtMoney(paygMax, b.currency)}</b>
                </span>
              ) : (
                <b>{fmt(m.paygSide.capValue, { gb: fmtNumber(capGb), max: fmtMoney(paygMax, b.currency) })}</b>
              )}
            </div>
            <div>
              <span className="dim">{m.paygSide.thisMonth}</span>
              <b>{fmtMoney(b.payg.enabled ? b.payg.estimate : 0, b.currency)}</b>
            </div>
          </div>
          {isFree ? (
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              {b.payg.enabled ? (
                <>
                  <span className="badge ok">{fmt(m.payg.active, { cap: fmtNumber(b.payg.capGb) })}</span>
                  <span style={{ flex: 1 }} />
                  {capGb !== b.payg.capGb && (
                    <button className="small primary" disabled={!!busy} onClick={() => void run('payg', () => api.setPayg(true, capGb), m.payg.capSaved)}>
                      {m.payg.saveCap}
                    </button>
                  )}
                  <button className="small" disabled={!!busy} onClick={() => void run('payg', () => api.setPayg(false), m.payg.disabled)}>
                    {m.payg.disable}
                  </button>
                </>
              ) : (
                <button
                  className="primary small"
                  disabled={!!busy || payReady === null}
                  onClick={() => (payReady ? void run('payg', () => api.setPayg(true, capGb), m.payg.enabled) : setNeedPay(true))}
                >
                  {m.payg.enable}
                </button>
              )}
            </div>
          ) : null}
          {isFree && needPay && !b.payg.enabled && (
            <div className="notice warn paygneed">
              <span>{m.paygSide.needPay}</span>
              {onCredits && (
                <button className="small" onClick={onCredits}>
                  {m.paygSide.toCredits}
                </button>
              )}
            </div>
          )}
          {isFree && <p className="hint" style={{ marginTop: 10 }}>{m.paygSide.howBilled}</p>}
          {!isFree && (
            <p className="hint" style={{ marginTop: 12 }}>
              {fmt(m.paygSide.inactivePlan, { plan: planName })}
            </p>
          )}
        </div>
      </div>

      <div className="card plansection">
        <div className="plansection-head">
          <h3>{m.addons.title}</h3>
          <span className="dim">{m.grid.rhythm}</span>
        </div>
        <div className="addongrid">
          {packs.map(a => {
            const label = gbLabel(a.gb)
            const owned = b.addons.find(x => x.gb === a.gb && x.source !== 'admin')
            return (
              <div className={`addoncard${owned ? ' owned' : ''}`} key={a.id}>
                <span className="addon-gb">+{label}</span>
                <b className="addon-price">{(() => { const v = (addInterval === 'year' ? a.yearly : a.monthly)[addCur]; return fmtMoney(v, addCur, Number.isInteger(v) ? 0 : 2) })()}</b>
                <span className="dim">{addInterval === 'year' ? m.grid.perYear : m.grid.perMonth}</span>
                <div className="addon-act">
                  {owned ? (
                    <>
                      <span className="badge ok">{m.grid.booked}</span>
                      <button className="linkish" disabled={!!busy} onClick={() => void run(owned.id, () => api.cancelAddon(owned.id), m.addons.cancelled)}>
                        {m.addons.cancel}
                      </button>
                    </>
                  ) : canAddons ? (
                    <button className="small" disabled={!!busy || !offer.purchasesEnabled} onClick={() => void run(a.id, () => api.buyAddon(a.id), fmt(m.addons.booked, { gb: label }))}>
                      {busy === a.id ? '…' : m.addons.book}
                    </button>
                  ) : (
                    <button className="small locked" data-tip={m.grid.locked} aria-label={`${m.addons.book} – ${m.grid.locked}`} onClick={() => setSegment('private')}>
                      <Icon name="lock" size={13} /> {m.addons.book}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          <div className="addoncard custom">
            <span className="addon-gb">{m.grid.customTitle}</span>
            <b className="addon-price" style={{ fontSize: 16 }}>
              {m.grid.customQ}
            </b>
            <span className="dim">{m.grid.customLead}</span>
            <div className="addon-act">
              <a className="button small primary" href={path(`/support?topic=storage&plan=${account.plan}`)}>
                {m.grid.customBtn}
              </a>
            </div>
          </div>
        </div>
        {b.addons.some(x => x.source === 'admin') && (
          <p className="hint" style={{ marginTop: 10 }}>
            {b.addons
              .filter(x => x.source === 'admin')
              .map(x => `+${gbLabel(x.gb)} (${m.addons.grant})`)
              .join(' · ')}
          </p>
        )}
      </div>

      <div className="plangrid2">
        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.compare.title}</h3>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <div className="segmented small" role="group" aria-label={m.yearly}>
                {(['month', 'year'] as const).map(i => (
                  <button key={i} className={interval === i ? 'active' : ''} aria-pressed={interval === i} onClick={() => setIntervalState(i)}>
                    {i === 'month' ? m.monthly : m.yearly}
                  </button>
                ))}
              </div>
              <select
                aria-label={m.currency}
                className="smallselect"
                value={cur}
                onChange={e => {
                  const c2 = e.target.value as Currency
                  setViewCurrency(c2)
                  setCurrency(c2)
                }}
              >
                {CURRENCIES.map(c2 => (
                  <option key={c2}>{c2}</option>
                ))}
              </select>
            </div>
          </div>
          <table className="plantable">
            <thead>
              <tr>
                <th>{m.compare.plan}</th>
                <th>{m.compare.storage}</th>
                <th>{m.compare.people}</th>
                <th>{m.compare.price}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {segment === 'private' ? (
                <>
                  {(['free', 'pro', 'family'] as const).map(plan => {
                    const item = plan === 'free' ? null : offer.plans[plan]
                    const isCur = account.plan === plan
                    const exact = isCur && (plan === 'free' || (b.interval === interval && b.currency === cur))
                    const name = plan === 'free' ? m.free.name : plan === 'pro' ? m.pro.name : m.family.name
                    return (
                      <tr key={plan} className={isCur ? 'current' : ''}>
                        <td>
                          <b>{name}</b> {isCur && <span className="badge dark">{m.compare.current}</span>}
                        </td>
                        <td>{item ? `${tb(item.quotaGb)} TB` : `${offer.free.quotaGb} GB`}</td>
                        <td>{plan === 'family' ? offer.plans.family.seats : 1}</td>
                        <td>{item ? fmtMoney(monthPrice(item), cur) : fmtMoney(0, cur, 0)}</td>
                        <td className="act">
                          {!exact && (
                            <button
                              className="small"
                              disabled={!!busy || !offer.purchasesEnabled || !!biz?.member}
                              onClick={() => (plan === 'free' ? setConfirmFree(true) : switchPlan(plan, interval, cur))}
                            >
                              {busy === plan + interval ? '…' : isCur ? m.save : isFree ? m.upgrade : m.switchTo}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td>
                      <b>{m.segment.business}</b>
                    </td>
                    <td>
                      {m.compare.from} {tb(offer.business.starter.quotaGb)} TB
                    </td>
                    <td>
                      {m.compare.from} {offer.business.starter.seats}
                    </td>
                    <td>
                      {m.compare.from} {fmtMoney(monthPrice(offer.business.starter), cur, 0)}
                    </td>
                    <td className="act">
                      <button className="small" onClick={() => setSegment('business')}>
                        {m.compare.view}
                      </button>
                    </td>
                  </tr>
                </>
              ) : (
                <>
                  {(['starter', 'business'] as const).map(tier => {
                    const t2 = offer.business[tier]
                    const isCurTier = account.plan === 'business' && biz?.tier === tier
                    const extra = seatChoice[tier] ?? (isCurTier ? (biz?.extraSeats ?? 0) : 0)
                    const unit = interval === 'year' ? offer.business.seat.yearly[cur] / 12 : offer.business.seat.monthly[cur]
                    const unchanged = isCurTier && b.interval === interval && b.currency === cur && extra === (biz?.extraSeats ?? 0)
                    return (
                      <tr key={tier} className={isCurTier ? 'current' : ''}>
                        <td>
                          <b>{t2.label}</b> {isCurTier && <span className="badge dark">{m.compare.current}</span>}
                        </td>
                        <td>{tb(t2.quotaGb)} TB</td>
                        <td>
                          {(() => {
                            const total = t2.seats + extra
                            const opts = [5, 10, 20, 50, 100].filter(n => n >= t2.seats)
                            const isCustom = customSeats[tier] || !opts.includes(total)
                            const setTotal = (n: number) => setSeatChoice(c2 => ({ ...c2, [tier]: Math.max(0, Math.round(n) - t2.seats) }))
                            return (
                              <span className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                                <select
                                  className="smallselect"
                                  aria-label={`${m.biz.users} ${t2.label}`}
                                  value={isCustom ? 'custom' : String(total)}
                                  disabled={!!busy}
                                  onChange={e => {
                                    if (e.target.value === 'custom') return setCustomSeats(c2 => ({ ...c2, [tier]: true }))
                                    setCustomSeats(c2 => ({ ...c2, [tier]: false }))
                                    setTotal(Number(e.target.value))
                                  }}
                                >
                                  {opts.map(n => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                  <option value="custom">{m.compare.customSeats}</option>
                                </select>
                                {isCustom && (
                                  <input
                                    className="capinput"
                                    type="number"
                                    min={t2.seats}
                                    max={10000}
                                    aria-label={`${m.compare.customSeatsLabel} ${t2.label}`}
                                    value={total}
                                    onChange={e => setTotal(Math.max(t2.seats, Math.min(10000, Number(e.target.value) || t2.seats)))}
                                  />
                                )}
                              </span>
                            )
                          })()}
                        </td>
                        <td>{fmtMoney(monthPrice(t2) + extra * unit, cur)}</td>
                        <td className="act">
                          {!unchanged && (
                            <button
                              className="small"
                              disabled={!!busy || !offer.purchasesEnabled || !!biz?.member}
                              onClick={() =>
                                void run(tier, () => api.changePlan('business', interval, cur, { tier, extraSeats: extra }), isCurTier ? fmt(m.biz.seatsSaved, { n: t2.seats + extra }) : fmt(m.planChanged, { plan: t2.label }))
                              }
                            >
                              {busy === tier ? '…' : isCurTier ? m.save : account.plan === 'business' ? m.switchTo : m.upgrade}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className={biz?.tier === 'enterprise' ? 'current' : ''}>
                    <td>
                      <b>{offer.business.enterprise.label}</b>
                    </td>
                    <td>
                      {m.compare.from} {tb(offer.business.enterprise.quotaGb)} TB
                    </td>
                    <td>
                      {m.compare.from} {offer.business.enterprise.seats}
                    </td>
                    <td>
                      {m.compare.from} {fmtMoney(offer.business.enterprise.fromMonthly[cur], cur, 0)}
                    </td>
                    <td className="act">
                      <a className="button small" href={`mailto:${offer.business.enterprise.contact}?subject=FocVault%20Enterprise`}>
                        {m.biz.contact}
                      </a>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <p className="hint" style={{ padding: '10px 18px 0' }}>
            {interval === 'year' ? m.compare.hintYear : m.compare.hintMonth} · {m.vatNote} {!offer.purchasesEnabled ? m.stripeSoon : b.stripe ? m.stripe.secure : m.devNote}
          </p>
        </div>

        <div className="card plansection">
          <div className="plansection-head">
            <h3>{m.inv.title}</h3>
            <span className="dim">{m.inv.via}</span>
          </div>
          <div className="invlist">
            {(invoices?.invoices ?? []).map(i => (
              <div className="invrow" key={i.id}>
                <Icon name="file" size={18} />
                <div className="invmain">
                  <b>{fmtDate(i.date)}</b>
                  <span className="dim">{i.description}</span>
                </div>
                <b>{fmtMoney(i.amount, i.currency.toUpperCase() as Currency)}</b>
                <span className={`badge ${i.status === 'paid' ? 'ok' : ''}`}>{i.status === 'paid' ? m.inv.paid : m.inv.open}</span>
                {i.pdf ? (
                  <a className="linkish" href={i.pdf} target="_blank" rel="noreferrer">
                    PDF
                  </a>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {invoices && invoices.invoices.length === 0 && <p className="dim invempty">{invoices.stripe ? m.inv.none : m.inv.off}</p>}
            <div className="invrow">
              <Icon name="card" size={18} />
              <div className="invmain">
                <b>{invoices?.card ? `${invoices.card.brand.charAt(0).toUpperCase()}${invoices.card.brand.slice(1)} •••• ${invoices.card.last4}` : m.inv.noCard}</b>
                {invoices?.card && <span className="dim">{fmt(m.inv.expires, { date: `${String(invoices.card.expMonth).padStart(2, '0')}/${invoices.card.expYear}` })}</span>}
              </div>
              <span />
              <span />
              {b.stripe && (
                <button className="small" disabled={!!busy} onClick={() => void run('portal', () => (invoices?.card ? api.billingPortal() : api.addPaymentMethod()), '')}>
                  {invoices?.card ? m.inv.change : m.inv.add}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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

    </>
  )
}
