import { createPublicClient, formatUnits, http } from 'viem'
import type { AccountBilling, Plan } from '../../lib/api-types'
import { filecoin, filecoinCalibration, USDFC, USDFC_DECIMALS } from '../../lib/chains'
import { erc20Abi } from '../../lib/abis'
import {
  GB,
  computeEconomics,
  monthlyEquivalent,
  paygEstimate,
  priceOf,
  round2,
  toChf,
  type Currency,
  type Economics,
  type Interval,
  type PricingConfig
} from '../../lib/pricing'
import { formatBytes } from '../../lib/vault'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { isProd } from '../shared/env'
import { isUuid, uuidv7 } from '../shared/ids'
import type { SessionInfo } from '../auth/sessions'
import { usedBytes } from '../accounts/plans'
import { getPricing, getTreasury } from './settings'
import { quotaFor } from './quota'
import { isFamilyMember, pooledUsedBytes, syncFamilyAfterPlanChange } from '../family/service'
import { stripeGateway } from '../stripe/gateway'
import {
  stripeBuyAddon,
  stripeChangePlan,
  stripePaygSetupUrl,
  stripeRemoveAddonItem,
  type StripeContext
} from '../stripe/service'

/** Ergebnis eines Kaufvorgangs: entweder sofort erledigt oder Weiterleitung zu Stripe. */
export interface BillingResult {
  redirectUrl?: string
}

const DEV_CONTEXT: StripeContext = { origin: 'http://localhost:3000', locale: 'de' }

/** Mit Stripe immer; ohne Zahlungsanbieter nur lokal bzw. mit BILLING_DEV_PURCHASES=1 (Staging). */
export function purchasesEnabled(): boolean {
  return !!stripeGateway() || !isProd || process.env.BILLING_DEV_PURCHASES === '1'
}

function assertPurchasesAllowed(): void {
  if (!purchasesEnabled()) {
    throw new ApiError('PLAN_REQUIRED', 'Online-Zahlung (Stripe) folgt in Kürze – bis dahin schaltet der Support frei.')
  }
}

interface AccountRow {
  id: string
  plan: Plan
  payg_enabled: boolean
  payg_cap_gb: number | null
  currency: Currency
  billing_interval: Interval
  business_tier: 'starter' | 'business' | 'enterprise' | null
  seats: number | null
}

async function loadAccount(deps: Deps, accountId: string): Promise<AccountRow> {
  const rows = await deps.db.query<AccountRow>(
    'SELECT id, plan, payg_enabled, payg_cap_gb, currency, billing_interval, business_tier, seats FROM accounts WHERE id = $1',
    [accountId]
  )
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  return rows[0]
}

export interface PublicOffer {
  free: PricingConfig['free']
  payg: PricingConfig['payg']
  plans: PricingConfig['plans']
  addons: PricingConfig['addons']
  trashDays: number
  versions: PricingConfig['versions']
  business: PricingConfig['business']
  purchasesEnabled: boolean
}

export async function offer(deps: Deps): Promise<PublicOffer> {
  const p = await getPricing(deps.db)
  return { free: p.free, payg: p.payg, plans: p.plans, addons: p.addons, trashDays: p.trashDays, versions: p.versions, business: p.business, purchasesEnabled: purchasesEnabled() }
}

/** Währung wählen (nur solange kein Abo/Zusatzspeicher läuft – sonst Wechsel beim Planwechsel). */
export async function setCurrency(deps: Deps, session: SessionInfo, currency: Currency): Promise<void> {
  const account = await loadAccount(deps, session.accountId)
  const addons = await deps.db.query(`SELECT 1 FROM account_addons WHERE account_id = $1 AND status = 'active' LIMIT 1`, [account.id])
  if (account.plan !== 'free' || addons.length) {
    throw new ApiError('BAD_REQUEST', 'Die Währung lässt sich bei einem laufenden Abo nur zusammen mit einem Planwechsel ändern.')
  }
  await deps.db.query('UPDATE accounts SET currency = $2 WHERE id = $1', [account.id, currency])
}

export interface PlanChange {
  plan: 'free' | 'pro' | 'family' | 'business'
  interval: Interval
  currency: Currency
  tier?: 'starter' | 'business'
  extraSeats?: number
}

/** Speicher einer Plan-Wahl in GB (Business nach Stufe). */
export function planQuotaGb(pricing: PricingConfig, input: PlanChange): number {
  if (input.plan === 'business') return pricing.business[input.tier ?? 'business'].quotaGb
  return input.plan === 'pro' ? pricing.plans.pro.quotaGb : pricing.plans.family.quotaGb
}

/**
 * Planwechsel (Self-Service; ohne Stripe nur im Entwicklungsmodus).
 * Downgrade auf Free nur, wenn die Daten in die Free-Quota passen – Zusatzspeicher endet dann.
 */
export async function changePlan(
  deps: Deps,
  session: SessionInfo,
  input: PlanChange,
  ctx: StripeContext = DEV_CONTEXT
): Promise<BillingResult> {
  if (await isFamilyMember(deps.db, session.accountId)) {
    throw new ApiError('BAD_REQUEST', 'Du bist Mitglied einer Family – für ein eigenes Abo bitte zuerst austreten.')
  }
  const gw = stripeGateway()
  if (gw) {
    const url = await stripeChangePlan(deps, gw, session, input, ctx)
    await syncFamilyAfterPlanChange(deps.db, session.accountId)
    return url ? { redirectUrl: url } : {}
  }
  assertPurchasesAllowed()
  const account = await loadAccount(deps, session.accountId)
  const pricing = await getPricing(deps.db)
  if (input.plan === 'free') {
    const used = await usedBytes(deps.db, account.id)
    if (used > pricing.free.quotaGb * GB) {
      throw new ApiError('BAD_REQUEST', `Du nutzt ${formatBytes(used)} – für Free bitte zuerst unter ${pricing.free.quotaGb} GB kommen.`)
    }
    await deps.db.tx(async tx => {
      await tx.query(`UPDATE account_addons SET status = 'cancelled', cancelled_at = now() WHERE account_id = $1 AND status = 'active'`, [
        account.id
      ])
      await tx.query(`UPDATE accounts SET plan = 'free', payg_enabled = false WHERE id = $1`, [account.id])
    })
  } else {
    const newQuota = planQuotaGb(pricing, input) * GB
    const addonRows = await deps.db.query<{ bytes: number }>(
      `SELECT COALESCE(SUM(bytes), 0)::float8 AS bytes FROM account_addons WHERE account_id = $1 AND status = 'active'`,
      [account.id]
    )
    const used = await usedBytes(deps.db, account.id)
    if (used > newQuota + Number(addonRows[0]?.bytes ?? 0)) {
      throw new ApiError('BAD_REQUEST', `Du nutzt ${formatBytes(used)} – das passt nicht in dieses Paket.`)
    }
    const tier = input.plan === 'business' ? (input.tier ?? 'business') : null
    const seats = tier ? pricing.business[tier].seats + (input.extraSeats ?? 0) : null
    if (seats !== null) await assertSeatsFit(deps, account.id, seats)
    await deps.db.tx(async tx => {
      await tx.query(
        `UPDATE accounts SET plan = $2, billing_interval = $3, currency = $4, payg_enabled = false, business_tier = $5, seats = $6 WHERE id = $1`,
        [account.id, input.plan, input.interval, input.currency, tier, seats]
      )
      // Zusatzspeicher folgt Währung und Intervall des Abos (Preis neu aus dem Preisbuch).
      const addons = await tx.query<{ id: string; pack_id: string | null }>(
        `SELECT id, pack_id FROM account_addons WHERE account_id = $1 AND status = 'active' AND source <> 'admin'`,
        [account.id]
      )
      for (const a of addons) {
        const pack = pricing.addons.find(x => x.id === a.pack_id)
        if (!pack) continue
        await tx.query('UPDATE account_addons SET currency = $2, billing_interval = $3, price = $4 WHERE id = $1', [
          a.id,
          input.currency,
          input.interval,
          priceOf(pack, input.interval, input.currency)
        ])
      }
    })
  }
  await syncFamilyAfterPlanChange(deps.db, account.id)
  await audit(deps.db, account.id, 'user', 'billing.plan_changed', { ...input })
  return {}
}

/** Weniger Plätze buchen geht nur, wenn die bestehenden Mitglieder hineinpassen. */
async function assertSeatsFit(deps: Deps, accountId: string, seats: number): Promise<void> {
  const r = await deps.db.query<{ n: number }>('SELECT count(*)::float8 AS n FROM family_members WHERE owner_account_id = $1', [accountId])
  const members = Number(r[0]?.n ?? 0) + 1
  if (members > seats) throw new ApiError('BAD_REQUEST', `Dein Team hat ${members} Personen – bitte mindestens ${members} Nutzer wählen.`)
}

export async function buyAddon(deps: Deps, session: SessionInfo, packId: string): Promise<BillingResult> {
  const account = await loadAccount(deps, session.accountId)
  if (account.plan !== 'pro' && account.plan !== 'family' && account.plan !== 'business') {
    throw new ApiError('PLAN_REQUIRED', 'Zusatzspeicher gibt es für Pro-, Family- und Business-Abos.')
  }
  if (await isFamilyMember(deps.db, account.id)) {
    throw new ApiError('PLAN_REQUIRED', 'Zusatzspeicher für die Familie bucht der Family-Inhaber.')
  }
  const pricing = await getPricing(deps.db)
  const pack = pricing.addons.find(a => a.id === packId)
  if (!pack) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const gw = stripeGateway()
  if (gw) {
    const sub = await deps.db.query<{ s: string | null }>('SELECT stripe_subscription_id AS s FROM accounts WHERE id = $1', [account.id])
    if (sub[0]?.s || isProd) {
      await stripeBuyAddon(deps, gw, session, packId)
      return {}
    }
  }
  assertPurchasesAllowed()
  const price = priceOf(pack, account.billing_interval, account.currency)
  await deps.db.query(
    `INSERT INTO account_addons (id, account_id, pack_id, bytes, price, currency, billing_interval, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'dev')`,
    [uuidv7(), account.id, pack.id, pack.gb * GB, price, account.currency, account.billing_interval]
  )
  await audit(deps.db, account.id, 'user', 'billing.addon_added', { pack: pack.id, gb: pack.gb, price, currency: account.currency })
  return {}
}

/** Kündigen nur, wenn die Daten danach noch in die Quota passen. */
export async function cancelAddon(deps: Deps, session: SessionInfo, addonId: string, actor: 'user' | 'admin' = 'user'): Promise<void> {
  if (!isUuid(addonId)) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const rows = await deps.db.query<{ account_id: string; bytes: number; stripe_item_id: string | null }>(
    `SELECT account_id, bytes::float8 AS bytes, stripe_item_id FROM account_addons WHERE id = $1 AND status = 'active'`,
    [addonId]
  )
  const addon = rows[0]
  if (!addon || (actor === 'user' && addon.account_id !== session.accountId)) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const account = await loadAccount(deps, addon.account_id)
  const pricing = await getPricing(deps.db)
  const { quotaBytes } = await quotaFor(deps.db, account, pricing)
  const used = await pooledUsedBytes(deps.db, account.id)
  if (actor === 'user' && used > quotaBytes - Number(addon.bytes)) {
    throw new ApiError(
      'BAD_REQUEST',
      `Bitte zuerst ${formatBytes(used - (quotaBytes - Number(addon.bytes)))} freigeben – sonst passen deine Daten nicht mehr.`
    )
  }
  const gw = stripeGateway()
  if (gw) await stripeRemoveAddonItem(gw, addon.stripe_item_id)
  await deps.db.query(`UPDATE account_addons SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [addonId])
  await audit(deps.db, account.id, actor, 'billing.addon_cancelled', { gb: Number(addon.bytes) / GB })
}

export async function setPayg(
  deps: Deps,
  session: SessionInfo,
  enabled: boolean,
  capGb?: number,
  ctx: StripeContext = DEV_CONTEXT
): Promise<BillingResult> {
  const account = await loadAccount(deps, session.accountId)
  if (account.plan !== 'free') {
    throw new ApiError('BAD_REQUEST', 'Pay-as-you-go gibt es für das Free-Konto. Abos erweitern mit Zusatzspeicher.')
  }
  const pricing = await getPricing(deps.db)
  const cap = Math.min(Math.max(1, Math.round(capGb ?? pricing.payg.defaultCapGb)), pricing.payg.maxCapGb)
  if (enabled) assertPurchasesAllowed()
  // Mit Stripe: beim ersten Einschalten Karte hinterlegen lassen (Webhook schaltet dann ein).
  const gw = stripeGateway()
  if (gw && enabled && !account.payg_enabled) {
    const url = await stripePaygSetupUrl(deps, gw, session, cap, ctx)
    if (url) return { redirectUrl: url }
  }
  if (!enabled) {
    const used = await usedBytes(deps.db, account.id)
    if (used > pricing.free.quotaGb * GB) {
      throw new ApiError('BAD_REQUEST', `Du nutzt ${formatBytes(used)} – bitte zuerst unter ${pricing.free.quotaGb} GB kommen.`)
    }
  } else {
    const used = await usedBytes(deps.db, account.id)
    if (used > (pricing.free.quotaGb + cap) * GB) {
      throw new ApiError('BAD_REQUEST', `Du nutzt bereits ${formatBytes(used)} – bitte eine höhere Obergrenze wählen.`)
    }
  }
  await deps.db.query('UPDATE accounts SET payg_enabled = $2, payg_cap_gb = $3 WHERE id = $1', [account.id, enabled, cap])
  await audit(deps.db, account.id, 'user', enabled ? 'billing.payg_enabled' : 'billing.payg_disabled', { capGb: cap })
  return {}
}

export async function adminGrantAddon(
  deps: Deps,
  admin: SessionInfo,
  accountId: string,
  input: { gb: number; price: number; note?: string }
): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const account = await loadAccount(deps, accountId)
  await deps.db.query(
    `INSERT INTO account_addons (id, account_id, bytes, price, currency, billing_interval, source, note)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7)`,
    [uuidv7(), accountId, input.gb * GB, input.price, account.currency, account.billing_interval, input.note ?? null]
  )
  await audit(deps.db, accountId, 'admin', 'billing.addon_granted', { gb: input.gb, price: input.price, by: admin.accountId })
}

export async function adminUpdateAccount(
  deps: Deps,
  admin: SessionInfo,
  accountId: string,
  input: {
    plan?: Plan
    interval?: Interval
    currency?: Currency
    paygEnabled?: boolean
    paygCapGb?: number
    status?: 'active' | 'readonly' | 'suspended'
  }
): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const c = await loadAccount(deps, accountId)
  await deps.db.query(
    `UPDATE accounts SET plan = $2, billing_interval = $3, currency = $4, payg_enabled = $5, payg_cap_gb = $6,
            status = COALESCE($7, status) WHERE id = $1`,
    [
      accountId,
      input.plan ?? c.plan,
      input.interval ?? c.billing_interval,
      input.currency ?? c.currency,
      input.paygEnabled ?? c.payg_enabled,
      input.paygCapGb ?? c.payg_cap_gb,
      input.status ?? null
    ]
  )
  await syncFamilyAfterPlanChange(deps.db, accountId)
  await audit(deps.db, accountId, 'admin', 'account.updated', { ...input, by: admin.accountId })
}

/** Abrechnungsübersicht eines Kontos in seiner Währung. */
export async function accountBilling(deps: Deps, accountId: string, stored: number): Promise<AccountBilling & { quotaBytes: number }> {
  const account = await loadAccount(deps, accountId)
  const pricing = await getPricing(deps.db)
  const q = await quotaFor(deps.db, account, pricing)
  const addons = await deps.db.query<{
    id: string
    pack_id: string | null
    bytes: number
    price: string
    currency: Currency
    billing_interval: Interval
    source: string
    created_at: Date
  }>(
    `SELECT id, pack_id, bytes::float8 AS bytes, price::text, currency, billing_interval, source, created_at
       FROM account_addons WHERE account_id = $1 AND status = 'active' ORDER BY created_at`,
    [accountId]
  )
  const cur = account.currency
  const interval = account.billing_interval
  const member = await isFamilyMember(deps.db, account.id)
  const tier = account.plan === 'business' ? (account.business_tier ?? 'business') : null
  const selfTier = tier === 'starter' || tier === 'business' ? tier : null
  const included = selfTier ? pricing.business[selfTier].seats : tier === 'enterprise' ? pricing.business.enterprise.seats : 0
  const extraSeats = tier ? Math.max(0, (account.seats ?? included) - included) : 0
  const planItem = member ? null : account.plan === 'pro' ? pricing.plans.pro : account.plan === 'family' ? pricing.plans.family : selfTier ? pricing.business[selfTier] : null
  const seatPrice = selfTier && !member ? extraSeats * priceOf(pricing.business.seat, interval, cur) : 0
  const planPrice = (planItem ? priceOf(planItem, interval, cur) : 0) + seatPrice
  const planMonthly = (planItem ? monthlyEquivalent(planItem, interval, cur) : 0) + (selfTier && !member ? extraSeats * monthlyEquivalent(pricing.business.seat, interval, cur) : 0)
  const addonsMonthly = addons.reduce((n, a) => n + Number(a.price) / (a.billing_interval === 'year' ? 12 : 1), 0)
  const est = paygEstimate(pricing, stored, cur)
  const paygMonthly = account.plan === 'free' && account.payg_enabled ? est.amount : 0
  const sub = await deps.db.query<{
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    subscription_status: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
  }>(
    'SELECT stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, cancel_at_period_end FROM accounts WHERE id = $1',
    [accountId]
  )
  return {
    quotaBytes: q.quotaBytes,
    baseBytes: q.baseBytes,
    addonBytes: q.addonBytes,
    paygBytes: q.paygBytes,
    currency: cur,
    interval,
    planPrice,
    addons: addons.map(a => ({
      id: a.id,
      packId: a.pack_id,
      gb: Number(a.bytes) / GB,
      price: Number(a.price),
      currency: a.currency,
      interval: a.billing_interval,
      source: a.source,
      createdAt: new Date(a.created_at).toISOString()
    })),
    payg: {
      enabled: account.payg_enabled,
      capGb: account.payg_cap_gb ?? pricing.payg.defaultCapGb,
      perGb: pricing.payg.perGbMonth[cur],
      minInvoice: pricing.payg.minInvoice[cur],
      billableGb: round2(est.billableGb),
      estimate: est.amount,
      charged: est.charged,
      proBreakEvenGb: est.proBreakEvenGb
    },
    monthlyTotal: round2(planMonthly + (account.plan === 'free' ? 0 : addonsMonthly) + paygMonthly),
    subscription: {
      provider: sub[0]?.stripe_subscription_id ? 'stripe' : 'manual',
      status: sub[0]?.subscription_status ?? null,
      periodEnd: sub[0]?.current_period_end ? new Date(sub[0].current_period_end).toISOString() : null,
      cancelAtPeriodEnd: !!sub[0]?.cancel_at_period_end,
      hasPaymentAccount: !!sub[0]?.stripe_customer_id
    },
    stripe: !!stripeGateway(),
    business: tier ? { tier, seats: account.seats ?? included, includedSeats: included, extraSeats, member } : null
  }
}

const STORED_BY_ACCOUNT = `SELECT owner_account_id, SUM(cipher_bytes) AS stored FROM objects WHERE state IN ('stored', 'version', 'trashed') GROUP BY owner_account_id`

export interface EconomicsReport {
  pricing: PricingConfig
  economics: Economics
  history: Array<{ day: string; storedBytes: number; accounts: number }>
  inactiveFree: { warn: number; delete: number }
  mix: Array<{ plan: Plan; currency: Currency; interval: Interval; accounts: number }>
}

/** Ist-Wirtschaftlichkeit aus Echtdaten (Umsatz je Währung/Intervall in CHF umgerechnet). */
export async function economicsReport(deps: Deps): Promise<EconomicsReport> {
  const pricing = await getPricing(deps.db)
  const byPlan = await deps.db.query<{ plan: Plan; accounts: number; stored: number }>(
    `SELECT a.plan, count(*)::float8 AS accounts, COALESCE(SUM(s.stored), 0)::float8 AS stored
       FROM accounts a LEFT JOIN (${STORED_BY_ACCOUNT}) s ON s.owner_account_id = a.id
      WHERE a.status <> 'deleted' GROUP BY a.plan`
  )
  const mix = await deps.db.query<{ plan: Plan; currency: Currency; billing_interval: Interval; n: number }>(
    `SELECT plan, currency, billing_interval, count(*)::float8 AS n FROM accounts
      WHERE status <> 'deleted' AND plan IN ('pro', 'family') GROUP BY 1, 2, 3`
  )
  const addonRows = await deps.db.query<{ currency: Currency; billing_interval: Interval; n: number; total: number }>(
    `SELECT ad.currency, ad.billing_interval, count(*)::float8 AS n, COALESCE(SUM(ad.price), 0)::float8 AS total
       FROM account_addons ad JOIN accounts a ON a.id = ad.account_id
      WHERE ad.status = 'active' AND a.plan IN ('pro', 'family') GROUP BY 1, 2`
  )
  const payg = await deps.db.query<{ stored: number; currency: Currency }>(
    `SELECT COALESCE(s.stored, 0)::float8 AS stored, a.currency
       FROM accounts a LEFT JOIN (${STORED_BY_ACCOUNT}) s ON s.owner_account_id = a.id
      WHERE a.plan = 'free' AND a.payg_enabled AND a.status <> 'deleted'`
  )
  const row = (plan: Plan) => {
    const r = byPlan.find(x => x.plan === plan)
    return { accounts: Number(r?.accounts ?? 0), storedBytes: Number(r?.stored ?? 0) }
  }
  let proChf = 0
  let familyChf = 0
  let invoices = 0
  for (const m of mix) {
    const item = m.plan === 'pro' ? pricing.plans.pro : pricing.plans.family
    const chfPerMonth = toChf(pricing, monthlyEquivalent(item, m.billing_interval, m.currency), m.currency) * Number(m.n)
    if (m.plan === 'pro') proChf += chfPerMonth
    else familyChf += chfPerMonth
    invoices += m.billing_interval === 'year' ? Number(m.n) / 12 : Number(m.n)
  }
  let addonsChf = 0
  let addonsActive = 0
  for (const a of addonRows) {
    addonsChf += toChf(pricing, Number(a.total) / (a.billing_interval === 'year' ? 12 : 1), a.currency)
    addonsActive += Number(a.n)
  }
  let paygChf = 0
  let billable = 0
  for (const r of payg) {
    const est = paygEstimate(pricing, Number(r.stored), r.currency)
    if (est.charged) {
      paygChf += toChf(pricing, est.amount, r.currency)
      invoices++
    }
    billable += est.billableGb * GB
  }
  const economics = computeEconomics(pricing, {
    free: row('free'),
    pro: row('pro'),
    family: row('family'),
    business: row('business'),
    revenue: { proChf, familyChf, addonsChf, paygChf },
    invoicesPerMonth: invoices,
    addonsActive,
    paygBillableBytes: billable
  })

  for (const plan of ['free', 'pro', 'family', 'business'] as const) {
    const r = row(plan)
    await deps.db.query(
      `INSERT INTO platform_daily (day, plan, accounts, stored_bytes) VALUES (current_date, $1, $2, $3)
       ON CONFLICT (day, plan) DO UPDATE SET accounts = EXCLUDED.accounts, stored_bytes = EXCLUDED.stored_bytes`,
      [plan, r.accounts, r.storedBytes]
    )
  }
  const history = await deps.db.query<{ day: string; stored: number; accounts: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(stored_bytes)::float8 AS stored, SUM(accounts)::float8 AS accounts
       FROM platform_daily WHERE day > current_date - 30 GROUP BY day ORDER BY day`
  )
  const inactive = await deps.db.query<{ warn: number; del: number }>(
    `SELECT count(*) FILTER (WHERE COALESCE(last_login_at, created_at) < now() - make_interval(days => $1))::float8 AS warn,
            count(*) FILTER (WHERE COALESCE(last_login_at, created_at) < now() - make_interval(days => $2))::float8 AS del
       FROM accounts WHERE plan = 'free' AND status = 'active'`,
    [pricing.freeTier.inactiveWarnDays, pricing.freeTier.inactiveDeleteDays]
  )
  return {
    pricing,
    economics,
    history: history.map(h => ({ day: h.day, storedBytes: Number(h.stored), accounts: Number(h.accounts) })),
    inactiveFree: { warn: Number(inactive[0]?.warn ?? 0), delete: Number(inactive[0]?.del ?? 0) },
    mix: mix.map(m => ({ plan: m.plan, currency: m.currency, interval: m.billing_interval, accounts: Number(m.n) }))
  }
}

export interface TreasuryStatus {
  address: string
  chainId: 314 | 314159
  label: string
  balances: { usdfc: number; fil: number } | null
  error: string | null
  monthlyCostUsd: number
  runwayMonths: number | null
}

/** Öffentliche Reserve-Adresse: Saldo live von der Chain (nur lesen, nie signieren). */
export async function treasuryStatus(deps: Deps): Promise<TreasuryStatus> {
  const t = await getTreasury(deps.db)
  const report = await economicsReport(deps)
  const monthlyCostUsd = report.economics.cost.storageUsd
  const base = { ...t, monthlyCostUsd, balances: null, error: null, runwayMonths: null }
  if (!t.address) return base
  try {
    const chain = t.chainId === 314 ? filecoin : filecoinCalibration
    const client = createPublicClient({ chain, transport: http() })
    const token = USDFC[t.chainId]
    const [usdfcRaw, filRaw] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [t.address as `0x${string}`] }),
      client.getBalance({ address: t.address as `0x${string}` })
    ])
    const usdfc = Number(formatUnits(usdfcRaw as bigint, USDFC_DECIMALS))
    const fil = Number(formatUnits(filRaw, 18))
    return { ...base, balances: { usdfc, fil }, runwayMonths: monthlyCostUsd > 0 ? round2(usdfc / monthlyCostUsd) : null }
  } catch {
    return { ...base, error: 'Saldo konnte nicht von der Chain gelesen werden (RPC nicht erreichbar).' }
  }
}

export interface AdminAccountListRow {
  id: string
  display: string
  plan: Plan
  status: string
  currency: Currency
  interval: Interval
  storedBytes: number
  quotaGb: number
  addonsGb: number
  addonsMonthly: number
  paygEnabled: boolean
  paygCapGb: number | null
  lastLoginAt: string | null
  createdAt: string
}

/** Suche + Seitenweise – skaliert auf 100 000+ Konten. */
export async function adminListAccounts(
  deps: Deps,
  q: string,
  offset: number,
  limit = 50
): Promise<{ total: number; rows: AdminAccountListRow[] }> {
  const pricing = await getPricing(deps.db)
  const term = q.trim().toLowerCase()
  const where = term
    ? `WHERE a.email LIKE $1 OR a.label ILIKE $1 OR EXISTS (SELECT 1 FROM auth_wallets w WHERE w.account_id = a.id AND w.address LIKE $1)`
    : ''
  const params: unknown[] = term ? [`%${term}%`] : []
  const total = await deps.db.query<{ n: number }>(`SELECT count(*)::float8 AS n FROM accounts a ${where}`, params)
  const rows = await deps.db.query<{
    id: string
    display: string
    plan: Plan
    status: string
    currency: Currency
    billing_interval: Interval
    stored: number
    addons_bytes: number
    addons_monthly: number
    payg_enabled: boolean
    payg_cap_gb: number | null
    last_login_at: Date | null
    created_at: Date
  }>(
    `SELECT a.id,
            COALESCE(a.email, a.label, (SELECT w.address FROM auth_wallets w WHERE w.account_id = a.id LIMIT 1), '—') AS display,
            a.plan, a.status, a.currency, a.billing_interval, a.payg_enabled, a.payg_cap_gb, a.last_login_at, a.created_at,
            COALESCE((SELECT SUM(o.cipher_bytes) FROM objects o WHERE o.owner_account_id = a.id AND o.state IN ('stored', 'version', 'trashed')), 0)::float8 AS stored,
            COALESCE((SELECT SUM(ad.bytes) FROM account_addons ad WHERE ad.account_id = a.id AND ad.status = 'active'), 0)::float8 AS addons_bytes,
            COALESCE((SELECT SUM(CASE WHEN ad.billing_interval = 'year' THEN ad.price / 12 ELSE ad.price END)
                        FROM account_addons ad WHERE ad.account_id = a.id AND ad.status = 'active'), 0)::float8 AS addons_monthly
       FROM accounts a ${where}
      ORDER BY a.created_at DESC
      LIMIT ${Math.min(Math.max(1, limit), 200)} OFFSET ${Math.max(0, Math.floor(offset))}`,
    params
  )
  const planQuota = (plan: Plan) =>
    plan === 'pro' ? pricing.plans.pro.quotaGb : plan === 'family' ? pricing.plans.family.quotaGb : plan === 'free' ? pricing.free.quotaGb : 100_000
  return {
    total: Number(total[0]?.n ?? 0),
    rows: rows.map(r => ({
      id: r.id,
      display: r.display,
      plan: r.plan,
      status: r.status,
      currency: r.currency,
      interval: r.billing_interval,
      storedBytes: Number(r.stored),
      quotaGb: planQuota(r.plan),
      addonsGb: Number(r.addons_bytes) / GB,
      addonsMonthly: round2(Number(r.addons_monthly)),
      paygEnabled: r.payg_enabled,
      paygCapGb: r.payg_cap_gb,
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString()
    }))
  }
}
