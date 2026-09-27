import { createPublicClient, formatUnits, http } from 'viem'
import type { Plan } from '../../lib/api-types'
import { filecoin, filecoinCalibration, USDFC, USDFC_DECIMALS } from '../../lib/chains'
import { erc20Abi } from '../../lib/abis'
import { GB, computeEconomics, paygInvoiceChf, round2, type Economics, type PricingConfig } from '../../lib/pricing'
import { formatBytes } from '../../lib/vault'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { isProd } from '../shared/env'
import { isUuid, uuidv7 } from '../shared/ids'
import type { SessionInfo } from '../auth/sessions'
import { usedBytes } from '../accounts/plans'
import { getPricing, getTreasury } from './settings'
import { quotaFor } from './quota'

/**
 * Käufe ohne Zahlungsanbieter nur lokal bzw. mit BILLING_DEV_PURCHASES=1 (Staging).
 * In Production ohne Stripe → klare Meldung statt „kostenlos freischalten".
 */
function assertPurchasesAllowed(): void {
  if (isProd && process.env.BILLING_DEV_PURCHASES !== '1') {
    throw new ApiError('PLAN_REQUIRED', 'Online-Zahlung (Stripe) folgt in Kürze – bis dahin schaltet der Support frei.')
  }
}

async function loadAccount(deps: Deps, accountId: string) {
  const rows = await deps.db.query<{ id: string; plan: Plan; payg_enabled: boolean; payg_cap_gb: number | null }>(
    'SELECT id, plan, payg_enabled, payg_cap_gb FROM accounts WHERE id = $1',
    [accountId]
  )
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  return rows[0]
}

export interface PublicOffer {
  free: { quotaGb: number }
  payg: { chfPerGbMonth: number; minInvoiceChf: number; defaultCapGb: number; maxCapGb: number }
  plans: PricingConfig['plans']
  addons: PricingConfig['addons']
  purchasesEnabled: boolean
}

export async function offer(deps: Deps): Promise<PublicOffer> {
  const p = await getPricing(deps.db)
  return {
    free: p.free,
    payg: p.payg,
    plans: p.plans,
    addons: p.addons,
    purchasesEnabled: !isProd || process.env.BILLING_DEV_PURCHASES === '1'
  }
}

export async function buyAddon(deps: Deps, session: SessionInfo, packId: string): Promise<void> {
  const account = await loadAccount(deps, session.accountId)
  if (account.plan !== 'pro' && account.plan !== 'family') {
    throw new ApiError('PLAN_REQUIRED', 'Zusatzspeicher gibt es für Pro- und Family-Abos.')
  }
  const pricing = await getPricing(deps.db)
  const pack = pricing.addons.find(a => a.id === packId)
  if (!pack) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  assertPurchasesAllowed()
  await deps.db.query(
    `INSERT INTO account_addons (id, account_id, pack_id, bytes, chf_per_month, source) VALUES ($1, $2, $3, $4, $5, 'dev')`,
    [uuidv7(), account.id, pack.id, pack.gb * GB, pack.chfPerMonth]
  )
  await audit(deps.db, account.id, 'user', 'billing.addon_added', { pack: pack.id, gb: pack.gb, chf: pack.chfPerMonth })
}

/** Kündigen nur, wenn die Daten danach noch in die Quota passen. */
export async function cancelAddon(deps: Deps, session: SessionInfo, addonId: string, actor: 'user' | 'admin' = 'user'): Promise<void> {
  if (!isUuid(addonId)) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const rows = await deps.db.query<{ account_id: string; bytes: number }>(
    `SELECT account_id, bytes::float8 AS bytes FROM account_addons WHERE id = $1 AND status = 'active'`,
    [addonId]
  )
  const addon = rows[0]
  if (!addon || (actor === 'user' && addon.account_id !== session.accountId)) throw new ApiError('NOT_FOUND', 'Paket nicht gefunden.')
  const account = await loadAccount(deps, addon.account_id)
  const pricing = await getPricing(deps.db)
  const { quotaBytes } = await quotaFor(deps.db, account, pricing)
  const used = await usedBytes(deps.db, account.id)
  if (actor === 'user' && used > quotaBytes - Number(addon.bytes)) {
    throw new ApiError('BAD_REQUEST', `Bitte zuerst ${formatBytes(used - (quotaBytes - Number(addon.bytes)))} freigeben – sonst passen deine Daten nicht mehr.`)
  }
  await deps.db.query(`UPDATE account_addons SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [addonId])
  await audit(deps.db, account.id, actor, 'billing.addon_cancelled', { gb: Number(addon.bytes) / GB })
}

export async function setPayg(deps: Deps, session: SessionInfo, enabled: boolean, capGb?: number): Promise<void> {
  const account = await loadAccount(deps, session.accountId)
  if (account.plan !== 'free') throw new ApiError('BAD_REQUEST', 'Pay-as-you-go gibt es für das Free-Konto. Abos erweitern mit Zusatzspeicher.')
  const pricing = await getPricing(deps.db)
  const cap = Math.min(Math.max(1, Math.round(capGb ?? pricing.payg.defaultCapGb)), pricing.payg.maxCapGb)
  if (enabled) assertPurchasesAllowed()
  if (!enabled) {
    const used = await usedBytes(deps.db, account.id)
    if (used > pricing.free.quotaGb * GB) {
      throw new ApiError('BAD_REQUEST', `Du nutzt ${formatBytes(used)} – bitte zuerst unter ${pricing.free.quotaGb} GB kommen.`)
    }
  }
  await deps.db.query('UPDATE accounts SET payg_enabled = $2, payg_cap_gb = $3 WHERE id = $1', [account.id, enabled, cap])
  await audit(deps.db, account.id, 'user', enabled ? 'billing.payg_enabled' : 'billing.payg_disabled', { capGb: cap })
}

export async function adminGrantAddon(
  deps: Deps,
  admin: SessionInfo,
  accountId: string,
  input: { gb: number; chfPerMonth: number; note?: string }
): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  await loadAccount(deps, accountId)
  await deps.db.query(
    `INSERT INTO account_addons (id, account_id, bytes, chf_per_month, source, note) VALUES ($1, $2, $3, $4, 'admin', $5)`,
    [uuidv7(), accountId, input.gb * GB, input.chfPerMonth, input.note ?? null]
  )
  await audit(deps.db, accountId, 'admin', 'billing.addon_granted', { gb: input.gb, chf: input.chfPerMonth, by: admin.accountId })
}

export async function adminUpdateAccount(
  deps: Deps,
  admin: SessionInfo,
  accountId: string,
  input: { plan?: Plan; paygEnabled?: boolean; paygCapGb?: number; status?: 'active' | 'readonly' | 'suspended' }
): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const current = await loadAccount(deps, accountId)
  await deps.db.query(
    `UPDATE accounts SET plan = $2, payg_enabled = $3, payg_cap_gb = $4, status = COALESCE($5, status) WHERE id = $1`,
    [
      accountId,
      input.plan ?? current.plan,
      input.paygEnabled ?? current.payg_enabled,
      input.paygCapGb ?? current.payg_cap_gb,
      input.status ?? null
    ]
  )
  await audit(deps.db, accountId, 'admin', 'account.updated', { ...input, by: admin.accountId })
}

export interface AccountBilling {
  baseBytes: number
  addonBytes: number
  paygBytes: number
  addons: Array<{ id: string; packId: string | null; gb: number; chfPerMonth: number; source: string; createdAt: string }>
  payg: { enabled: boolean; capGb: number; chfPerGbMonth: number; estimateChf: number }
  planChf: number
  monthlyChf: number
}

export async function accountBilling(deps: Deps, accountId: string, stored: number): Promise<AccountBilling & { quotaBytes: number }> {
  const account = await loadAccount(deps, accountId)
  const pricing = await getPricing(deps.db)
  const q = await quotaFor(deps.db, account, pricing)
  const addons = await deps.db.query<{
    id: string
    pack_id: string | null
    bytes: number
    chf_per_month: string
    source: string
    created_at: Date
  }>(
    `SELECT id, pack_id, bytes::float8 AS bytes, chf_per_month::text, source, created_at
       FROM account_addons WHERE account_id = $1 AND status = 'active' ORDER BY created_at`,
    [accountId]
  )
  const planChf = account.plan === 'pro' ? pricing.plans.pro.chfPerMonth : account.plan === 'family' ? pricing.plans.family.chfPerMonth : 0
  const addonsChf = addons.reduce((n, a) => n + Number(a.chf_per_month), 0)
  const paygEstimate = account.plan === 'free' && account.payg_enabled ? paygInvoiceChf(pricing, stored) : 0
  return {
    quotaBytes: q.quotaBytes,
    baseBytes: q.baseBytes,
    addonBytes: q.addonBytes,
    paygBytes: q.paygBytes,
    addons: addons.map(a => ({
      id: a.id,
      packId: a.pack_id,
      gb: Number(a.bytes) / GB,
      chfPerMonth: Number(a.chf_per_month),
      source: a.source,
      createdAt: new Date(a.created_at).toISOString()
    })),
    payg: {
      enabled: account.payg_enabled,
      capGb: account.payg_cap_gb ?? pricing.payg.defaultCapGb,
      chfPerGbMonth: pricing.payg.chfPerGbMonth,
      estimateChf: paygEstimate
    },
    planChf,
    monthlyChf: round2(planChf + (account.plan === 'free' ? 0 : addonsChf) + paygEstimate)
  }
}

const STORED_BY_ACCOUNT = `SELECT owner_account_id, SUM(cipher_bytes) AS stored FROM objects WHERE state = 'stored' GROUP BY owner_account_id`

export interface EconomicsReport {
  pricing: PricingConfig
  economics: Economics
  history: Array<{ day: string; storedBytes: number; accounts: number }>
  inactiveFree: { warn: number; delete: number }
}

/** Ist-Wirtschaftlichkeit aus Echtdaten + Tagesstand fortschreiben (Verlauf). */
export async function economicsReport(deps: Deps): Promise<EconomicsReport> {
  const pricing = await getPricing(deps.db)
  const byPlan = await deps.db.query<{ plan: Plan; accounts: number; stored: number }>(
    `SELECT a.plan, count(*)::float8 AS accounts, COALESCE(SUM(s.stored), 0)::float8 AS stored
       FROM accounts a LEFT JOIN (${STORED_BY_ACCOUNT}) s ON s.owner_account_id = a.id
      WHERE a.status <> 'deleted' GROUP BY a.plan`
  )
  const addons = await deps.db.query<{ n: number; chf: number }>(
    `SELECT count(*)::float8 AS n, COALESCE(SUM(ad.chf_per_month), 0)::float8 AS chf
       FROM account_addons ad JOIN accounts a ON a.id = ad.account_id
      WHERE ad.status = 'active' AND a.plan IN ('pro', 'family')`
  )
  const payg = await deps.db.query<{ stored: number }>(
    `SELECT COALESCE(s.stored, 0)::float8 AS stored
       FROM accounts a LEFT JOIN (${STORED_BY_ACCOUNT}) s ON s.owner_account_id = a.id
      WHERE a.plan = 'free' AND a.payg_enabled AND a.status <> 'deleted'`
  )
  const row = (plan: Plan) => {
    const r = byPlan.find(x => x.plan === plan)
    return { accounts: Number(r?.accounts ?? 0), storedBytes: Number(r?.stored ?? 0) }
  }
  let paygInvoices = 0
  let paygChf = 0
  let billable = 0
  for (const r of payg) {
    const inv = paygInvoiceChf(pricing, Number(r.stored))
    if (inv > 0) paygInvoices++
    paygChf += inv
    billable += Math.max(0, Number(r.stored) - pricing.free.quotaGb * GB)
  }
  const economics = computeEconomics(pricing, {
    free: row('free'),
    pro: row('pro'),
    family: row('family'),
    business: row('business'),
    addons: { active: Number(addons[0]?.n ?? 0), chfPerMonth: Number(addons[0]?.chf ?? 0) },
    payg: { invoices: paygInvoices, chfPerMonth: round2(paygChf), billableBytes: billable }
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
    inactiveFree: { warn: Number(inactive[0]?.warn ?? 0), delete: Number(inactive[0]?.del ?? 0) }
  }
}

export interface TreasuryStatus {
  address: string
  chainId: 314 | 314159
  label: string
  balances: { usdfc: number; fil: number } | null
  error: string | null
  /** Monatliche Fil-One-Kosten (USD) laut Ist-Stand – USDFC ≈ USD */
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
  storedBytes: number
  quotaGb: number
  addonsGb: number
  addonsChf: number
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
    stored: number
    addons_bytes: number
    addons_chf: number
    payg_enabled: boolean
    payg_cap_gb: number | null
    last_login_at: Date | null
    created_at: Date
  }>(
    `SELECT a.id,
            COALESCE(a.email, a.label, (SELECT w.address FROM auth_wallets w WHERE w.account_id = a.id LIMIT 1), '—') AS display,
            a.plan, a.status, a.payg_enabled, a.payg_cap_gb, a.last_login_at, a.created_at,
            COALESCE((SELECT SUM(o.cipher_bytes) FROM objects o WHERE o.owner_account_id = a.id AND o.state = 'stored'), 0)::float8 AS stored,
            COALESCE((SELECT SUM(ad.bytes) FROM account_addons ad WHERE ad.account_id = a.id AND ad.status = 'active'), 0)::float8 AS addons_bytes,
            COALESCE((SELECT SUM(ad.chf_per_month) FROM account_addons ad WHERE ad.account_id = a.id AND ad.status = 'active'), 0)::float8 AS addons_chf
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
      storedBytes: Number(r.stored),
      quotaGb: planQuota(r.plan),
      addonsGb: Number(r.addons_bytes) / GB,
      addonsChf: Number(r.addons_chf),
      paygEnabled: r.payg_enabled,
      paygCapGb: r.payg_cap_gb,
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString()
    }))
  }
}
