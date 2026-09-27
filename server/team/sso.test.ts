import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { login } from '../accounts/service'
import { META, newAccount, testDeps } from '../testing'
import { finishSso, setSsoConfig, startSso } from './sso'

const ISSUER = 'https://idp.example.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

function idToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = enc({ iss: ISSUER, aud: 'focvault-client', exp: Math.floor(Date.now() / 1000) + 300, sub: 'u1', email_verified: true, ...claims })
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
}

describe('Firmen-SSO (OIDC)', () => {
  beforeEach(() => resetRateLimits())
  afterEach(() => vi.unstubAllGlobals())

  it('nur Enterprise; Start → Callback mit geprüftem ID-Token → Session; Erzwingen sperrt Passphrase-Login (außer Inhaber)', async () => {
    const deps = await testDeps()
    const { session: ceo, input: ceoIn } = await newAccount(deps, 'ceo@acme.ch')
    const { input: devIn } = await newAccount(deps, 'dev@acme.ch')
    await changePlan(deps, ceo, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' })
    const cfg = { issuer: ISSUER, clientId: 'focvault-client', clientSecret: 'geheim', domains: ['acme.ch'], enforce: true, autoJoin: true }
    await expect(setSsoConfig(deps, ceo, cfg)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await deps.db.query(`UPDATE accounts SET business_tier = 'enterprise' WHERE id = $1`, [ceo.accountId])
    await setSsoConfig(deps, ceo, cfg)

    let nonce = ''
    let tokenEmail = 'dev@acme.ch'
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/.well-known/openid-configuration'))
        return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` })
      if (u === `${ISSUER}/jwks`) return Response.json({ keys: [pubJwk] })
      if (u === `${ISSUER}/token`) {
        const b = new URLSearchParams(String(init?.body))
        expect(b.get('client_secret')).toBe('geheim')
        expect(b.get('code_verifier')).toBeTruthy()
        return Response.json({ id_token: idToken({ email: tokenEmail, nonce }) })
      }
      return new Response('nope', { status: 404 })
    })

    await expect(startSso(deps, 'x@other.ch', 'http://localhost:3000', '1.1.1.1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const auth = new URL(await startSso(deps, 'dev@acme.ch', 'http://localhost:3000', '1.1.1.1'))
    expect(auth.origin + auth.pathname).toBe(`${ISSUER}/auth`)
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    nonce = auth.searchParams.get('nonce')!
    const r = await finishSso(deps, 'code123', auth.searchParams.get('state')!, META)
    // Konto existiert, ist aber nicht im Team → Session + automatischer Beitritt über Einladung
    expect(r.session?.token).toBeTruthy()
    expect(r.redirect).toMatch(/^\/app\?join=[A-Za-z0-9_-]{32}$/)
    // State ist verbraucht
    await expect(finishSso(deps, 'code123', auth.searchParams.get('state')!, META)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    // falsche Nonce / fremde Domain im Token werden abgelehnt
    const a2 = new URL(await startSso(deps, 'dev@acme.ch', 'http://localhost:3000', '1.1.1.1'))
    nonce = 'falsch'
    await expect(finishSso(deps, 'c', a2.searchParams.get('state')!, META)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    const a3 = new URL(await startSso(deps, 'dev@acme.ch', 'http://localhost:3000', '1.1.1.1'))
    nonce = a3.searchParams.get('nonce')!
    tokenEmail = 'eve@evil.ch'
    await expect(finishSso(deps, 'c', a3.searchParams.get('state')!, META)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // SSO erzwungen: Passphrase-Login für die Domain gesperrt, Inhaber bleibt als Notfall-Zugang
    await expect(login(deps, { email: devIn.email, authKey: devIn.authKey }, META)).rejects.toMatchObject({ code: 'SSO_REQUIRED' })
    await expect(login(deps, { email: ceoIn.email, authKey: ceoIn.authKey }, META)).resolves.toBeTruthy()
  })
})
