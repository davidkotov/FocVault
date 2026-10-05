import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { buyAddon, cancelAddon, changePlan, setCurrency, setPayg } from '../billing/service'
import { newAccount, testDeps } from '../testing'
import { LiveStripeGateway, setStripeGatewayForTests, type PriceData, type StripeGateway, type SubscriptionLite } from './gateway'
import { closePaygMonth, handleStripeEvent, stripeDepositUrl } from './service'
import { addCredit, consumeCredit, creditBalance, depositSchema } from '../credits/service'
import { buySuperSafe, cancelSuperSafe } from '../billing/super-safe'

const CTX = { origin: 'https://focvault.test', locale: 'de' as const }

/** Stripe-Attrappe: merkt sich Abos und Aufrufe, ohne Netzwerk. */
function fakeStripe() {
  const subs = new Map<string, SubscriptionLite>()
  const calls: string[] = []
  const charges: Array<{ amount: number; currency: string }> = []
  /** Checkout-Sessions je PaymentIntent (für Erstattungen/Anfechtungen) */
  const sessions = new Map<string, Record<string, any>>()
  let n = 0
  let hasPm = false
  const item = (p: PriceData, quantity = 1) => ({ id: `si_${++n}`, product: p.product, currency: p.currency, unitAmount: p.unitAmount, interval: p.interval, periodEnd: 1_900_000_000, quantity })
  const gw: StripeGateway = {
    async createCustomer() {
      calls.push('customer')
      return `cus_${++n}`
    },
    async createProduct(_name, key) {
      return `prod_${key}`
    },
    async checkoutSubscription(input) {
      calls.push('checkout')
      // „Kunde bezahlt“: Abo entsteht in Stripe
      const id = `sub_${++n}`
      subs.set(id, { id, customer: input.customer, status: 'active', cancelAtPeriodEnd: false, periodEnd: 1_900_000_000, metadata: input.metadata, items: [item(input.price), ...(input.extra ?? []).map(e => item(e.price, e.quantity))] })
      return `https://checkout.stripe.test/${id}`
    },
    async checkoutSetup(input) {
      calls.push('setup')
      return `https://checkout.stripe.test/setup/${input.customer}`
    },
    async checkoutPayment(input) {
      calls.push('payment')
      return `https://checkout.stripe.test/pay/${input.customer}/${input.amount}`
    },
    async portal() {
      return 'https://billing.stripe.test/portal'
    },
    async retrieveSubscription(id) {
      const s = subs.get(id)
      if (!s) throw new Error('unknown subscription')
      return structuredClone(s)
    },
    async changeSubscriptionPlan(id, itemId, price) {
      const s = subs.get(id)!
      s.items = s.items.map(i => (i.id === itemId ? { ...item(price), id: itemId } : i))
      s.cancelAtPeriodEnd = false
      return structuredClone(s)
    },
    async setCancelAtPeriodEnd(id, cancel) {
      subs.get(id)!.cancelAtPeriodEnd = cancel
      return structuredClone(subs.get(id)!)
    },
    async setItemQuantity(itemId, quantity) {
      for (const s of subs.values()) s.items = s.items.map(i => (i.id === itemId ? { ...i, quantity } : i))
    },
    async addItem(subId, price, _meta, quantity = 1) {
      const it = item(price, quantity)
      subs.get(subId)!.items.push(it)
      return it.id
    },
    async removeItem(itemId) {
      calls.push(`remove:${itemId}`)
      for (const s of subs.values()) s.items = s.items.filter(i => i.id !== itemId)
    },
    async setupIntentPaymentMethod() {
      return 'pm_card'
    },
    async setDefaultPaymentMethod() {
      hasPm = true
    },
    async hasDefaultPaymentMethod() {
      return hasPm
    },
    async checkoutSessionForPaymentIntent(pi) {
      return sessions.get(pi) ?? null
    },
    async listInvoices() {
      return charges.map((c, i) => ({ id: `in_${i}`, date: new Date(0).toISOString(), amount: c.amount, currency: c.currency, status: 'paid', description: '', pdf: null }))
    },
    async defaultCard() {
      return hasPm ? { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 } : null
    },
    async chargeOnce(input) {
      charges.push({ amount: input.amount, currency: input.currency })
      return { invoiceId: `in_${++n}`, paid: true }
    },
    verifyWebhook() {
      throw new Error('not used')
    }
  }
  const removePm = () => {
    hasPm = false
  }
  return { gw, subs, calls, charges, sessions, removePm }
}

let evt = 0
const event = (type: string, object: Record<string, any>) => ({ id: `evt_${++evt}`, type, object })

describe('Stripe-Abrechnung', () => {
  beforeEach(() => resetRateLimits())
  afterEach(() => setStripeGatewayForTests(undefined))

  it('Checkout → Webhook schaltet Pro frei, doppelte Zustellung ändert nichts, Wechsel zu Family, Kündigung zum Laufzeitende', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'kunde@example.com')

    const r = await changePlan(deps, session, { plan: 'pro', interval: 'year', currency: 'EUR' }, CTX)
    expect(r.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/sub_/)
    // bis zur Zahlung bleibt das Konto Free
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [session.accountId]))[0].plan).toBe('free')

    const subId = r.redirectUrl!.split('/').pop()!
    const done = event('checkout.session.completed', { mode: 'subscription', subscription: subId, metadata: { accountId: session.accountId, plan: 'pro' } })
    expect(await handleStripeEvent(deps, s.gw, done)).toBe('processed')
    expect(await handleStripeEvent(deps, s.gw, done)).toBe('duplicate')
    const acc = (await deps.db.query(`SELECT plan, billing_interval, currency, subscription_status FROM accounts WHERE id = $1`, [session.accountId]))[0]
    expect(acc).toMatchObject({ plan: 'pro', billing_interval: 'year', currency: 'EUR', subscription_status: 'active' })
    expect(s.subs.get(subId)!.items[0].unitAmount).toBe(13900) // 139 € pro Jahr

    // Wechsel innerhalb des Abos: keine neue Kasse, Preis angepasst
    expect(await changePlan(deps, session, { plan: 'family', interval: 'year', currency: 'EUR' }, CTX)).toEqual({})
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [session.accountId]))[0].plan).toBe('family')
    await expect(changePlan(deps, session, { plan: 'pro', interval: 'year', currency: 'USD' }, CTX)).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Kündigung: läuft bis Laufzeitende weiter, danach Free
    await changePlan(deps, session, { plan: 'free', interval: 'year', currency: 'EUR' }, CTX)
    expect((await deps.db.query(`SELECT plan, cancel_at_period_end FROM accounts WHERE id = $1`, [session.accountId]))[0]).toMatchObject({
      plan: 'family',
      cancel_at_period_end: true
    })
    s.subs.get(subId)!.status = 'canceled'
    await handleStripeEvent(deps, s.gw, event('customer.subscription.deleted', { id: subId }))
    expect((await deps.db.query(`SELECT plan, stripe_subscription_id FROM accounts WHERE id = $1`, [session.accountId]))[0]).toMatchObject({
      plan: 'free',
      stripe_subscription_id: null
    })
  })

  it('Super Safe als Abo-Position (Menge = TB): folgt der Quota, sperrt Intervallwechsel, endet mit dem Abo', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'safe@example.com')
    await expect(buySuperSafe(deps, session)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    const r = await changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'EUR' }, CTX)
    const subId = r.redirectUrl!.split('/').pop()!
    await handleStripeEvent(deps, s.gw, event('customer.subscription.created', { id: subId }))

    await buySuperSafe(deps, session)
    const sub = s.subs.get(subId)!
    const item = () => sub.items.find(i => i.product === 'prod_super_safe')
    expect(item()).toMatchObject({ unitAmount: 299, quantity: 1, interval: 'month', currency: 'eur' })
    const row = (await deps.db.query(`SELECT source, stripe_item_id, tb FROM account_super_safe WHERE account_id = $1`, [session.accountId]))[0]
    expect(row).toMatchObject({ source: 'stripe', stripe_item_id: item()!.id, tb: 1 })

    // Zusatzspeicher → 2 TB, Wechsel zu Family (2 TB + 500 GB) → 3 TB
    await buyAddon(deps, session, 'plus-500')
    expect(item()!.quantity).toBe(2)
    await changePlan(deps, session, { plan: 'family', interval: 'month', currency: 'EUR' }, CTX)
    expect(item()!.quantity).toBe(3)
    await expect(changePlan(deps, session, { plan: 'family', interval: 'year', currency: 'EUR' }, CTX)).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Kündigen entfernt die Position; erneut buchen, dann endet es mit dem Abo
    await cancelSuperSafe(deps, session)
    expect(item()).toBeUndefined()
    await buySuperSafe(deps, session)
    expect(item()!.quantity).toBe(3)
    sub.status = 'canceled'
    await handleStripeEvent(deps, s.gw, event('customer.subscription.deleted', { id: subId }))
    const left = await deps.db.query(`SELECT status FROM account_super_safe WHERE account_id = $1 ORDER BY created_at`, [session.accountId])
    expect(left.map(x => x.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('Zusatzspeicher als Abo-Position; in Stripe entfernt → bei uns beendet', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'addon@example.com')
    const r = await changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'CHF' }, CTX)
    const subId = r.redirectUrl!.split('/').pop()!
    await handleStripeEvent(deps, s.gw, event('customer.subscription.created', { id: subId }))

    await buyAddon(deps, session, 'plus-500')
    const sub = s.subs.get(subId)!
    expect(sub.items.map(i => [i.product, i.unitAmount])).toEqual([
      ['prod_pro', 1390],
      ['prod_addon', 590]
    ])
    const addon = (await deps.db.query(`SELECT id, source, stripe_item_id FROM account_addons WHERE account_id = $1`, [session.accountId]))[0]
    expect(addon.source).toBe('stripe')

    await cancelAddon(deps, session, addon.id)
    expect(s.calls).toContain(`remove:${addon.stripe_item_id}`)

    await buyAddon(deps, session, 'plus-200')
    sub.items = sub.items.filter(i => i.product !== 'prod_addon') // im Kundenportal entfernt
    await handleStripeEvent(deps, s.gw, event('customer.subscription.updated', { id: subId }))
    const active = await deps.db.query(`SELECT 1 FROM account_addons WHERE account_id = $1 AND status = 'active'`, [session.accountId])
    expect(active).toHaveLength(0)
  })

  it('Pay-as-you-go: Karte hinterlegen, Monatsdurchschnitt, Kleinbetrag übertragen, dann abbuchen', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'payg@example.com')

    const r = await setPayg(deps, session, true, 200, CTX)
    expect(r.redirectUrl).toMatch(/setup/)
    const cus = (await deps.db.query(`SELECT stripe_customer_id FROM accounts WHERE id = $1`, [session.accountId]))[0].stripe_customer_id
    await handleStripeEvent(
      deps,
      s.gw,
      event('checkout.session.completed', { mode: 'setup', setup_intent: 'seti_1', customer: cus, metadata: { accountId: session.accountId, purpose: 'payg', capGb: '200' } })
    )
    expect((await deps.db.query(`SELECT payg_enabled, payg_cap_gb FROM accounts WHERE id = $1`, [session.accountId]))[0]).toMatchObject({
      payg_enabled: true,
      payg_cap_gb: 200
    })

    // August: 20 von 31 Tagen 50 GB → Schnitt 32.26 GB, minus 5 GB frei = 27.26 GB × 0.03 = 0.82 CHF < 2 CHF → Übertrag
    for (let d = 1; d <= 20; d++) {
      await deps.db.query(`INSERT INTO usage_daily (account_id, day, bytes) VALUES ($1, $2, $3)`, [session.accountId, `2026-08-${String(d).padStart(2, '0')}`, 50e9])
    }
    expect(await closePaygMonth(deps, s.gw, new Date('2026-09-01T03:00:00Z'))).toEqual({ charged: 0, carried: 1 })
    expect(await closePaygMonth(deps, s.gw, new Date('2026-09-02T03:00:00Z'))).toEqual({ charged: 0, carried: 0 })
    const aug = (await deps.db.query(`SELECT amount::float8 AS amount, status FROM payg_invoices WHERE period = '2026-08'`))[0]
    expect(aug).toMatchObject({ amount: 0.82, status: 'carried' })

    // September: ganzer Monat 105 GB → 100 GB × 0.03 = 3.00 + 0.82 Übertrag = 3.82 CHF → abgebucht
    for (let d = 1; d <= 30; d++) {
      await deps.db.query(`INSERT INTO usage_daily (account_id, day, bytes) VALUES ($1, $2, $3)`, [session.accountId, `2026-09-${String(d).padStart(2, '0')}`, 105e9])
    }
    expect(await closePaygMonth(deps, s.gw, new Date('2026-10-01T03:00:00Z'))).toEqual({ charged: 1, carried: 0 })
    expect(s.charges).toEqual([{ amount: 382, currency: 'chf' }])
  })

  it('Business: Stufe und zusätzliche Nutzer als Abo-Positionen, Wechsel zu Starter entfernt die Plätze', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'startup@example.com')
    const r = await changePlan(deps, session, { plan: 'business', tier: 'business', extraSeats: 3, interval: 'month', currency: 'CHF' }, CTX)
    const subId = r.redirectUrl!.split('/').pop()!
    expect(s.subs.get(subId)!.items.map(i => [i.product, i.unitAmount, i.quantity])).toEqual([
      ['prod_business', 12900, 1],
      ['prod_seat', 800, 3]
    ])
    await handleStripeEvent(deps, s.gw, event('customer.subscription.created', { id: subId }))
    expect((await deps.db.query(`SELECT plan, business_tier, seats FROM accounts WHERE id = $1`, [session.accountId]))[0]).toMatchObject({
      plan: 'business',
      business_tier: 'business',
      seats: 13
    })
    await changePlan(deps, session, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' }, CTX)
    expect(s.subs.get(subId)!.items.map(i => i.product)).toEqual(['prod_business_starter'])
    expect((await deps.db.query(`SELECT business_tier, seats FROM accounts WHERE id = $1`, [session.accountId]))[0]).toMatchObject({ business_tier: 'starter', seats: 5 })
  })

  it('Pay-as-you-go nur mit Zahlungsmethode: Guthaben allein reicht nicht; Karte im Portal entfernt → PAYG aus', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'nurguthaben@example.com')
    await addCredit(deps.db, { accountId: session.accountId, amount: 50, currency: 'CHF', kind: 'deposit', source: 'stripe', ref: 'stripe:cs_vorher' })

    // Guthaben vorhanden, aber keine Karte → zuerst zu Stripe, PAYG bleibt aus
    const r = await setPayg(deps, session, true, 100, CTX)
    expect(r.redirectUrl).toMatch(/setup/)
    const payg = async () => (await deps.db.query(`SELECT payg_enabled FROM accounts WHERE id = $1`, [session.accountId]))[0].payg_enabled
    expect(await payg()).toBe(false)

    // Karte hinterlegt → sofort aktiv
    const cus = (await deps.db.query(`SELECT stripe_customer_id FROM accounts WHERE id = $1`, [session.accountId]))[0].stripe_customer_id
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', { id: 'cs_card', mode: 'setup', setup_intent: 'seti_2', customer: cus, metadata: { accountId: session.accountId, purpose: 'card' } }))
    expect(await setPayg(deps, session, true, 100, CTX)).toEqual({})
    expect(await payg()).toBe(true)

    // Kunde ändert etwas, Karte bleibt → nichts passiert
    await handleStripeEvent(deps, s.gw, event('customer.updated', { id: cus, invoice_settings: { default_payment_method: 'pm_card' } }))
    expect(await payg()).toBe(true)
    // Karte im Kundenportal entfernt → PAYG aus
    s.removePm()
    await handleStripeEvent(deps, s.gw, { ...event('payment_method.detached', { id: 'pm_card', customer: null }), previous: { customer: cus } })
    expect(await payg()).toBe(false)
  })

  it('Aufladung: Betrag aus amount_total; SEPA (erst unpaid, dann async_payment_succeeded) genau einmal gutgeschrieben', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'sepa@example.com')
    const id = session.accountId
    await expect(stripeDepositUrl(deps, s.gw, session, 3, CTX)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(stripeDepositUrl(deps, s.gw, session, 10.555, CTX)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await stripeDepositUrl(deps, s.gw, session, 25, CTX)).toMatch(/pay\/cus_\d+\/2500$/)
    const cus = (await deps.db.query(`SELECT stripe_customer_id FROM accounts WHERE id = $1`, [id]))[0].stripe_customer_id

    // Metadaten behaupten 999 – gutgeschrieben wird, was Stripe kassiert hat
    const cs = { id: 'cs_sepa_1', mode: 'payment', customer: cus, amount_total: 2500, currency: 'chf', metadata: { accountId: id, purpose: 'credit', amount: '999.00', currency: 'CHF' } }
    expect(await handleStripeEvent(deps, s.gw, event('checkout.session.completed', { ...cs, payment_status: 'unpaid' }))).toBe('ignored')
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(0)

    expect(await handleStripeEvent(deps, s.gw, event('checkout.session.async_payment_succeeded', { ...cs, payment_status: 'paid' }))).toBe('processed')
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(25)
    // erneute Zustellung (neue Event-ID) bzw. „completed/paid“ hinterher → nichts doppelt
    await handleStripeEvent(deps, s.gw, event('checkout.session.async_payment_succeeded', { ...cs, payment_status: 'paid' }))
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', { ...cs, payment_status: 'paid' }))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(25)

    // Fehlgeschlagene SEPA-Zahlung: keine Gutschrift
    const failed = { ...cs, id: 'cs_sepa_2', payment_status: 'unpaid' }
    expect(await handleStripeEvent(deps, s.gw, event('checkout.session.async_payment_failed', failed))).toBe('processed')
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(25)

    // Sofortzahlung mit Rappenbetrag
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', { ...cs, id: 'cs_card_1', amount_total: 1050, payment_status: 'paid', metadata: { ...cs.metadata, amount: '1.00' } }))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(35.5)
  })

  it('Erstattung und Chargeback einer Aufladung: Guthaben zurückgebucht (auch ins Minus), PAYG gesperrt; gewonnene Anfechtung zurück', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'refund@example.com')
    const id = session.accountId
    await stripeDepositUrl(deps, s.gw, session, 25, CTX)
    const cus = (await deps.db.query(`SELECT stripe_customer_id FROM accounts WHERE id = $1`, [id]))[0].stripe_customer_id
    const cs = { id: 'cs_top_1', mode: 'payment', customer: cus, amount_total: 2500, currency: 'chf', payment_status: 'paid', payment_intent: 'pi_1', metadata: { accountId: id, purpose: 'credit' } }
    s.sessions.set('pi_1', cs)
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', cs))
    // PAYG mit Karte an, 10 CHF verbraucht
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', { id: 'cs_pg', mode: 'setup', setup_intent: 'seti_3', customer: cus, metadata: { accountId: id, purpose: 'payg', capGb: '100' } }))
    expect(await consumeCredit(deps.db, id, 10, 'CHF', 'payg:test', 'PAYG')).toBe(10)
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(15)

    // Teilerstattung 5 CHF, dann gesamt 25 CHF (kumuliert) – doppelte Zustellung ändert nichts
    const charge = { id: 'ch_1', object: 'charge', customer: cus, payment_intent: 'pi_1', currency: 'chf', amount: 2500 }
    expect(await handleStripeEvent(deps, s.gw, event('charge.refunded', { ...charge, amount_refunded: 500 }))).toBe('processed')
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(10)
    await handleStripeEvent(deps, s.gw, event('charge.refunded', { ...charge, amount_refunded: 2500 }))
    await handleStripeEvent(deps, s.gw, event('charge.refunded', { ...charge, amount_refunded: 2500 }))
    await handleStripeEvent(deps, s.gw, event('charge.refunded', { ...charge, amount_refunded: 500 }))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(-10)
    // Minus → PAYG aus und nicht wieder einschaltbar; Verbrauch holt nichts aus dem Minus
    expect((await deps.db.query(`SELECT payg_enabled FROM accounts WHERE id = $1`, [id]))[0].payg_enabled).toBe(false)
    await expect(setPayg(deps, session, true, 100, CTX)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await consumeCredit(deps.db, id, 5, 'CHF', 'payg:test2', 'PAYG')).toBe(0)
    // Anfechtung nach voller Erstattung: nichts mehr abzuziehen
    await handleStripeEvent(deps, s.gw, event('charge.dispute.created', { id: 'dp_0', charge: 'ch_1', payment_intent: 'pi_1', amount: 2500, currency: 'chf', status: 'needs_response' }))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(-10)

    // Zweite Aufladung wird angefochten, dann gewonnen
    const cs2 = { ...cs, id: 'cs_top_2', amount_total: 4000, payment_intent: 'pi_2' }
    s.sessions.set('pi_2', cs2)
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', cs2))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(30)
    const dispute = { id: 'dp_1', object: 'dispute', charge: 'ch_2', payment_intent: 'pi_2', amount: 4000, currency: 'chf', status: 'needs_response' }
    await handleStripeEvent(deps, s.gw, event('charge.dispute.created', dispute))
    await handleStripeEvent(deps, s.gw, event('charge.dispute.created', dispute))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(-10)
    await handleStripeEvent(deps, s.gw, event('charge.dispute.closed', { ...dispute, status: 'won' }))
    await handleStripeEvent(deps, s.gw, event('charge.dispute.closed', { ...dispute, status: 'won' }))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(30)

    // Erstattung einer Nicht-Aufladung (z. B. Abo-Rechnung) → ignoriert
    expect(await handleStripeEvent(deps, s.gw, event('charge.refunded', { ...charge, id: 'ch_x', payment_intent: 'pi_abo', amount_refunded: 1390 }))).toBe('ignored')
    // Währung bleibt gesperrt, solange Guthaben besteht
    await expect(setCurrency(deps, session, 'EUR')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('Erstattung trifft vor der Gutschrift ein → erst gutschreiben, dann zurückbuchen (Saldo 0)', async () => {
    const deps = await testDeps()
    const s = fakeStripe()
    setStripeGatewayForTests(s.gw)
    const { session } = await newAccount(deps, 'reihenfolge@example.com')
    const id = session.accountId
    await stripeDepositUrl(deps, s.gw, session, 20, CTX)
    const cus = (await deps.db.query(`SELECT stripe_customer_id FROM accounts WHERE id = $1`, [id]))[0].stripe_customer_id
    const cs = { id: 'cs_late', mode: 'payment', customer: cus, amount_total: 2000, currency: 'chf', payment_status: 'paid', payment_intent: 'pi_late', metadata: { accountId: id, purpose: 'credit' } }
    s.sessions.set('pi_late', cs)
    await handleStripeEvent(deps, s.gw, event('charge.refunded', { id: 'ch_late', payment_intent: 'pi_late', amount_refunded: 2000, currency: 'chf' }))
    await handleStripeEvent(deps, s.gw, event('checkout.session.completed', cs))
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(0)
  })

  it('Einzahlungsbetrag: ganze Rappen, Minimum/Maximum', () => {
    expect(depositSchema.safeParse({ amount: 10.5 }).success).toBe(true)
    expect(depositSchema.safeParse({ amount: 19.99 }).success).toBe(true)
    expect(depositSchema.safeParse({ amount: 10.005 }).success).toBe(false)
    expect(depositSchema.safeParse({ amount: 4.99 }).success).toBe(false)
    expect(depositSchema.safeParse({ amount: 5000.01 }).success).toBe(false)
    expect(depositSchema.safeParse({ amount: Number.NaN }).success).toBe(false)
  })

  it('Webhook-Signatur: gültig wird akzeptiert, manipuliert oder falsches Secret abgelehnt', () => {
    const secret = 'whsec_test_secret_0123456789'
    const gw = new LiveStripeGateway('sk_test_dummy', secret)
    const payload = JSON.stringify({ id: 'evt_sig', type: 'invoice.paid', data: { object: { id: 'in_1' } } })
    const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret })
    expect(gw.verifyWebhook(payload, header)).toMatchObject({ id: 'evt_sig', type: 'invoice.paid' })
    expect(() => gw.verifyWebhook(payload.replace('in_1', 'in_2'), header)).toThrow()
    expect(() => new LiveStripeGateway('sk_test_dummy', 'whsec_other').verifyWebhook(payload, header)).toThrow()
  })
})
