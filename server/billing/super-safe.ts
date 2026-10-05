import type { AccountBilling, Plan } from '../../lib/api-types'
import { GB, priceOf, round2, superSafeTb, type Currency, type Interval, type PricingConfig } from '../../lib/pricing'
import type { SessionInfo } from '../auth/sessions'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import { isFamilyMember, quotaAccountId } from '../family/service'
import { getFocSettings } from '../foc/config'
import { ApiError } from '../shared/errors'
import { isProd } from '../shared/env'
import { isUuid, uuidv7 } from '../shared/ids'
import { stripeGateway } from '../stripe/gateway'
import { stripeAddSuperSafeItem } from '../stripe/service'
import { quotaFor } from './quota'
import { getPricing } from './settings'
import { purchasesEnabled, type BillingResult } from './service'

/**
 * Super Safe: mehr Filecoin-Kopien (Standard 5 statt 2) für ein Abo-Konto.
 * - Preis je TB der Gesamtquota (Plan + Zusatzspeicher, aufgerundet, mind. 1) und Intervall.
 * - Läuft wie Zusatzspeicher als Position im bestehenden Stripe-Abo (Menge = TB); ohne Stripe nur
 *   lokal bzw. Staging (Quelle 'dev'), oder als Admin-Freischaltung (Quelle 'admin').
 * - Bucht der Inhaber, gilt es für alle Mitglieder seiner Family bzw. seines Teams (geteilte Quota).
 * - Die Kopien selbst entstehen bzw. verschwinden im FOC-Abgleich (server/foc/sync.ts).
 */

interface SuperSafeRow {
  id: string
  account_id: string
  source: 'admin' | 'stripe' | 'dev'
  tb: number
  unit_price: string
  currency: Currency
  billing_interval: Interval
  stripe_item_id: string | null
  created_at: Date
}

interface Acc {
  id: string
  plan: Plan
  currency: Currency
  billing_interval: Interval
  payg_enabled: boolean
  payg_cap_gb: number | null
}

const PAID = new Set<Plan>(['pro', 'family', 'business'])

export async function activeSuperSafe(db: Db, accountId: string): Promise<SuperSafeRow | null> {
  const rows = await db.query<SuperSafeRow>(
    `SELECT id, account_id, source, tb, unit_price::text, currency, billing_interval, stripe_item_id, created_at
       FROM account_super_safe WHERE account_id = $1 AND status = 'active'`,
    [accountId]
  )
  return rows[0] ?? null
}

async function loadAcc(db: Db, id: string): Promise<Acc> {
  const rows = await db.query<Acc>('SELECT id, plan, currency, billing_interval, payg_enabled, payg_cap_gb FROM accounts WHERE id = $1', [id])
  if (!rows[0]) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  return rows[0]
}

/** Abgerechnete TB = Gesamtquota des Inhabers (Plan + Zusatzspeicher), aufgerundet. */
async function quotaTb(db: Db, acc: Acc, pricing: PricingConfig): Promise<number> {
  return superSafeTb((await quotaFor(db, acc, pricing)).quotaBytes / GB)
}

async function assertEligible(db: Db, acc: Acc): Promise<void> {
  if (!PAID.has(acc.plan)) throw new ApiError('PLAN_REQUIRED', 'Super Safe gibt es für Pro-, Family- und Business-Abos.')
  if (await isFamilyMember(db, acc.id)) throw new ApiError('PLAN_REQUIRED', 'Super Safe bucht der Inhaber deiner Family bzw. deines Teams.')
}

export async function buySuperSafe(deps: Deps, session: SessionInfo): Promise<BillingResult> {
  const acc = await loadAcc(deps.db, session.accountId)
  await assertEligible(deps.db, acc)
  const pricing = await getPricing(deps.db)
  if (!pricing.superSafe.enabled) throw new ApiError('BAD_REQUEST', 'Super Safe ist derzeit nicht buchbar.')
  if (await activeSuperSafe(deps.db, acc.id)) throw new ApiError('BAD_REQUEST', 'Super Safe ist bereits gebucht.')
  const tb = await quotaTb(deps.db, acc, pricing)
  const unit = priceOf(pricing.superSafe.perTb, acc.billing_interval, acc.currency)
  const id = uuidv7()
  let itemId: string | null = null
  const gw = stripeGateway()
  if (gw) {
    const sub = await deps.db.query<{ s: string | null }>('SELECT stripe_subscription_id AS s FROM accounts WHERE id = $1', [acc.id])
    if (sub[0]?.s || isProd) itemId = await stripeAddSuperSafeItem(deps, gw, acc.id, id, unit, tb)
  }
  if (!itemId && !purchasesEnabled()) {
    throw new ApiError('PLAN_REQUIRED', 'Online-Zahlung (Stripe) folgt in Kürze – bis dahin schaltet der Support frei.')
  }
  const source = itemId ? 'stripe' : 'dev'
  await deps.db.query(
    `INSERT INTO account_super_safe (id, account_id, source, tb, unit_price, currency, billing_interval, stripe_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, acc.id, source, tb, unit, acc.currency, acc.billing_interval, itemId]
  )
  await audit(deps.db, acc.id, 'user', 'billing.super_safe_added', {
    tb,
    unitPrice: unit,
    price: round2(unit * tb),
    currency: acc.currency,
    interval: acc.billing_interval,
    copies: pricing.superSafe.copies,
    via: source
  })
  return {}
}

async function endSuperSafe(deps: Deps, row: SuperSafeRow, actor: 'user' | 'admin' | 'system', reason?: string): Promise<void> {
  const gw = stripeGateway()
  if (gw && row.stripe_item_id) {
    try {
      await gw.removeItem(row.stripe_item_id)
    } catch (e) {
      // Systemseitig (Abo schon beendet) ist die Position ohnehin weg – sonst nicht still weiterberechnen
      if (actor !== 'system') throw e
    }
  }
  await deps.db.query(`UPDATE account_super_safe SET status = 'cancelled', cancelled_at = now() WHERE id = $1 AND status = 'active'`, [row.id])
  await audit(deps.db, row.account_id, actor, 'billing.super_safe_cancelled', { tb: row.tb, ...(reason ? { reason } : {}) })
}

/** Kündigen: sofort; die zusätzlichen Kopien werden beim nächsten FOC-Abgleich freigegeben. */
export async function cancelSuperSafe(deps: Deps, session: SessionInfo, actor: 'user' | 'admin' = 'user', accountId = session.accountId): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const row = await activeSuperSafe(deps.db, accountId)
  if (!row) throw new ApiError('NOT_FOUND', 'Super Safe ist nicht gebucht.')
  await endSuperSafe(deps, row, actor)
}

/**
 * Nach Plan- oder Speicheränderung aufrufen (idempotent): Menge (TB) nachführen, Währung/Intervall
 * einer Dev-Buchung mitziehen, ohne Abo (Free) bzw. als Mitglied beenden.
 */
export async function syncSuperSafe(deps: Deps, accountId: string): Promise<void> {
  const row = await activeSuperSafe(deps.db, accountId)
  if (!row) return
  const acc = await loadAcc(deps.db, accountId)
  if (!PAID.has(acc.plan) || (await isFamilyMember(deps.db, acc.id))) return endSuperSafe(deps, row, 'system', 'plan')
  const pricing = await getPricing(deps.db)
  const tb = await quotaTb(deps.db, acc, pricing)
  if (row.source === 'dev' && (row.currency !== acc.currency || row.billing_interval !== acc.billing_interval)) {
    await deps.db.query('UPDATE account_super_safe SET currency = $2, billing_interval = $3, unit_price = $4 WHERE id = $1', [
      row.id,
      acc.currency,
      acc.billing_interval,
      priceOf(pricing.superSafe.perTb, acc.billing_interval, acc.currency)
    ])
  }
  if (tb === row.tb) return
  const gw = stripeGateway()
  if (gw && row.stripe_item_id) await gw.setItemQuantity(row.stripe_item_id, tb)
  await deps.db.query('UPDATE account_super_safe SET tb = $2 WHERE id = $1', [row.id, tb])
  await audit(deps.db, acc.id, 'system', 'billing.super_safe_resized', { from: row.tb, to: tb })
}

/** Admin: Super Safe freischalten (Preis je TB, Standard 0) oder beenden. */
export async function adminSetSuperSafe(
  deps: Deps,
  admin: SessionInfo,
  accountId: string,
  input: { enabled: boolean; unitPrice?: number; note?: string }
): Promise<void> {
  if (!isUuid(accountId)) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  const row = await activeSuperSafe(deps.db, accountId)
  if (!input.enabled) {
    if (row) await endSuperSafe(deps, row, 'admin', `by:${admin.accountId}`)
    return
  }
  if (row) throw new ApiError('BAD_REQUEST', 'Super Safe ist bereits aktiv.')
  const acc = await loadAcc(deps.db, accountId)
  await assertEligible(deps.db, acc)
  const tb = await quotaTb(deps.db, acc, await getPricing(deps.db))
  const unit = input.unitPrice ?? 0
  await deps.db.query(
    `INSERT INTO account_super_safe (id, account_id, source, tb, unit_price, currency, billing_interval, note)
     VALUES ($1, $2, 'admin', $3, $4, $5, $6, $7)`,
    [uuidv7(), accountId, tb, unit, acc.currency, acc.billing_interval, input.note ?? null]
  )
  await audit(deps.db, accountId, 'admin', 'billing.super_safe_granted', { tb, unitPrice: unit, by: admin.accountId })
}

/** Super Safe in der Abrechnungsübersicht (Mitglieder sehen die Buchung des Inhabers). */
export async function superSafeBilling(
  db: Db,
  account: { id: string; plan: Plan; currency: Currency; billing_interval: Interval },
  quotaBytes: number,
  member: boolean,
  pricing: PricingConfig
): Promise<AccountBilling['superSafe']> {
  const row = await activeSuperSafe(db, member ? await quotaAccountId(db, account.id) : account.id)
  const baseCopies = (await getFocSettings(db)).copies
  const tb = row?.tb ?? superSafeTb(quotaBytes / GB)
  const unitPrice = row ? Number(row.unit_price) : priceOf(pricing.superSafe.perTb, account.billing_interval, account.currency)
  return {
    active: !!row,
    member,
    inherited: !!row && member,
    available: pricing.superSafe.enabled && PAID.has(account.plan) && !member,
    copies: Math.max(pricing.superSafe.copies, baseCopies),
    baseCopies,
    tb,
    unitPrice,
    price: round2(unitPrice * tb),
    currency: row?.currency ?? account.currency,
    interval: row?.billing_interval ?? account.billing_interval,
    source: row?.source ?? null,
    since: row ? new Date(row.created_at).toISOString() : null
  }
}
