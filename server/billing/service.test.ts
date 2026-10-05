import { addCredit, consumeCredit, debitCredit } from '../credits/service'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PRICING, GB } from '../../lib/pricing'
import { resetRateLimits } from '../auth/ratelimit'
import { accountView } from '../accounts/service'
import { completeObject, createObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import type { Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { getPricing, setPricing } from './settings'
import { adminSetSuperSafe, buySuperSafe, cancelSuperSafe } from './super-safe'
import { createInvite, joinFamily } from '../family/service'
import {
  adminGrantAddon,
  adminListAccounts,
  adminUpdateAccount,
  buyAddon,
  cancelAddon,
  changePlan,
  economicsReport,
  setCurrency,
  setPayg
} from './service'

/** Datei „hochladen" (Speicher belegen) ohne echten Upload. */
async function store(deps: Deps & { storage: { objects: Map<string, Uint8Array> } }, session: SessionInfo, bytes: number) {
  const c = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: bytes }] })
  deps.storage.objects.set(objectPieceKey(session.accountId, c.objectId, 0), new Uint8Array(0))
  // Größe für head() vortäuschen
  const key = objectPieceKey(session.accountId, c.objectId, 0)
  ;(deps.storage as any).head = async (k: string) => (k === key ? { size: bytes } : null)
  await completeObject(deps, session, c.objectId)
}

describe('Billing: Pakete, Zusatzspeicher, Pay-as-you-go', () => {
  beforeEach(() => resetRateLimits())

  it('Free: 5 GB, mit PAYG bis zur Obergrenze; Abschalten nur unter 5 GB', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'free@example.com')
    expect((await accountView(deps, session.accountId)).quotaBytes).toBe(5 * GB)
    // offener Betrag (negatives Guthaben) sperrt PAYG; ohne Stripe sonst nur lokal (Entwicklung) startbar.
    // Mit Stripe ist eine Zahlungsmethode Pflicht – siehe stripe/service.test.ts.
    await debitCredit(deps.db, { accountId: session.accountId, currency: 'CHF', amount: 3, ref: 'test:minus', note: 'Erstattung' })
    await expect(setPayg(deps, session, true, 50)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await addCredit(deps.db, { accountId: session.accountId, amount: 10, currency: 'CHF', kind: 'deposit', source: 'dev' })
    await setPayg(deps, session, true, 50)
    const v = await accountView(deps, session.accountId)
    expect(v.quotaBytes).toBe(55 * GB)
    expect(v.billing.payg).toMatchObject({ enabled: true, capGb: 50 })
    await store(deps, session, 6 * GB)
    await expect(setPayg(deps, session, false)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('Zusatzspeicher nur mit Abo; Kündigung nur, wenn die Daten danach passen', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'pro@example.com')
    await expect(buyAddon(deps, session, 'plus-500')).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await adminUpdateAccount(deps, session, session.accountId, { plan: 'pro' })
    const pro = { ...session, plan: 'pro' as const }
    await buyAddon(deps, pro, 'plus-500')
    let v = await accountView(deps, session.accountId)
    expect(v.quotaBytes).toBe(1500 * GB)
    expect(v.billing.monthlyTotal).toBeCloseTo(13.9 + 5.9, 2)
    expect(v.billing.currency).toBe('CHF')
    const addonId = v.billing.addons[0].id

    await store(deps, pro, 1200 * GB)
    await expect(cancelAddon(deps, pro, addonId)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(buyAddon(deps, pro, 'gibt-es-nicht')).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await adminGrantAddon(deps, pro, session.accountId, { gb: 100, price: 0, note: 'Kulanz' })
    v = await accountView(deps, session.accountId)
    expect(v.quotaBytes).toBe(1600 * GB)
  })

  it('Preisbuch-Änderung wirkt sofort auf die Quota', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'preis@example.com')
    await setPricing(deps.db, { ...DEFAULT_PRICING, free: { quotaGb: 10 } }, session.accountId)
    expect((await getPricing(deps.db)).free.quotaGb).toBe(10)
    expect((await accountView(deps, session.accountId)).quotaBytes).toBe(10 * GB)
  })

  it('Wirtschaftlichkeit aus Echtdaten, Verlauf und Kontosuche', async () => {
    const deps = await testDeps()
    const a = await newAccount(deps, 'anna@example.com')
    const b = await newAccount(deps, 'bruno@example.com')
    await adminUpdateAccount(deps, a.session, b.session.accountId, { plan: 'family' })
    await store(deps, a.session, 2 * GB)
    const r = await economicsReport(deps)
    expect(r.economics.perPlan.find(p => p.plan === 'free')).toMatchObject({ accounts: 1, storedBytes: 2 * GB })
    expect(r.economics.revenue.familyChf).toBeCloseTo(19.9, 2)
    expect(r.economics.cost.storageUsd).toBe(4.99) // Minimum
    expect(r.history).toHaveLength(1)
    const found = await adminListAccounts(deps, 'BRUNO', 0)
    expect(found.total).toBe(1)
    expect(found.rows[0]).toMatchObject({ display: 'bruno@example.com', plan: 'family', quotaGb: 2000 })
  })
})

describe('Billing v2: Jahresabo, Währungen, Planwechsel', () => {
  beforeEach(() => resetRateLimits())

  it('Jahresabo in EUR: Preis pro Jahr, Monatssumme umgelegt, Zusatzspeicher folgt Währung/Intervall', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'jahr@example.com')
    await changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'CHF' })
    const pro = { ...session, plan: 'pro' as const }
    await buyAddon(deps, pro, 'plus-500')
    await changePlan(deps, pro, { plan: 'pro', interval: 'year', currency: 'EUR' })
    const v = await accountView(deps, session.accountId)
    expect(v.billing).toMatchObject({ currency: 'EUR', interval: 'year', planPrice: 139 })
    expect(v.billing.addons[0]).toMatchObject({ price: 59, currency: 'EUR', interval: 'year' })
    expect(v.billing.monthlyTotal).toBeCloseTo((139 + 59) / 12, 2)
  })

  it('Downgrade auf Free nur, wenn die Daten passen; Zusatzspeicher endet', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'down@example.com')
    await changePlan(deps, session, { plan: 'family', interval: 'month', currency: 'USD' })
    const fam = { ...session, plan: 'family' as const }
    await buyAddon(deps, fam, 'plus-200')
    await store(deps, fam, 8 * GB)
    await expect(changePlan(deps, fam, { plan: 'free', interval: 'month', currency: 'USD' })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
  })

  it('Währung nur ohne laufendes Abo frei wählbar; PAYG-Schätzung in Kontowährung', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'usd@example.com')
    await setCurrency(deps, session, 'USD')
    await addCredit(deps.db, { accountId: session.accountId, amount: 10, currency: 'USD', kind: 'deposit', source: 'dev' })
    await setPayg(deps, session, true, 200)
    await store(deps, session, 105 * GB)
    const v = await accountView(deps, session.accountId)
    expect(v.billing.payg).toMatchObject({ perGb: 0.035, estimate: 3.5, charged: true })
    await changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'USD' })
    await expect(setCurrency(deps, { ...session, plan: 'pro' }, 'EUR')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('Währungswechsel gesperrt, solange Guthaben, ein offener Betrag oder PAYG-Nutzung besteht', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'wechsel@example.com')
    const id = session.accountId
    await addCredit(deps.db, { accountId: id, amount: 12, currency: 'CHF', kind: 'deposit', source: 'dev', ref: 'dev:w1' })
    await expect(setCurrency(deps, session, 'EUR')).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('12.00 CHF') })
    // auch nicht über einen Planwechsel in anderer Währung
    await expect(changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'EUR' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await setCurrency(deps, session, 'CHF') // gleiche Währung: nichts zu tun

    // aufgebraucht → Wechsel möglich; Guthaben in der Zielwährung stört nicht
    expect(await consumeCredit(deps.db, id, 12, 'CHF', 'test:verbrauch', 'Verbrauch')).toBe(12)
    await setCurrency(deps, session, 'EUR')
    await addCredit(deps.db, { accountId: id, amount: 5, currency: 'CHF', kind: 'deposit', source: 'dev', ref: 'dev:w2' })
    await setCurrency(deps, session, 'CHF')

    // offener Betrag
    await debitCredit(deps.db, { accountId: id, currency: 'CHF', amount: 8, ref: 'test:minus', note: 'Erstattung' })
    await expect(setCurrency(deps, session, 'USD')).rejects.toMatchObject({ message: expect.stringContaining('offener Betrag von 3.00 CHF') })
    await addCredit(deps.db, { accountId: id, amount: 3, currency: 'CHF', kind: 'deposit', source: 'dev', ref: 'dev:w3' })

    // PAYG-Nutzung des laufenden Monats noch nicht abgerechnet
    await deps.db.query(`INSERT INTO usage_daily (account_id, day, bytes) VALUES ($1, current_date, $2)`, [id, 1e9])
    await expect(setCurrency(deps, session, 'USD')).rejects.toMatchObject({ message: expect.stringContaining('Pay-as-you-go') })
  })
})

describe('Super Safe (mehr Filecoin-Kopien)', () => {
  beforeEach(() => resetRateLimits())

  it('nur für Abos; Preis je TB der Gesamtquota, Menge folgt Zusatzspeicher und Planwechsel, endet mit Free', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'safe@example.com')
    await expect(buySuperSafe(deps, session)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    let v = await accountView(deps, session.accountId)
    expect(v.billing.superSafe).toMatchObject({ active: false, available: false, copies: 5, baseCopies: 2, tb: 1 })

    await changePlan(deps, session, { plan: 'pro', interval: 'month', currency: 'USD' })
    const pro = { ...session, plan: 'pro' as const }
    await buySuperSafe(deps, pro)
    await expect(buySuperSafe(deps, pro)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    v = await accountView(deps, session.accountId)
    expect(v.billing.superSafe).toMatchObject({ active: true, tb: 1, unitPrice: 2.99, price: 2.99, currency: 'USD', interval: 'month', source: 'dev' })
    expect(v.billing.monthlyTotal).toBeCloseTo(14.9 + 2.99, 2)

    // 1 TB + 500 GB → 2 TB
    await buyAddon(deps, pro, 'plus-500')
    v = await accountView(deps, session.accountId)
    expect(v.billing.superSafe).toMatchObject({ tb: 2, price: 5.98 })

    // Jahresabo in USD: Preis folgt dem Intervall (2 TB × 29.90)
    await changePlan(deps, pro, { plan: 'family', interval: 'year', currency: 'USD' })
    v = await accountView(deps, session.accountId)
    expect(v.billing.superSafe).toMatchObject({ tb: 3, unitPrice: 29.9, price: 89.7, interval: 'year' })

    await changePlan(deps, pro, { plan: 'free', interval: 'year', currency: 'USD' })
    v = await accountView(deps, session.accountId)
    expect(v.billing.superSafe.active).toBe(false)
    const ev = await deps.db.query<{ kind: string }>(`SELECT kind FROM audit_events WHERE account_id = $1 AND kind LIKE 'billing.super_safe%' ORDER BY id`, [session.accountId])
    expect(ev.map(e => e.kind)).toEqual(['billing.super_safe_added', 'billing.super_safe_resized', 'billing.super_safe_resized', 'billing.super_safe_cancelled'])
  })

  it('Family-Mitglieder: gesperrt, aber über den Inhaber aktiv; Kündigen und Admin-Freischaltung', async () => {
    const deps = await testDeps()
    const owner = await newAccount(deps, 'owner@example.com')
    const member = await newAccount(deps, 'kind@example.com')
    await changePlan(deps, owner.session, { plan: 'family', interval: 'month', currency: 'CHF' })
    const fam = { ...owner.session, plan: 'family' as const }
    const { token } = await createInvite(deps, fam)
    await joinFamily(deps, member.session, token)
    await expect(buySuperSafe(deps, { ...member.session, plan: 'family' })).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })

    await buySuperSafe(deps, fam)
    const mv = await accountView(deps, member.session.accountId)
    expect(mv.billing.superSafe).toMatchObject({ active: true, inherited: true, available: false })
    expect(mv.billing.monthlyTotal).toBe(0)
    expect((await accountView(deps, owner.session.accountId)).billing.superSafe).toMatchObject({ tb: 2, price: 5.8 })

    await cancelSuperSafe(deps, fam)
    await expect(cancelSuperSafe(deps, fam)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await adminSetSuperSafe(deps, fam, owner.session.accountId, { enabled: true, note: 'Kulanz' })
    expect((await accountView(deps, owner.session.accountId)).billing.superSafe).toMatchObject({ active: true, source: 'admin', price: 0 })
    await adminSetSuperSafe(deps, fam, owner.session.accountId, { enabled: false })
    expect((await accountView(deps, owner.session.accountId)).billing.superSafe.active).toBe(false)
  })
})
