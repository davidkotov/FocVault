import { describe, expect, it } from 'vitest'
import { newAccount, testDeps } from '../testing'
import { addCredit, consumeCredit, creditBalance, creditHistory } from './service'

describe('Guthaben', () => {
  it('Einzahlung idempotent, Verbrauch höchstens bis zum Guthaben, gleiche Referenz nie doppelt', async () => {
    const deps = await testDeps()
    const { session } = await newAccount(deps, 'credit@example.com')
    const id = session.accountId
    expect(await addCredit(deps.db, { accountId: id, amount: 25, currency: 'CHF', kind: 'deposit', source: 'stripe', ref: 'stripe:cs_1' })).toBe(true)
    expect(await addCredit(deps.db, { accountId: id, amount: 25, currency: 'CHF', kind: 'deposit', source: 'stripe', ref: 'stripe:cs_1' })).toBe(false)
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(25)
    expect(await consumeCredit(deps.db, id, 10.5, 'CHF', 'payg:x:2026-09', 'PAYG')).toBe(10.5)
    expect(await consumeCredit(deps.db, id, 10.5, 'CHF', 'payg:x:2026-09', 'PAYG')).toBe(10.5)
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(14.5)
    expect(await consumeCredit(deps.db, id, 50, 'CHF', 'payg:x:2026-10', 'PAYG')).toBe(14.5)
    expect(await creditBalance(deps.db, id, 'CHF')).toBe(0)
    expect(await consumeCredit(deps.db, id, 5, 'CHF', 'payg:x:2026-11', 'PAYG')).toBe(0)
    expect(await creditBalance(deps.db, id, 'EUR')).toBe(0)
    expect((await creditHistory(deps.db, id)).map(e => e.kind)).toEqual(['charge', 'charge', 'deposit'])
  })
})
