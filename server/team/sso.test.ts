import { generateKeyPairSync, sign } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { findSession } from '../auth/sessions'
import { changePlan } from '../billing/service'
import { changePassphrase, login, reauthWithPassphrase } from '../accounts/service'
import { passphraseSchema } from '../accounts/schemas'
import { joinFamily } from '../family/service'
import type { SafeResponse } from '../net/safe-fetch'
import { safeFetch } from '../net/safe-fetch'
import { b64, kdf, META, newAccount, testDeps } from '../testing'
import { finishSso, getSsoConfig, setSsoConfig, ssoConfigSchema, startSso, verifySsoDomain } from './sso'

const ISSUER = 'https://idp.example.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

function idToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = enc({ iss: ISSUER, aud: 'focvault-client', exp: Math.floor(Date.now() / 1000) + 300, sub: 'u1', email_verified: true, ...claims })
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
}

const res = (status: number, data: unknown): SafeResponse => {
  const body = Buffer.from(JSON.stringify(data))
  return { status, ok: status >= 200 && status < 300, headers: {}, body, json: <T>() => JSON.parse(body.toString()) as T }
}

const cfg = (domains: string[]) => ({ issuer: ISSUER, clientId: 'focvault-client', clientSecret: 'geheim', domains, enforce: true, autoJoin: true })

/** Enterprise-Team mit SSO (acme.ch), Identity-Provider und DNS als Attrappen. */
async function setup() {
  const deps = await testDeps()
  const idp = { email: '', nonce: '', claims: {} as Record<string, unknown> }
  const txt = new Map<string, string[][]>()
  deps.net = {
    fetch: async (url, init) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`)
        return res(200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` })
      if (url === `${ISSUER}/jwks`) return res(200, { keys: [pubJwk] })
      if (url === `${ISSUER}/token`) {
        const b = new URLSearchParams(init?.body)
        expect(init?.method).toBe('POST')
        expect(b.get('client_secret')).toBe('geheim')
        expect(b.get('code_verifier')).toBeTruthy()
        return res(200, { id_token: idToken({ email: idp.email, nonce: idp.nonce, ...idp.claims }) })
      }
      return res(404, {})
    },
    resolveTxt: async name => {
      const r = txt.get(name)
      if (!r) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
      return r
    }
  }
  const owner = await newAccount(deps, 'ceo@acme.ch')
  await changePlan(deps, owner.session, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' })
  await deps.db.query(`UPDATE accounts SET business_tier = 'enterprise', seats = 10 WHERE id = $1`, [owner.session.accountId])

  /** Kompletter SSO-Ablauf im selben Browser (Cookie-Wert = browserToken). */
  const sso = async (email: string, opts: { browser?: string | null; claims?: Record<string, unknown> } = {}) => {
    const { url, browserToken } = await startSso(deps, email, 'http://localhost:3000', '1.1.1.1')
    const auth = new URL(url)
    idp.email = email
    idp.nonce = auth.searchParams.get('nonce')!
    idp.claims = opts.claims ?? {}
    const browser = opts.browser === undefined ? browserToken : opts.browser
    return { auth, browserToken, result: () => finishSso(deps, 'code123', auth.searchParams.get('state')!, browser, META) }
  }
  const verify = async (session = owner.session, domain = 'acme.ch') => {
    const c = await getSsoConfig(deps, session)
    const d = c!.domainStatus.find(x => x.domain === domain)!
    txt.set(d.txtName, [[d.txtValue.slice(0, 10), d.txtValue.slice(10)]])
    return verifySsoDomain(deps, session, domain)
  }
  return { deps, owner, sso, verify, txt }
}

describe('Firmen-SSO (OIDC)', () => {
  beforeEach(() => resetRateLimits())

  it('nur Enterprise und nur Inhaber; Domain erst nach DNS-TXT-Nachweis wirksam; verifizierte Domain gehört einem Team', async () => {
    const { deps, owner, sso, verify, txt } = await setup()
    // HTTP-Issuer / private Hosts werden schon im Formular abgewiesen
    expect(ssoConfigSchema.safeParse({ ...cfg(['acme.ch']), issuer: 'http://idp.example.com' }).success).toBe(false)
    expect(ssoConfigSchema.safeParse({ ...cfg(['acme.ch']), issuer: 'https://localhost:8443' }).success).toBe(false)

    await setSsoConfig(deps, owner.session, cfg(['acme.ch']))
    const c = (await getSsoConfig(deps, owner.session))!
    expect(c.domainStatus).toEqual([expect.objectContaining({ domain: 'acme.ch', verified: false, txtName: '_focvault.acme.ch' })])
    expect(c.domainStatus[0].txtValue).toMatch(/^focvault-verify=[0-9a-f]{32}$/)

    // unverifiziert: kein SSO, keine Erzwingung
    await expect(sso('dev@acme.ch')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // falscher TXT-Eintrag
    txt.set('_focvault.acme.ch', [['focvault-verify=falsch']])
    await expect(verifySsoDomain(deps, owner.session, 'acme.ch')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Team B beansprucht acme.ch (noch unverifiziert) – blockiert Team A nicht
    const b = await newAccount(deps, 'boss@other.ch')
    await changePlan(deps, b.session, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' })
    await deps.db.query(`UPDATE accounts SET business_tier = 'enterprise' WHERE id = $1`, [b.session.accountId])
    await setSsoConfig(deps, b.session, cfg(['acme.ch', 'other.ch']))

    expect((await verify()).domainStatus[0].verified).toBe(true)
    await expect(sso('dev@acme.ch')).resolves.toBeTruthy()
    // Team B kann die verifizierte Domain weder verifizieren noch neu eintragen
    await expect(verify(b.session, 'acme.ch')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(setSsoConfig(deps, b.session, cfg(['acme.ch']))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Login-Hinweis für acme.ch führt weiterhin zu Team A
    const r = await sso('x@acme.ch')
    expect(r.auth.searchParams.get('client_id')).toBe('focvault-client')

    // Admins dürfen SSO nicht ändern
    const admin = await newAccount(deps, 'admin@acme.ch')
    await deps.db.query('INSERT INTO families (owner_account_id) VALUES ($1) ON CONFLICT DO NOTHING', [owner.session.accountId])
    await deps.db.query('INSERT INTO family_members (account_id, owner_account_id, role) VALUES ($1, $2, $3)', [admin.session.accountId, owner.session.accountId, 'admin'])
    await deps.db.query(`UPDATE accounts SET plan = 'business' WHERE id = $1`, [admin.session.accountId])
    await expect(getSsoConfig(deps, admin.session)).resolves.toBeTruthy()
    await expect(setSsoConfig(deps, admin.session, { ...cfg(['acme.ch']), issuer: 'https://evil.example.com' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(verifySsoDomain(deps, admin.session, 'acme.ch')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Session nur für Team-Mitglieder (nicht stark), nie für den Inhaber; fremde Konten treten erst mit eigener Passphrase bei', async () => {
    const { deps, owner, sso, verify } = await setup()
    await setSsoConfig(deps, owner.session, cfg(['acme.ch']))
    await verify()
    const dev = await newAccount(deps, 'dev@acme.ch')

    // bestehendes Konto außerhalb des Teams → keine Session, Einladung über die normale Anmeldung
    const r1 = await (await sso('dev@acme.ch')).result()
    expect(r1.session).toBeUndefined()
    expect(r1.redirect).toMatch(/^\/anmelden\?join=[A-Za-z0-9_-]{32}$/)
    await joinFamily(deps, dev.session, r1.redirect.split('join=')[1])

    // Mitglied → Session, aber keine starke Anmeldung
    const r2 = await (await sso('dev@acme.ch')).result()
    expect(r2.redirect).toBe('/app')
    const s = (await findSession(deps.db, r2.session!.token))!
    expect(s.strongAuthAt).toBeLessThan(Date.now() - 86_400_000)
    const change = passphraseSchema.parse({ authKey: b64(32), kdf: kdf(), envelope: { kekType: 'passphrase', iv: b64(12), cipher: b64(48) } })
    await expect(changePassphrase(deps, s, change)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    // mit der eigenen Passphrase bestätigen → danach erlaubt
    await expect(reauthWithPassphrase(deps, s, b64(32), META)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await reauthWithPassphrase(deps, s, dev.input.authKey, META)
    await expect(changePassphrase(deps, (await findSession(deps.db, r2.session!.token))!, change)).resolves.toBeTruthy()

    // Inhaber: nie per SSO
    await expect((await sso('ceo@acme.ch')).result()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const ownerSessions = await deps.db.query('SELECT 1 FROM sessions WHERE account_id = $1', [owner.session.accountId])
    expect(ownerSessions.length).toBe(1)

    // neues Konto → Registrierung mit Einladung
    const r3 = await (await sso('neu@acme.ch')).result()
    expect(r3.session).toBeUndefined()
    expect(r3.redirect).toMatch(/^\/app\?join=[A-Za-z0-9_-]{32}$/)

    // fehlender Aussteller → sauberer ApiError
    await expect((await sso('dev@acme.ch', { claims: { iss: undefined } })).result()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'ID-Token ohne Aussteller.' })
    // falsche Nonce / fremde Domain im Token
    const bad = await sso('dev@acme.ch', { claims: { nonce: 'falsch' } })
    await expect(bad.result()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect((await sso('dev@acme.ch', { claims: { email: 'eve@evil.ch' } })).result()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('State ist an den Browser gebunden (Login-CSRF) und nur einmal verwendbar', async () => {
    const { deps, owner, sso, verify } = await setup()
    await setSsoConfig(deps, owner.session, cfg(['acme.ch']))
    await verify()
    await newAccount(deps, 'dev@acme.ch')
    const f = await sso('dev@acme.ch')
    const state = f.auth.searchParams.get('state')!
    await expect(finishSso(deps, 'c', state, null, META)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(finishSso(deps, 'c', state, b64(32), META)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    // der fremde Versuch verbraucht den State nicht; der echte Browser kommt durch
    await expect(finishSso(deps, 'c', state, f.browserToken, META)).resolves.toBeTruthy()
    await expect(finishSso(deps, 'c', state, f.browserToken, META)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('Erzwingen trifft nur Team-Mitglieder; Auto-Beitritt und Beitritt respektieren die Plätze', async () => {
    const { deps, owner, sso, verify } = await setup()
    await setSsoConfig(deps, owner.session, cfg(['acme.ch']))
    await verify()
    const dev = await newAccount(deps, 'dev@acme.ch')
    const other = await newAccount(deps, 'other@acme.ch')
    const third = await newAccount(deps, 'third@acme.ch')
    await deps.db.query('UPDATE accounts SET seats = 3 WHERE id = $1', [owner.session.accountId])

    const t1 = (await (await sso('dev@acme.ch')).result()).redirect.split('join=')[1]
    await joinFamily(deps, dev.session, t1)

    // Mitglied: Passphrase-Login gesperrt; Nicht-Mitglied mit gleicher Domain und Inhaber: erlaubt
    await expect(login(deps, { email: dev.input.email, authKey: dev.input.authKey }, META)).rejects.toMatchObject({ code: 'SSO_REQUIRED' })
    await expect(login(deps, { email: other.input.email, authKey: other.input.authKey }, META)).resolves.toBeTruthy()
    await expect(login(deps, { email: owner.input.email, authKey: owner.input.authKey }, META)).resolves.toBeTruthy()

    // 3 Plätze = Inhaber + 2: zwei Einladungen entstehen, aber nur ein weiterer Beitritt gelingt
    const t2 = (await (await sso('other@acme.ch')).result()).redirect.split('join=')[1]
    const t3 = (await (await sso('third@acme.ch')).result()).redirect.split('join=')[1]
    await joinFamily(deps, other.session, t2)
    await expect(joinFamily(deps, third.session, t3)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Team voll → kein weiterer Auto-Beitritt
    await expect((await sso('third@acme.ch')).result()).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect((await sso('neu@acme.ch')).result()).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('SSRF-Schutz: nur öffentliche HTTPS-Adressen', async () => {
    for (const u of ['http://idp.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://idp.internal/x', 'https://idp.example.com:8443/x', 'file:///etc/passwd'])
      await expect(safeFetch(u)).rejects.toThrow('invalid url')
  })
})
