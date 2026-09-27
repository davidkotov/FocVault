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
import {
  adminGrantAddon,
  adminListAccounts,
  adminUpdateAccount,
  buyAddon,
  cancelAddon,
  economicsReport,
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
    expect(v.billing.monthlyChf).toBeCloseTo(13.9 + 5.9, 2)
    const addonId = v.billing.addons[0].id

    await store(deps, pro, 1200 * GB)
    await expect(cancelAddon(deps, pro, addonId)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(buyAddon(deps, pro, 'gibt-es-nicht')).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await adminGrantAddon(deps, pro, session.accountId, { gb: 100, chfPerMonth: 0, note: 'Kulanz' })
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
