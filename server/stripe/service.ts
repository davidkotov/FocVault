import type { Plan } from '../../lib/api-types'
import { GB, paygEstimate, priceOf, round2, type Currency, type Interval, type PricingConfig } from '../../lib/pricing'
import { formatBytes } from '../../lib/vault'
import { usedBytes } from '../accounts/plans'
import type { SessionInfo } from '../auth/sessions'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import { getPricing } from '../billing/settings'
import { findAddon, planQuotaGb, type PlanChange } from '../billing/service'
import { ApiError } from '../shared/errors'
import { uuidv7 } from '../shared/ids'
import { syncFamilyAfterPlanChange } from '../family/service'
import { stripeTaxEnabled, type Cur, type PriceData, type StripeEventLite, type StripeGateway, type SubscriptionLite } from './gateway'

/**
 * Abrechnung über Stripe:
 * - Abos (Pro/Family, Monat/Jahr, CHF/EUR/USD) über Stripe Checkout; Preise aus unserem Preisbuch.
 * - Zusatzspeicher als weitere Position im selben Abo (anteilig verrechnet).
 * - Pay-as-you-go: Karte per Checkout hinterlegen, Abrechnung monatlich nach Durchschnitt,
 *   Beträge unter dem Minimum werden übertragen.
 * - Der Abo-Zustand kommt ausschließlich aus Webhooks (signiert, genau einmal verarbeitet).
 */
export interface StripeContext {
  origin: string
  locale: 'de' | 'en'
}

type ProductKey = 'pro' | 'family' | 'addon' | 'payg' | 'business_starter' | 'business' | 'seat'
const PRODUCT_NAMES: Record<ProductKey, string> = {
  pro: 'FocVault Pro',
  family: 'FocVault Family',
  addon: 'FocVault Zusatzspeicher',
  payg: 'FocVault Pay-as-you-go',
  business_starter: 'FocVault Business Starter',
  business: 'FocVault Business',
  seat: 'FocVault Business – zusätzlicher Nutzer'
}

const cur = (c: Currency) => c.toLowerCase() as Cur
const cents = (amount: number) => Math.round(amount * 100)
const ACTIVE = new Set(['active', 'trialing', 'past_due'])

async function productIds(db: Db, gw: StripeGateway): Promise<Record<ProductKey, string>> {
  const rows = await db.query<{ value: Partial<Record<ProductKey, string>> }>(`SELECT value FROM settings WHERE key = 'stripe_products'`)
  const ids = { ...(rows[0]?.value ?? {}) }
  let changed = false
  for (const key of Object.keys(PRODUCT_NAMES) as ProductKey[]) {
    if (!ids[key]) {
      ids[key] = await gw.createProduct(PRODUCT_NAMES[key], key)
      changed = true
    }
  }
  if (changed) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('stripe_products', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(ids)]
    )
  }
  return ids as Record<ProductKey, string>
}

interface BillingAccount {
  id: string
  email: string | null
  label: string | null
  plan: Plan
  currency: Currency
  billing_interval: Interval
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
}

async function loadBillingAccount(db: Db, id: string): Promise<BillingAccount> {
  const rows = await db.query<BillingAccount>(
    `SELECT id, email, label, plan, currency, billing_interval, stripe_customer_id, stripe_subscription_id, subscription_status
       FROM accounts WHERE id = $1`,
    [id]
  )
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  return rows[0]
}

async function ensureCustomer(db: Db, gw: StripeGateway, acc: BillingAccount): Promise<string> {
  if (acc.stripe_customer_id) return acc.stripe_customer_id
  const id = await gw.createCustomer({ accountId: acc.id, email: acc.email, name: acc.label ?? acc.email ?? acc.id })
  await db.query('UPDATE accounts SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL', [acc.id, id])
  return (await loadBillingAccount(db, acc.id)).stripe_customer_id ?? id
}

function planPrice(p: PricingConfig, products: Record<ProductKey, string>, input: PlanChange): PriceData {
  const { interval, currency } = input
  if (input.plan === 'business') {
    const tier = input.tier ?? 'business'
    return { currency: cur(currency), unitAmount: cents(priceOf(p.business[tier], interval, currency)), product: products[tier === 'starter' ? 'business_starter' : 'business'], interval }
  }
  const plan = input.plan as 'pro' | 'family'
  return { currency: cur(currency), unitAmount: cents(priceOf(p.plans[plan], interval, currency)), product: products[plan], interval }
}

function seatPrice(p: PricingConfig, products: Record<ProductKey, string>, interval: Interval, currency: Currency): PriceData {
  return { currency: cur(currency), unitAmount: cents(priceOf(p.business.seat, interval, currency)), product: products.seat, interval }
}

const PLAN_PRODUCTS: ProductKey[] = ['pro', 'family', 'business_starter', 'business']

const returnUrl = (ctx: StripeContext, q: string) => `${ctx.origin}/${ctx.locale}/app?view=plans&${q}`

/** Abo abschließen oder wechseln. Liefert eine Checkout-URL oder null (sofort umgestellt). */
export async function stripeChangePlan(
  deps: Deps,
  gw: StripeGateway,
  session: SessionInfo,
  input: PlanChange,
  ctx: StripeContext
): Promise<string | null> {
  const acc = await loadBillingAccount(deps.db, session.accountId)
  const pricing = await getPricing(deps.db)
  const hasSub = !!acc.stripe_subscription_id && ACTIVE.has(acc.subscription_status ?? '')

  if (input.plan === 'free') {
    if (!hasSub) throw new ApiError('BAD_REQUEST', 'Kein laufendes Abo.')
    const sub = await gw.setCancelAtPeriodEnd(acc.stripe_subscription_id!, true)
    await applySubscription(deps, gw, sub)
    await audit(deps.db, acc.id, 'user', 'billing.cancel_scheduled', {})
    return null
  }

  const quota = planQuotaGb(pricing, input) * GB
  const used = await usedBytes(deps.db, acc.id)
  const addons = await deps.db.query<{ bytes: number }>(
    `SELECT COALESCE(SUM(bytes), 0)::float8 AS bytes FROM account_addons WHERE account_id = $1 AND status = 'active'`,
    [acc.id]
  )
  if (used > quota + Number(addons[0]?.bytes ?? 0)) {
    throw new ApiError('BAD_REQUEST', `Du nutzt ${formatBytes(used)} – das passt nicht in dieses Paket.`)
  }
  const products = await productIds(deps.db, gw)
  const price = planPrice(pricing, products, input)
  const extraSeats = input.plan === 'business' ? Math.max(0, input.extraSeats ?? 0) : 0

  if (hasSub) {
    const sub = await gw.retrieveSubscription(acc.stripe_subscription_id!)
    const planItem = sub.items.find(i => PLAN_PRODUCTS.some(k => products[k] === i.product))
    if (!planItem) throw new ApiError('INTERNAL', 'Abo ohne Paket-Position.')
    if (planItem.currency !== price.currency) {
      throw new ApiError('BAD_REQUEST', 'Die Währung eines laufenden Abos lässt sich nicht wechseln. Bitte zuerst kündigen und danach neu abschließen.')
    }
    const hasAddons = sub.items.some(i => i.product === products.addon)
    if (hasAddons && planItem.interval !== price.interval) {
      throw new ApiError('BAD_REQUEST', 'Mit Zusatzspeicher ist ein Wechsel zwischen Monat und Jahr erst nach dem Kündigen des Zusatzspeichers möglich.')
    }
    let updated = await gw.changeSubscriptionPlan(sub.id, planItem.id, price)
    // Nutzerplätze als eigene Position (Menge) nachführen
    const seatItem = updated.items.find(i => i.product === products.seat)
    if (extraSeats > 0 && seatItem) await gw.setItemQuantity(seatItem.id, extraSeats)
    else if (extraSeats > 0) await gw.addItem(sub.id, seatPrice(pricing, products, input.interval, input.currency), { accountId: acc.id, kind: 'seats' }, extraSeats)
    else if (seatItem) await gw.removeItem(seatItem.id)
    if (extraSeats > 0 || seatItem) updated = await gw.retrieveSubscription(sub.id)
    await applySubscription(deps, gw, updated, input.plan)
    await audit(deps.db, acc.id, 'user', 'billing.plan_changed', { ...input, via: 'stripe' })
    return null
  }

  const customer = await ensureCustomer(deps.db, gw, acc)
  return gw.checkoutSubscription({
    customer,
    price,
    extra: extraSeats > 0 ? [{ price: seatPrice(pricing, products, input.interval, input.currency), quantity: extraSeats }] : [],
    successUrl: returnUrl(ctx, 'checkout=success'),
    cancelUrl: returnUrl(ctx, 'checkout=cancelled'),
    metadata: { accountId: acc.id, plan: input.plan },
    automaticTax: stripeTaxEnabled(),
    locale: ctx.locale
  })
}

/** Gekündigtes Abo doch fortsetzen (vor Laufzeitende). */
export async function stripeResume(deps: Deps, gw: StripeGateway, session: SessionInfo): Promise<void> {
  const acc = await loadBillingAccount(deps.db, session.accountId)
  if (!acc.stripe_subscription_id) throw new ApiError('BAD_REQUEST', 'Kein Abo.')
  await applySubscription(deps, gw, await gw.setCancelAtPeriodEnd(acc.stripe_subscription_id, false))
  await audit(deps.db, acc.id, 'user', 'billing.cancel_revoked', {})
}

export async function stripePortal(deps: Deps, gw: StripeGateway, session: SessionInfo, ctx: StripeContext): Promise<string> {
  const acc = await loadBillingAccount(deps.db, session.accountId)
  if (!acc.stripe_customer_id) throw new ApiError('BAD_REQUEST', 'Noch keine Zahlungsdaten hinterlegt.')
  return gw.portal(acc.stripe_customer_id, returnUrl(ctx, 'portal=back'), ctx.locale)
}

export async function stripeBuyAddon(deps: Deps, gw: StripeGateway, session: SessionInfo, packId: string): Promise<void> {
  const acc = await loadBillingAccount(deps.db, session.accountId)
  if (!acc.stripe_subscription_id || !ACTIVE.has(acc.subscription_status ?? '')) {
    throw new ApiError('PLAN_REQUIRED', 'Zusatzspeicher gibt es für laufende Pro- und Family-Abos.')
  }
  const pricing = await getPricing(deps.db)
  const pack = findAddon(pricing, packId)
  if (!pack) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const products = await productIds(deps.db, gw)
  const price = priceOf(pack, acc.billing_interval, acc.currency)
  const id = uuidv7()
  const itemId = await gw.addItem(
    acc.stripe_subscription_id,
    { currency: cur(acc.currency), unitAmount: cents(price), product: products.addon, interval: acc.billing_interval },
    { accountId: acc.id, addonId: id, packId: pack.id }
  )
  await deps.db.query(
    `INSERT INTO account_addons (id, account_id, pack_id, bytes, price, currency, billing_interval, source, stripe_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'stripe', $8)`,
    [id, acc.id, pack.id, pack.gb * GB, price, acc.currency, acc.billing_interval, itemId]
  )
  await audit(deps.db, acc.id, 'user', 'billing.addon_added', { pack: pack.id, gb: pack.gb, price, currency: acc.currency, via: 'stripe' })
}

/** Stripe-Position eines Zusatzspeichers entfernen (die Quota-Prüfung macht der Aufrufer). */
export async function stripeRemoveAddonItem(gw: StripeGateway, stripeItemId: string | null): Promise<void> {
  if (stripeItemId) await gw.removeItem(stripeItemId)
}

/** Pay-as-you-go einschalten: ohne hinterlegte Karte zuerst zu Stripe (Karte speichern). */
export async function stripePaygSetupUrl(
  deps: Deps,
  gw: StripeGateway,
  session: SessionInfo,
  capGb: number,
  ctx: StripeContext
): Promise<string | null> {
  const acc = await loadBillingAccount(deps.db, session.accountId)
  const customer = await ensureCustomer(deps.db, gw, acc)
  if (await gw.hasDefaultPaymentMethod(customer)) return null
  return gw.checkoutSetup({
    customer,
    currency: cur(acc.currency),
    successUrl: returnUrl(ctx, 'payg=ready'),
    cancelUrl: returnUrl(ctx, 'payg=cancelled'),
    metadata: { accountId: acc.id, purpose: 'payg', capGb: String(capGb) },
    locale: ctx.locale
  })
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

async function accountForCustomer(db: Db, customer: string, hint?: string): Promise<string | null> {
  if (hint) {
    const r = await db.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [hint])
    if (r[0]) return r[0].id
  }
  const r = await db.query<{ id: string }>('SELECT id FROM accounts WHERE stripe_customer_id = $1', [customer])
  return r[0]?.id ?? null
}

/** Abo-Zustand aus Stripe in unser Konto übernehmen (idempotent). */
export async function applySubscription(deps: Deps, gw: StripeGateway, sub: SubscriptionLite, planHint?: Plan): Promise<void> {
  const accountId = await accountForCustomer(deps.db, sub.customer, sub.metadata.accountId)
  if (!accountId) return
  const products = await productIds(deps.db, gw)
  const planItem = sub.items.find(i => PLAN_PRODUCTS.some(k => products[k] === i.product))
  const seatItem = sub.items.find(i => i.product === products.seat)
  const periodEnd = sub.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null

  if (ACTIVE.has(sub.status) && planItem) {
    const plan: Plan =
      planItem.product === products.family
        ? 'family'
        : planItem.product === products.pro
          ? 'pro'
          : planItem.product === products.business || planItem.product === products.business_starter
            ? 'business'
            : (planHint ?? 'pro')
    const pricing = await getPricing(deps.db)
    const tier = plan === 'business' ? (planItem.product === products.business_starter ? 'starter' : 'business') : null
    const seats = tier ? pricing.business[tier].seats + (seatItem?.quantity ?? 0) : null
    await deps.db.tx(async tx => {
      await tx.query(
        `UPDATE accounts SET plan = $2, billing_interval = $3, currency = $4, stripe_customer_id = $5, stripe_subscription_id = $6,
                subscription_status = $7, current_period_end = $8, cancel_at_period_end = $9, payg_enabled = false,
                business_tier = $10, seats = $11
          WHERE id = $1`,
        [accountId, plan, planItem.interval, planItem.currency.toUpperCase(), sub.customer, sub.id, sub.status, periodEnd, sub.cancelAtPeriodEnd, tier, seats]
      )
      // Zusatzspeicher, die in Stripe nicht mehr existieren, beenden
      const itemIds = sub.items.filter(i => i.product === products.addon).map(i => i.id)
      await tx.query(
        `UPDATE account_addons SET status = 'cancelled', cancelled_at = now()
          WHERE account_id = $1 AND source = 'stripe' AND status = 'active' AND NOT (stripe_item_id = ANY($2::text[]))`,
        [accountId, itemIds]
      )
    })
    await syncFamilyAfterPlanChange(deps.db, accountId)
    return
  }

  if (sub.status === 'incomplete') {
    await deps.db.query('UPDATE accounts SET subscription_status = $2 WHERE id = $1', [accountId, sub.status])
    return
  }

  // beendet (canceled, unpaid, incomplete_expired): zurück auf Free – Daten bleiben, Uploads über der Quota gesperrt
  await deps.db.tx(async tx => {
    await tx.query(
      `UPDATE accounts SET plan = 'free', stripe_subscription_id = NULL, subscription_status = $2, current_period_end = NULL,
              cancel_at_period_end = false
        WHERE id = $1 AND (stripe_subscription_id = $3 OR stripe_subscription_id IS NULL)`,
      [accountId, sub.status, sub.id]
    )
    await tx.query(
      `UPDATE account_addons SET status = 'cancelled', cancelled_at = now() WHERE account_id = $1 AND source = 'stripe' AND status = 'active'`,
      [accountId]
    )
  })
  await syncFamilyAfterPlanChange(deps.db, accountId)
  await audit(deps.db, accountId, 'system', 'billing.subscription_ended', { status: sub.status })
}

/** Verarbeitet ein verifiziertes Stripe-Ereignis genau einmal. */
export async function handleStripeEvent(deps: Deps, gw: StripeGateway, event: StripeEventLite): Promise<'processed' | 'duplicate' | 'ignored'> {
  const fresh = await deps.db.query(`INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`, [
    event.id,
    event.type
  ])
  if (!fresh.length) return 'duplicate'
  try {
    const o = event.object
    switch (event.type) {
      case 'checkout.session.completed': {
        if (o.mode === 'subscription' && o.subscription) {
          const sub = await gw.retrieveSubscription(typeof o.subscription === 'string' ? o.subscription : o.subscription.id)
          await applySubscription(deps, gw, sub, o.metadata?.plan)
          const acc = await accountForCustomer(deps.db, sub.customer, o.metadata?.accountId)
          if (acc) await audit(deps.db, acc, 'system', 'billing.subscribed', { plan: o.metadata?.plan })
          return 'processed'
        }
        if (o.mode === 'setup' && o.metadata?.purpose === 'payg' && o.setup_intent) {
          const pm = await gw.setupIntentPaymentMethod(typeof o.setup_intent === 'string' ? o.setup_intent : o.setup_intent.id)
          const customer = typeof o.customer === 'string' ? o.customer : o.customer?.id
          const acc = await accountForCustomer(deps.db, customer, o.metadata?.accountId)
          if (!pm || !acc) return 'ignored'
          await gw.setDefaultPaymentMethod(customer, pm)
          const pricing = await getPricing(deps.db)
          const cap = Math.min(Math.max(1, Number(o.metadata?.capGb) || pricing.payg.defaultCapGb), pricing.payg.maxCapGb)
          await deps.db.query(`UPDATE accounts SET payg_enabled = true, payg_cap_gb = $2 WHERE id = $1 AND plan = 'free'`, [acc, cap])
          await audit(deps.db, acc, 'system', 'billing.payg_enabled', { capGb: cap, via: 'stripe' })
          return 'processed'
        }
        return 'ignored'
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Immer den aktuellen Stand holen – Ereignisse können in falscher Reihenfolge ankommen.
        const sub = await gw.retrieveSubscription(o.id)
        await applySubscription(deps, gw, sub)
        return 'processed'
      }
      case 'invoice.payment_failed':
      case 'invoice.paid': {
        const customer = typeof o.customer === 'string' ? o.customer : o.customer?.id
        const acc = customer ? await accountForCustomer(deps.db, customer) : null
        if (!acc) return 'ignored'
        await audit(deps.db, acc, 'system', event.type === 'invoice.paid' ? 'billing.invoice_paid' : 'billing.payment_failed', {
          amount: (o.amount_paid ?? o.amount_due ?? 0) / 100,
          currency: String(o.currency ?? '').toUpperCase()
        })
        if (o.metadata?.kind === 'payg' && o.metadata?.period) {
          await deps.db.query(`UPDATE payg_invoices SET status = $3 WHERE account_id = $1 AND period = $2`, [
            acc,
            o.metadata.period,
            event.type === 'invoice.paid' ? 'charged' : 'failed'
          ])
        }
        return 'processed'
      }
      default:
        return 'ignored'
    }
  } catch (e) {
    // Beim nächsten Zustellversuch erneut verarbeiten
    await deps.db.query('DELETE FROM stripe_events WHERE id = $1', [event.id])
    throw e
  }
}

// ---------------------------------------------------------------------------------------------
// Pay-as-you-go: Tagesstand + Monatsabschluss
// ---------------------------------------------------------------------------------------------

/** Tagesstand aller PAYG-Konten festhalten (einmal pro Tag, mehrfacher Aufruf überschreibt). */
export async function snapshotPaygUsage(db: Db, day = new Date()): Promise<number> {
  const d = day.toISOString().slice(0, 10)
  const rows = await db.query(
    `INSERT INTO usage_daily (account_id, day, bytes)
     SELECT a.id, $1::date, COALESCE(SUM(o.cipher_bytes), 0)
       FROM accounts a LEFT JOIN objects o ON o.owner_account_id = a.id AND o.state IN ('uploading', 'stored', 'version', 'trashed')
      WHERE a.plan = 'free' AND a.payg_enabled
      GROUP BY a.id
     ON CONFLICT (account_id, day) DO UPDATE SET bytes = GREATEST(usage_daily.bytes, EXCLUDED.bytes)
     RETURNING account_id`,
    [d]
  )
  return rows.length
}

function previousPeriod(now: Date): { period: string; start: string; end: string; days: number } {
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { period: `${y}-${mm}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(days).padStart(2, '0')}`, days }
}

/**
 * Monatsabschluss (ab dem 1. des Folgemonats, idempotent je Konto und Monat):
 * Durchschnitt der Tagesstände über alle Tage des Monats (Tage ohne PAYG zählen 0),
 * minus Free-Quota, mal GB-Preis, plus Übertrag. Unter dem Minimum → Übertrag.
 */
export async function closePaygMonth(deps: Deps, gw: StripeGateway | null, now = new Date()): Promise<{ charged: number; carried: number }> {
  const p = previousPeriod(now)
  const pricing = await getPricing(deps.db)
  const usage = await deps.db.query<{ account_id: string; total: number; currency: Currency; stripe_customer_id: string | null }>(
    `SELECT u.account_id, SUM(u.bytes)::float8 AS total, a.currency, a.stripe_customer_id
       FROM usage_daily u JOIN accounts a ON a.id = u.account_id
      WHERE u.day BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM payg_invoices i WHERE i.account_id = u.account_id AND i.period = $3)
      GROUP BY u.account_id, a.currency, a.stripe_customer_id`,
    [p.start, p.end, p.period]
  )
  let charged = 0
  let carried = 0
  for (const u of usage) {
    const avgBytes = Number(u.total) / p.days
    const est = paygEstimate(pricing, avgBytes, u.currency)
    const prev = await deps.db.query<{ carried_out: string }>(
      `SELECT carried_out FROM payg_invoices WHERE account_id = $1 ORDER BY period DESC LIMIT 1`,
      [u.account_id]
    )
    const carriedIn = Number(prev[0]?.carried_out ?? 0)
    const total = round2(est.amount + carriedIn)
    const due = total >= pricing.payg.minInvoice[u.currency]
    let status: 'carried' | 'charged' | 'failed' | 'recorded' = due ? 'recorded' : 'carried'
    let invoiceId: string | null = null
    if (due && gw && u.stripe_customer_id) {
      const r = await gw.chargeOnce({
        customer: u.stripe_customer_id,
        currency: cur(u.currency),
        amount: cents(total),
        description: `FocVault Pay-as-you-go ${p.period}: ${est.billableGb.toFixed(1)} GB im Monatsschnitt`,
        metadata: { accountId: u.account_id, kind: 'payg', period: p.period },
        automaticTax: stripeTaxEnabled()
      })
      invoiceId = r.invoiceId
      status = r.paid ? 'charged' : 'failed'
    }
    await deps.db.query(
      `INSERT INTO payg_invoices (account_id, period, billable_gb, amount, carried_in, carried_out, currency, status, stripe_invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (account_id, period) DO NOTHING`,
      [u.account_id, p.period, est.billableGb, total, carriedIn, due ? 0 : total, u.currency, status, invoiceId]
    )
    if (due) charged++
    else carried++
    if (status === 'failed') await audit(deps.db, u.account_id, 'system', 'billing.payment_failed', { period: p.period, amount: total })
  }
  return { charged, carried }
}
