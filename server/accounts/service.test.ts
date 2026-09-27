import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { findSession } from '../auth/sessions'
import { META, b64, kdf, newAccount, registerInput, testDeps } from '../testing'
import { registerSchema } from './schemas'
import { changePassphrase, login, prelogin, recoveryLogin, register } from './service'

describe('Konten', () => {
  beforeEach(() => resetRateLimits())

  it('Registrierung: normalisierte E-Mail, Free-Plan, nur Passphrase-Envelope, Session', async () => {
    const deps = await testDeps()
    const { input, result, session } = await newAccount(deps, '  Anna@Example.COM ')
    expect(result.view.email).toBe('anna@example.com')
    expect(result.view.plan).toBe('free')
    expect(result.view.quotaBytes).toBe(5e9)
    expect(result.view.usedBytes).toBe(0)
    expect(result.view.kdf).toEqual(input.kdf)
    expect(result.view.envelopes.map(e => e.kekType)).toEqual(['passphrase'])
    expect(session.accountId).toBe(result.view.id)
  })

  it('doppelte E-Mail wird abgelehnt', async () => {
    const deps = await testDeps()
    await newAccount(deps, 'bob@example.com')
    const again = registerSchema.parse(registerInput('BOB@example.com'))
    await expect(register(deps, again, META)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' })
  })

  it('Login nur mit dem richtigen Auth-Key; unbekannte E-Mail gibt denselben Fehler', async () => {
    const deps = await testDeps()
    const { input } = await newAccount(deps, 'carla@example.com')
    const ok = await login(deps, { email: input.email, authKey: input.authKey }, META)
    expect(ok.view.email).toBe('carla@example.com')
    await expect(login(deps, { email: input.email, authKey: b64(32) }, META)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    })
    await expect(login(deps, { email: 'niemand@example.com', authKey: b64(32) }, META)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    })
  })

  it('Pre-Login verrät nicht, ob ein Konto existiert', async () => {
    const deps = await testDeps()
    const { input } = await newAccount(deps, 'dora@example.com')
    expect((await prelogin(deps, input.email)).kdf).toEqual(input.kdf)
    const a = (await prelogin(deps, 'x@example.com')).kdf
    const b = (await prelogin(deps, 'x@example.com')).kdf
    const c = (await prelogin(deps, 'y@example.com')).kdf
    expect(a).toEqual(b)
    expect(a.salt).not.toBe(c.salt)
    expect(Object.keys(a).sort()).toEqual(Object.keys(input.kdf).sort())
    expect([a.m, a.t, a.p]).toEqual([input.kdf.m, input.kdf.t, input.kdf.p])
  })

  it('Recovery-Login liefert zusätzlich das Recovery-Envelope; Passphrase-Key gilt dort nicht', async () => {
    const deps = await testDeps()
    const { input } = await newAccount(deps, 'emil@example.com')
    const r = await recoveryLogin(deps, { email: input.email, recoveryAuthKey: input.recoveryAuthKey }, META)
    expect(r.view.envelopes.map(e => e.kekType).sort()).toEqual(['passphrase', 'recovery'])
    await expect(
      recoveryLogin(deps, { email: input.email, recoveryAuthKey: input.authKey }, META)
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('Recovery nur mit den 24 Wörtern: Konto über die Kennung; ältere Konten bekommen sie beim Wiederherstellen', async () => {
    const deps = await testDeps()
    const lookup = b64(32)
    const input = registerSchema.parse({ ...registerInput('lookup@example.com'), recoveryLookup: lookup })
    await register(deps, input, META)
    const r = await recoveryLogin(deps, { recoveryLookup: lookup, recoveryAuthKey: input.recoveryAuthKey }, META)
    expect(r.view.email).toBe('lookup@example.com')
    await expect(recoveryLogin(deps, { recoveryLookup: lookup, recoveryAuthKey: input.authKey }, META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(recoveryLogin(deps, { recoveryLookup: b64(32), recoveryAuthKey: input.recoveryAuthKey }, META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    // älteres Konto ohne Kennung: erst per E-Mail, danach auch ohne
    const { input: old } = await newAccount(deps, 'alt@example.com')
    const oldLookup = b64(32)
    await expect(recoveryLogin(deps, { recoveryLookup: oldLookup, recoveryAuthKey: old.recoveryAuthKey }, META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await recoveryLogin(deps, { email: old.email, recoveryLookup: oldLookup, recoveryAuthKey: old.recoveryAuthKey }, META)
    expect((await recoveryLogin(deps, { recoveryLookup: oldLookup, recoveryAuthKey: old.recoveryAuthKey }, META)).view.email).toBe('alt@example.com')
    // der Server speichert nur den HMAC, nicht die Kennung
    const rows = await deps.db.query<{ recovery_lookup: Uint8Array }>('SELECT recovery_lookup FROM accounts WHERE email = $1', ['alt@example.com'])
    expect(Buffer.from(rows[0].recovery_lookup).toString('base64url')).not.toBe(oldLookup)
  })

  it('Passphrase-Wechsel: nur mit frischer Anmeldung, meldet andere Geräte ab', async () => {
    const deps = await testDeps()
    const { input, result, session } = await newAccount(deps, 'fritz@example.com')
    const other = await login(deps, { email: input.email, authKey: input.authKey }, META)
    const envelope = { kekType: 'passphrase' as const, iv: b64(12), cipher: b64(48) }
    const newKey = b64(32)

    await expect(
      changePassphrase(deps, { ...session, strongAuthAt: Date.now() - 60 * 60_000 }, { authKey: newKey, kdf: kdf(), envelope })
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })

    const view = await changePassphrase(deps, session, { authKey: newKey, kdf: kdf(), envelope })
    expect(view.envelopes).toEqual([envelope])
    expect(await findSession(deps.db, other.token)).toBeNull()
    expect(await findSession(deps.db, result.token)).not.toBeNull()
    await expect(login(deps, { email: input.email, authKey: input.authKey }, META)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS'
    })
    expect((await login(deps, { email: input.email, authKey: newKey }, META)).view.id).toBe(view.id)
  })

  it('Rate-Limit greift nach 10 Fehlversuchen pro E-Mail', async () => {
    const deps = await testDeps()
    const { input } = await newAccount(deps, 'gina@example.com')
    for (let i = 0; i < 10; i++) {
      await expect(login(deps, { email: input.email, authKey: b64(32) }, META)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS'
      })
    }
    await expect(login(deps, { email: input.email, authKey: input.authKey }, META)).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    })
  })
})
