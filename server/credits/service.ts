import { z } from 'zod'
import type { Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { ApiError } from '../shared/errors'
import { uuidv7 } from '../shared/ids'

/**
 * Guthaben (Prepaid): Einzahlungen per Karte (Stripe) oder später Krypto; Verbrauch zuerst aus dem
 * Guthaben, erst der Rest über die hinterlegte Zahlungsmethode. Beträge in der Kontowährung.
 */
export type Currency = 'CHF' | 'EUR' | 'USD'
export const MIN_DEPOSIT = 5
export const MAX_DEPOSIT = 5000

/** Ganze Rappen/Cent (höchstens zwei Nachkommastellen), gegen Gleitkomma-Rauschen robust. */
export const isWholeCents = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

export const depositSchema = z.object({
  amount: z
    .number()
    .finite()
    .min(MIN_DEPOSIT, `Mindestens ${MIN_DEPOSIT} aufladen.`)
    .max(MAX_DEPOSIT, `Höchstens ${MAX_DEPOSIT} pro Aufladung.`)
    .refine(isWholeCents, 'Betrag höchstens mit zwei Nachkommastellen angeben.')
})

/** Auch serverseitig (nicht nur im Schema) prüfen, bevor ein Zahlungsvorgang entsteht. */
export function assertDepositAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
    throw new ApiError('BAD_REQUEST', `Aufladungen zwischen ${MIN_DEPOSIT} und ${MAX_DEPOSIT} sind möglich.`)
  }
  if (!isWholeCents(amount)) throw new ApiError('BAD_REQUEST', 'Betrag höchstens mit zwei Nachkommastellen angeben.')
}

export interface CreditEntry {
  id: string
  amount: number
  currency: Currency
  kind: 'deposit' | 'charge' | 'refund' | 'grant'
  source: 'stripe' | 'crypto' | 'admin' | 'dev' | 'system'
  note: string | null
  createdAt: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function creditBalance(db: Db, accountId: string, currency: Currency): Promise<number> {
  const r = await db.query<{ b: number }>(`SELECT coalesce(sum(amount), 0)::float8 AS b FROM credit_ledger WHERE account_id = $1 AND currency = $2`, [accountId, currency])
  return round2(Number(r[0]?.b ?? 0))
}

export async function creditHistory(db: Db, accountId: string, limit = 20): Promise<CreditEntry[]> {
  const r = await db.query<{ id: string; amount: number; currency: Currency; kind: CreditEntry['kind']; source: CreditEntry['source']; note: string | null; created_at: string }>(
    `SELECT id, amount::float8 AS amount, currency, kind, source, note, created_at FROM credit_ledger WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [accountId, limit]
  )
  return r.map(x => ({ id: x.id, amount: Number(x.amount), currency: x.currency, kind: x.kind, source: x.source, note: x.note, createdAt: new Date(x.created_at).toISOString() }))
}

/** Gutschrift buchen (idempotent über ref, z. B. Stripe-Checkout-Session). */
export async function addCredit(
  db: Db,
  input: { accountId: string; amount: number; currency: Currency; kind: 'deposit' | 'grant' | 'refund'; source: CreditEntry['source']; ref?: string; note?: string }
): Promise<boolean> {
  if (!(input.amount > 0)) throw new ApiError('BAD_REQUEST', 'Betrag muss positiv sein.')
  const r = await db.query(
    `INSERT INTO credit_ledger (id, account_id, amount, currency, kind, source, ref, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ref) DO NOTHING RETURNING id`,
    [uuidv7(), input.accountId, round2(input.amount), input.currency, input.kind, input.source, input.ref ?? null, input.note ?? null]
  )
  if (r.length) await audit(db, input.accountId, 'system', 'credit.added', { amount: round2(input.amount), currency: input.currency, source: input.source })
  return r.length > 0
}

/**
 * Bis zu `amount` aus dem Guthaben verbrauchen; liefert den tatsächlich verbrauchten Betrag.
 * Gleiche ref zweimal → nichts doppelt abgebucht.
 */
export async function consumeCredit(db: Db, accountId: string, amount: number, currency: Currency, ref: string, note: string): Promise<number> {
  return db.tx(async tx => {
    await tx.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId])
    const done = await tx.query<{ a: number }>('SELECT amount::float8 AS a FROM credit_ledger WHERE ref = $1', [ref])
    if (done[0]) return round2(-Number(done[0].a))
    const bal = await tx.query<{ b: number }>(`SELECT coalesce(sum(amount), 0)::float8 AS b FROM credit_ledger WHERE account_id = $1 AND currency = $2`, [accountId, currency])
    const use = round2(Math.min(Math.max(0, Number(bal[0]?.b ?? 0)), amount))
    if (use <= 0) return 0
    await tx.query(`INSERT INTO credit_ledger (id, account_id, amount, currency, kind, source, ref, note) VALUES ($1, $2, $3, $4, 'charge', 'system', $5, $6)`, [
      uuidv7(),
      accountId,
      -use,
      currency,
      ref,
      note
    ])
    return use
  })
}

/**
 * Rückbuchung (z. B. erstattete oder angefochtene Aufladung). Anders als `consumeCredit` darf das
 * Guthaben dabei ins Minus fallen – das Geld ist bereits weg. Gleiche Sperre wie `consumeCredit`
 * (Konto FOR UPDATE), idempotent über ref. `amount` darf eine Funktion sein, die den Betrag erst
 * unter der Sperre berechnet (z. B. Rest nach früheren Teilerstattungen).
 * Fällt das Guthaben unter null, wird Pay-as-you-go abgeschaltet und bleibt gesperrt, bis das
 * Minus ausgeglichen ist (siehe setPayg).
 */
export async function debitCredit(
  db: Db,
  input: { accountId: string; currency: Currency; ref: string; note: string; amount: number | ((tx: Db) => Promise<number>) }
): Promise<{ debited: number; balance: number; paygDisabled: boolean }> {
  return db.tx(async tx => {
    await tx.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [input.accountId])
    const bal = async () => {
      const r = await tx.query<{ b: number }>(`SELECT coalesce(sum(amount), 0)::float8 AS b FROM credit_ledger WHERE account_id = $1 AND currency = $2`, [input.accountId, input.currency])
      return round2(Number(r[0]?.b ?? 0))
    }
    const done = await tx.query('SELECT 1 FROM credit_ledger WHERE ref = $1', [input.ref])
    if (done[0]) return { debited: 0, balance: await bal(), paygDisabled: false }
    const amount = round2(typeof input.amount === 'function' ? await input.amount(tx) : input.amount)
    if (!(amount > 0)) return { debited: 0, balance: await bal(), paygDisabled: false }
    await tx.query(`INSERT INTO credit_ledger (id, account_id, amount, currency, kind, source, ref, note) VALUES ($1, $2, $3, $4, 'refund', 'stripe', $5, $6)`, [
      uuidv7(),
      input.accountId,
      -amount,
      input.currency,
      input.ref,
      input.note
    ])
    const balance = await bal()
    let paygDisabled = false
    if (balance < 0) {
      const r = await tx.query(`UPDATE accounts SET payg_enabled = false WHERE id = $1 AND payg_enabled RETURNING id`, [input.accountId])
      paygDisabled = r.length > 0
    }
    await audit(tx, input.accountId, 'system', 'credit.reversed', { amount, currency: input.currency, balance, paygDisabled })
    return { debited: amount, balance, paygDisabled }
  })
}

/** Summe negativer Rückbuchungen, deren ref mit `prefix` beginnt (für Teilerstattungen/Obergrenzen). */
export async function reversedSum(db: Db, prefix: string): Promise<number> {
  const r = await db.query<{ s: number }>(`SELECT coalesce(sum(-amount), 0)::float8 AS s FROM credit_ledger WHERE ref LIKE $1 AND kind = 'refund' AND amount < 0`, [
    prefix.replace(/[\\%_]/g, m => '\\' + m) + '%'
  ])
  return round2(Number(r[0]?.s ?? 0))
}

export interface CreditsView {
  balance: number
  currency: Currency
  history: CreditEntry[]
  stripe: boolean
  hasPaymentMethod: boolean
  crypto: boolean
}

export async function creditsView(deps: Deps, session: SessionInfo, opts: { stripe: boolean; hasPaymentMethod: boolean }): Promise<CreditsView> {
  const a = await deps.db.query<{ currency: Currency }>('SELECT currency FROM accounts WHERE id = $1', [session.accountId])
  const currency = a[0]?.currency ?? 'CHF'
  return { balance: await creditBalance(deps.db, session.accountId, currency), currency, history: await creditHistory(deps.db, session.accountId), ...opts, crypto: false }
}
