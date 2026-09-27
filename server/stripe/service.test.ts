import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { buyAddon, cancelAddon, changePlan, setPayg } from '../billing/service'
import { newAccount, testDeps } from '../testing'
import { LiveStripeGateway, setStripeGatewayForTests, type PriceData, type StripeGateway, type SubscriptionLite } from './gateway'
import { closePaygMonth, handleStripeEvent } from './service'

const CTX = { origin: 'https://focvault.test', locale: 'de' as const }

/** Stripe-Attrappe: merkt sich Abos und Aufrufe, ohne Netzwerk. */
function fakeStripe() {
  const subs = new Map<string, SubscriptionLite>()
  const calls: string[] = []
  const charges: Array<{ amount: number; currency: string }> = []
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
    async chargeOnce(input) {
      charges.push({ amount: input.amount, currency: input.currency })
      return { invoiceId: `in_${++n}`, paid: true }
    },
    verifyWebhook() {
      throw new Error('not used')
    }
  }
  return { gw, subs, calls, charges }
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
