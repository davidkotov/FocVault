import { createHash, createPublicKey, randomBytes, verify as verifySig, type JsonWebKey as NodeJwk } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { z } from 'zod'
import { isUniqueViolation, type Db } from '../db'
import { audit, type Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { createSession } from '../auth/sessions'
import { ipLimit, rateLimit } from '../auth/ratelimit'
import { assertFreeSeat } from '../family/service'
import { isSafeUrl, safeFetch, type SafeFetchInit, type SafeResponse } from '../net/safe-fetch'
import { ApiError } from '../shared/errors'
import { uuidv7 } from '../shared/ids'
import { openSecret, sealSecret } from '../foc/config'
import { teamContext } from './service'

/**
 * SSO für Enterprise (OpenID Connect, Authorization Code + PKCE), z. B. Google Workspace oder
 * Microsoft Entra ID. SSO ersetzt nur die **Anmeldung** – entschlüsselt wird weiterhin im Browser
 * mit der Passphrase (bzw. Passkey). Der Identity-Provider sieht also nie Schlüssel oder Inhalte.
 *
 * Sicherheitsregeln:
 * - Nur der Inhaber richtet SSO ein (Issuer, Domains). Der Inhaber selbst meldet sich nie per SSO an.
 * - Domains wirken erst nach DNS-TXT-Nachweis (`_focvault.<domain>` = `focvault-verify=<token>`);
 *   eine verifizierte Domain gehört genau einem Team.
 * - Eine SSO-Session gibt es nur für Konten, die schon Mitglied des Teams sind. Sie gilt nicht als
 *   starke Anmeldung – sensible Aktionen verlangen zusätzlich die Passphrase.
 * - Bestehende Konten außerhalb des Teams treten (bei automatischem Beitritt) erst nach Anmeldung mit
 *   ihrer eigenen Passphrase bei.
 * - `state` ist per HttpOnly-Cookie an den Browser gebunden (Login-CSRF).
 * - Discovery, JWKS und Token-Endpunkt nur über den SSRF-geschützten Abruf (HTTPS, öffentliche Hosts).
 *
 * Optionen: SSO erzwingen (Passphrase-Anmeldung für Team-Mitglieder der Domains gesperrt; der Inhaber
 * bleibt als Notfall-Zugang ausgenommen) und automatischer Beitritt zum Team beim ersten SSO-Login.
 */
const httpsUrl = z
  .string()
  .url()
  .refine(u => URL.canParse(u) && isSafeUrl(new URL(u)), 'Öffentliche HTTPS-Adresse erwartet')
const domainSchema = z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Ungültige Domain')
export const ssoConfigSchema = z.object({
  issuer: httpsUrl.transform(u => u.replace(/\/$/, '')),
  clientId: z.string().trim().min(1).max(300),
  /** leer lassen = unverändert */
  clientSecret: z.string().max(500).optional(),
  domains: z.array(domainSchema).min(1).max(20),
  enforce: z.boolean(),
  autoJoin: z.boolean()
})
export const ssoDomainSchema = z.object({ domain: domainSchema })

/** Cookie, das den SSO-Ablauf an den Browser bindet (Login-CSRF) */
export const SSO_COOKIE = 'fv_sso'
const TXT_PREFIX = 'focvault-verify='

export interface SsoDomainView {
  domain: string
  verified: boolean
  verifiedAt: string | null
  /** DNS-Eintrag zum Nachweis */
  txtName: string
  txtValue: string
}

export interface SsoConfigView {
  issuer: string
  clientId: string
  hasSecret: boolean
  domains: string[]
  domainStatus: SsoDomainView[]
  enforce: boolean
  autoJoin: boolean
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

const discoveryCache = new Map<string, { at: number; d: Discovery }>()
const jwksCache = new Map<string, { at: number; keys: Array<NodeJwk & { kid?: string; alg?: string }> }>()
const CACHE_MS = 60 * 60_000

/** Abruf beim SSO-Anbieter (SSRF-geschützt, in Tests über deps.net.fetch ersetzbar). */
async function idpFetch(deps: Deps, url: string, init: SafeFetchInit, fail: ApiError): Promise<SafeResponse> {
  if (!URL.canParse(url) || !isSafeUrl(new URL(url))) throw fail
  try {
    return await (deps.net?.fetch ?? safeFetch)(url, { timeoutMs: 5000, maxBytes: 256 * 1024, ...init })
  } catch {
    throw fail
  }
}

function jsonOf<T>(r: SafeResponse, fail: ApiError): T {
  try {
    return r.json<T>()
  } catch {
    throw fail
  }
}

const trimSlash = (u: string) => u.replace(/\/$/, '')

async function discover(deps: Deps, issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.d
  const unreachable = new ApiError('BAD_REQUEST', 'SSO-Anbieter nicht erreichbar (Discovery).')
  const invalid = new ApiError('BAD_REQUEST', 'Ungültige SSO-Konfiguration des Anbieters.')
  const r = await idpFetch(deps, `${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } }, unreachable)
  if (!r.ok) throw unreachable
  const d = jsonOf<Partial<Discovery>>(r, invalid)
  const https = (u: unknown): u is string => typeof u === 'string' && URL.canParse(u) && isSafeUrl(new URL(u))
  if (!d || typeof d.issuer !== 'string' || !https(d.authorization_endpoint) || !https(d.token_endpoint) || !https(d.jwks_uri)) throw invalid
  if (trimSlash(d.issuer) !== trimSlash(issuer)) throw invalid
  const out = d as Discovery
  discoveryCache.set(issuer, { at: Date.now(), d: out })
  return out
}

async function jwks(deps: Deps, uri: string, force = false) {
  const hit = jwksCache.get(uri)
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.keys
  const fail = new ApiError('BAD_REQUEST', 'Schlüssel des SSO-Anbieters nicht abrufbar.')
  const r = await idpFetch(deps, uri, { headers: { accept: 'application/json' } }, fail)
  if (!r.ok) throw fail
  const body = jsonOf<{ keys?: unknown }>(r, fail)
  const keys = Array.isArray(body?.keys) ? (body.keys as Array<NodeJwk & { kid?: string }>) : []
  jwksCache.set(uri, { at: Date.now(), keys })
  return keys
}

const b64u = (s: string) => Buffer.from(s, 'base64url')

function tokenPart<T>(s: string): T {
  try {
    const v = JSON.parse(b64u(s).toString()) as unknown
    if (!v || typeof v !== 'object') throw new Error('kein Objekt')
    return v as T
  } catch {
    throw new ApiError('UNAUTHENTICATED', 'Ungültiges ID-Token.')
  }
}

/** ID-Token prüfen: Signatur (RS256/ES256), Aussteller, Empfänger, Ablauf, Nonce. */
export async function verifyIdToken(
  deps: Deps,
  token: string,
  d: Discovery,
  clientId: string,
  nonce: string
): Promise<{ email: string; sub: string }> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new ApiError('UNAUTHENTICATED', 'Ungültiges ID-Token.')
  const header = tokenPart<{ alg?: string; kid?: string }>(parts[0])
  if (header.alg !== 'RS256' && header.alg !== 'ES256') throw new ApiError('UNAUTHENTICATED', 'Nicht unterstützter Signaturalgorithmus.')
  let keys = await jwks(deps, d.jwks_uri)
  let jwk = keys.find(k => !header.kid || k.kid === header.kid)
  if (!jwk) {
    keys = await jwks(deps, d.jwks_uri, true)
    jwk = keys.find(k => !header.kid || k.kid === header.kid)
  }
  if (!jwk) throw new ApiError('UNAUTHENTICATED', 'Unbekannter Signaturschlüssel.')
  const data = Buffer.from(`${parts[0]}.${parts[1]}`)
  let ok = false
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' })
    ok =
      header.alg === 'RS256'
        ? verifySig('sha256', data, key, b64u(parts[2]))
        : verifySig('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, b64u(parts[2]))
  } catch {
    ok = false
  }
  if (!ok) throw new ApiError('UNAUTHENTICATED', 'Signatur des ID-Tokens ungültig.')
  const c = tokenPart<{ iss?: unknown; aud?: unknown; exp?: unknown; nonce?: unknown; email?: unknown; email_verified?: boolean | string; sub?: unknown }>(parts[1])
  if (typeof c.iss !== 'string' || !c.iss) throw new ApiError('UNAUTHENTICATED', 'ID-Token ohne Aussteller.')
  if (trimSlash(c.iss) !== trimSlash(d.issuer)) throw new ApiError('UNAUTHENTICATED', 'Falscher Aussteller.')
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(clientId)) throw new ApiError('UNAUTHENTICATED', 'Token nicht für FocVault ausgestellt.')
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 60_000) throw new ApiError('UNAUTHENTICATED', 'ID-Token abgelaufen.')
  if (typeof c.nonce !== 'string' || c.nonce !== nonce) throw new ApiError('UNAUTHENTICATED', 'Ungültige Nonce.')
  if (typeof c.sub !== 'string' || !c.sub) throw new ApiError('UNAUTHENTICATED', 'ID-Token ohne Kennung (sub).')
  if (typeof c.email !== 'string' || !c.email.includes('@') || c.email_verified === false || c.email_verified === 'false')
    throw new ApiError('UNAUTHENTICATED', 'Keine bestätigte E-Mail-Adresse vom SSO-Anbieter.')
  return { email: c.email.toLowerCase(), sub: c.sub }
}

async function requireEnterpriseAdmin(db: Db, accountId: string) {
  const t = await teamContext(db, accountId)
  if (!t) throw new ApiError('PLAN_REQUIRED', 'SSO gibt es mit Business Enterprise.')
  if (t.role === 'member') throw new ApiError('FORBIDDEN', 'Nur Inhaber und Admins dürfen das.')
  if (t.tier !== 'enterprise') throw new ApiError('PLAN_REQUIRED', 'SSO gibt es ab Business Enterprise.')
  return t
}

/** SSO ändern darf nur der Inhaber (Admins könnten sonst per eigenem Issuer als andere Personen anmelden). */
async function requireEnterpriseOwner(db: Db, accountId: string) {
  const t = await requireEnterpriseAdmin(db, accountId)
  if (t.role !== 'owner') throw new ApiError('FORBIDDEN', 'SSO kann nur der Inhaber des Teams einrichten oder ändern.')
  return t
}

async function domainStatus(db: Db, owner: string): Promise<SsoDomainView[]> {
  const r = await db.query<{ domain: string; token: string; verified_at: Date | null }>(
    'SELECT domain, token, verified_at FROM team_sso_domains WHERE owner_account_id = $1 ORDER BY domain',
    [owner]
  )
  return r.map(x => ({
    domain: x.domain,
    verified: !!x.verified_at,
    verifiedAt: x.verified_at ? new Date(x.verified_at).toISOString() : null,
    txtName: `_focvault.${x.domain}`,
    txtValue: `${TXT_PREFIX}${x.token}`
  }))
}

export async function getSsoConfig(deps: Deps, session: SessionInfo): Promise<SsoConfigView | null> {
  const t = await requireEnterpriseAdmin(deps.db, session.accountId)
  const r = await deps.db.query<{ issuer: string; client_id: string; client_secret: Uint8Array | null; enforce: boolean; auto_join: boolean }>(
    'SELECT issuer, client_id, client_secret, enforce, auto_join FROM team_sso WHERE owner_account_id = $1',
    [t.owner]
  )
  const c = r[0]
  if (!c) return null
  const status = await domainStatus(deps.db, t.owner)
  return {
    issuer: c.issuer,
    clientId: c.client_id,
    hasSecret: !!c.client_secret,
    domains: status.map(d => d.domain),
    domainStatus: status,
    enforce: c.enforce,
    autoJoin: c.auto_join
  }
}

export async function setSsoConfig(deps: Deps, session: SessionInfo, input: z.output<typeof ssoConfigSchema>): Promise<SsoConfigView> {
  const t = await requireEnterpriseOwner(deps.db, session.accountId)
  const domains = [...new Set(input.domains)]
  // Nur verifizierte Domains sind vergeben – unverifizierte Einträge anderer Teams blockieren nichts
  const taken = await deps.db.query<{ domain: string }>(
    'SELECT domain FROM team_sso_domains WHERE domain = ANY($1::text[]) AND verified_at IS NOT NULL AND owner_account_id <> $2',
    [domains, t.owner]
  )
  if (taken.length) throw new ApiError('BAD_REQUEST', `Die Domain ${taken[0].domain} ist bereits von einem anderen Team verifiziert.`)
  const secret = input.clientSecret ? Buffer.from(sealSecret(input.clientSecret)) : null
  await deps.db.tx(async tx => {
    await tx.query(
      `INSERT INTO team_sso (owner_account_id, issuer, client_id, client_secret, domains, enforce, auto_join) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_account_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
         client_secret = COALESCE(EXCLUDED.client_secret, team_sso.client_secret), domains = EXCLUDED.domains,
         enforce = EXCLUDED.enforce, auto_join = EXCLUDED.auto_join, updated_at = now()`,
      [t.owner, input.issuer, input.clientId, secret, domains, input.enforce, input.autoJoin]
    )
    await tx.query('DELETE FROM team_sso_domains WHERE owner_account_id = $1 AND NOT (domain = ANY($2::text[]))', [t.owner, domains])
    for (const d of domains) {
      await tx.query('INSERT INTO team_sso_domains (owner_account_id, domain, token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        t.owner,
        d,
        randomBytes(16).toString('hex')
      ])
    }
  })
  await audit(deps.db, session.accountId, 'user', 'team.sso_configured', { team: t.owner, domains, enforce: input.enforce, autoJoin: input.autoJoin })
  return (await getSsoConfig(deps, session))!
}

/** Domain per DNS-TXT-Eintrag nachweisen: `_focvault.<domain>` muss `focvault-verify=<token>` enthalten. */
export async function verifySsoDomain(deps: Deps, session: SessionInfo, domain: string): Promise<SsoConfigView> {
  const t = await requireEnterpriseOwner(deps.db, session.accountId)
  rateLimit(`sso:verify:${t.owner}`, 30, 15 * 60_000)
  const r = await deps.db.query<{ token: string; verified_at: Date | null }>(
    'SELECT token, verified_at FROM team_sso_domains WHERE owner_account_id = $1 AND domain = $2',
    [t.owner, domain]
  )
  if (!r[0]) throw new ApiError('NOT_FOUND', 'Diese Domain ist für euer SSO nicht eingetragen.')
  if (!r[0].verified_at) {
    let records: string[][] = []
    try {
      records = await (deps.net?.resolveTxt ?? resolveTxt)(`_focvault.${domain}`)
    } catch {
      records = []
    }
    const expected = `${TXT_PREFIX}${r[0].token}`
    if (!records.some(rec => rec.join('').trim() === expected)) {
      throw new ApiError('BAD_REQUEST', `TXT-Eintrag nicht gefunden. Bitte bei _focvault.${domain} den Wert ${expected} eintragen (DNS-Änderungen brauchen teils einige Minuten).`)
    }
    const taken = new ApiError('BAD_REQUEST', `Die Domain ${domain} ist bereits von einem anderen Team verifiziert.`)
    try {
      const other = await deps.db.query(
        'SELECT 1 FROM team_sso_domains WHERE domain = $1 AND verified_at IS NOT NULL AND owner_account_id <> $2',
        [domain, t.owner]
      )
      if (other.length) throw taken
      await deps.db.query('UPDATE team_sso_domains SET verified_at = now() WHERE owner_account_id = $1 AND domain = $2', [t.owner, domain])
    } catch (e) {
      if (isUniqueViolation(e)) throw taken
      throw e
    }
    await audit(deps.db, session.accountId, 'user', 'team.sso_domain_verified', { team: t.owner, domain })
  }
  return (await getSsoConfig(deps, session))!
}

export async function deleteSsoConfig(deps: Deps, session: SessionInfo): Promise<void> {
  const t = await requireEnterpriseOwner(deps.db, session.accountId)
  await deps.db.query('DELETE FROM team_sso WHERE owner_account_id = $1', [t.owner])
  await deps.db.query('DELETE FROM team_sso_domains WHERE owner_account_id = $1', [t.owner])
  await audit(deps.db, session.accountId, 'user', 'team.sso_removed', { team: t.owner })
}

interface SsoRow {
  owner_account_id: string
  issuer: string
  client_id: string
  client_secret: Uint8Array | null
  enforce: boolean
  auto_join: boolean
}

const SSO_COLS = 's.owner_account_id, s.issuer, s.client_id, s.client_secret, s.enforce, s.auto_join'

/** SSO-Konfiguration zur E-Mail – nur über verifizierte Domains eines aktiven Enterprise-Teams. */
async function configForEmail(db: Db, email: string): Promise<SsoRow | null> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null
  return configFor(db, 'd.domain = $1', [domain])
}

async function configFor(db: Db, where: string, params: unknown[]): Promise<SsoRow | null> {
  const r = await db.query<SsoRow>(
    `SELECT ${SSO_COLS} FROM team_sso s
       JOIN accounts o ON o.id = s.owner_account_id
       JOIN team_sso_domains d ON d.owner_account_id = s.owner_account_id AND d.verified_at IS NOT NULL
      WHERE ${where} AND o.plan = 'business' AND o.business_tier = 'enterprise'
      LIMIT 1`,
    params
  )
  return r[0] ?? null
}

/**
 * Passphrase-Anmeldung gesperrt? Nur für Mitglieder des Teams mit verifizierter Domain; der Inhaber ist
 * als Notfall-Zugang ausgenommen, fremde Konten mit gleicher Domain bleiben unberührt.
 */
export async function ssoEnforcedFor(db: Db, email: string, accountId?: string): Promise<boolean> {
  if (!accountId) return false
  const c = await configForEmail(db, email)
  if (!c?.enforce || c.owner_account_id === accountId) return false
  return (await teamContext(db, accountId))?.owner === c.owner_account_id
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/**
 * Anmeldung starten: liefert die Weiterleitung zum Identity-Provider und einen Zufallswert, den die Route
 * als HttpOnly-Cookie setzt (bindet `state` an diesen Browser).
 */
export async function startSso(deps: Deps, email: string, origin: string, ip: string): Promise<{ url: string; browserToken: string }> {
  rateLimit(`sso:ip:${ip}`, ipLimit(30), 15 * 60_000)
  const c = await configForEmail(deps.db, email.trim().toLowerCase())
  if (!c) throw new ApiError('NOT_FOUND', 'Für diese E-Mail-Domain ist kein Firmen-SSO eingerichtet.')
  const d = await discover(deps, c.issuer)
  const state = randomBytes(24).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const nonce = randomBytes(16).toString('base64url')
  const browserToken = randomBytes(32).toString('base64url')
  const redirect = `${origin}/api/v1/auth/sso/callback`
  await deps.db.query('DELETE FROM sso_states WHERE expires_at < now()')
  await deps.db.query(
    `INSERT INTO sso_states (state, owner_account_id, verifier, nonce, redirect_uri, browser_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
    [state, c.owner_account_id, verifier, nonce, redirect, sha256(browserToken)]
  )
  const u = new URL(d.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', c.client_id)
  u.searchParams.set('redirect_uri', redirect)
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', state)
  u.searchParams.set('nonce', nonce)
  u.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('login_hint', email)
  return { url: u.toString(), browserToken }
}

/**
 * Rückkehr vom Identity-Provider.
 * - Mitglied des Teams → Session (keine starke Anmeldung; Tresor bleibt bis zur Passphrase gesperrt).
 * - Inhaber → abgelehnt (meldet sich mit Passphrase an).
 * - Bestehendes Konto außerhalb des Teams → keine Session; bei automatischem Beitritt Einladung, die erst
 *   nach Anmeldung mit der eigenen Passphrase angenommen wird.
 * - Neues Konto → Registrierung mit Einladung (bei automatischem Beitritt).
 */
export async function finishSso(
  deps: Deps,
  code: string,
  state: string,
  browserToken: string | null | undefined,
  meta: { ip: string; userAgent: string | null }
): Promise<{ redirect: string; session?: { token: string; expiresAt: Date } }> {
  rateLimit(`sso:ip:${meta.ip}`, ipLimit(30), 15 * 60_000)
  if (!browserToken) throw new ApiError('UNAUTHENTICATED', 'SSO-Anmeldung wurde nicht in diesem Browser gestartet – bitte erneut starten.')
  const st = await deps.db.query<{ owner_account_id: string; verifier: string; nonce: string; redirect_uri: string }>(
    'DELETE FROM sso_states WHERE state = $1 AND browser_hash = $2 AND expires_at > now() RETURNING owner_account_id, verifier, nonce, redirect_uri',
    [state, sha256(browserToken)]
  )
  if (!st[0]) throw new ApiError('UNAUTHENTICATED', 'SSO-Anmeldung abgelaufen oder ungültig – bitte erneut starten.')
  const c = await configFor(deps.db, 's.owner_account_id = $1', [st[0].owner_account_id])
  if (!c) throw new ApiError('NOT_FOUND', 'SSO ist nicht (mehr) eingerichtet.')
  const d = await discover(deps, c.issuer)
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: st[0].redirect_uri, client_id: c.client_id, code_verifier: st[0].verifier })
  if (c.client_secret) body.set('client_secret', openSecret(Buffer.from(c.client_secret).toString()))
  const rejected = new ApiError('UNAUTHENTICATED', 'Der SSO-Anbieter hat die Anmeldung abgelehnt.')
  const tr = await idpFetch(
    deps,
    d.token_endpoint,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(), maxRedirects: 0 },
    rejected
  )
  if (!tr.ok) throw rejected
  const tokens = jsonOf<{ id_token?: unknown }>(tr, rejected)
  if (typeof tokens?.id_token !== 'string') throw new ApiError('UNAUTHENTICATED', 'Kein ID-Token vom SSO-Anbieter.')
  const { email } = await verifyIdToken(deps, tokens.id_token, d, c.client_id, st[0].nonce)
  const verified = await deps.db.query('SELECT 1 FROM team_sso_domains WHERE owner_account_id = $1 AND domain = $2 AND verified_at IS NOT NULL', [
    c.owner_account_id,
    email.split('@')[1]
  ])
  if (!verified.length) throw new ApiError('FORBIDDEN', 'Diese E-Mail-Domain gehört nicht (verifiziert) zum Team.')

  const acc = await deps.db.query<{ id: string; status: string }>('SELECT id, status FROM accounts WHERE email = $1', [email])
  const a = acc[0]
  if (a?.id === c.owner_account_id) {
    await audit(deps.db, a.id, 'user', 'auth.sso_owner_blocked', { team: c.owner_account_id })
    throw new ApiError('FORBIDDEN', 'Der Inhaber meldet sich mit seiner Passphrase an, nicht per SSO.')
  }
  if (a && (a.status === 'suspended' || a.status === 'deleted')) throw new ApiError('FORBIDDEN', 'Dieses Konto ist gesperrt.')
  const inTeam = a ? (await teamContext(deps.db, a.id))?.owner === c.owner_account_id : false

  if (a && inTeam) {
    const s = await createSession(deps.db, a.id, meta.userAgent, { strongAuth: false })
    await audit(deps.db, a.id, 'user', 'auth.sso_login', { team: c.owner_account_id })
    return { redirect: '/app', session: { token: s.token, expiresAt: s.expiresAt } }
  }

  if (!c.auto_join) throw new ApiError('FORBIDDEN', 'Du gehörst noch nicht zum Team – bitte eine Einladung beim Admin anfragen.')
  await assertFreeSeat(deps.db, c.owner_account_id)
  const joinToken = randomBytes(24).toString('base64url')
  await deps.db.query('INSERT INTO families (owner_account_id) VALUES ($1) ON CONFLICT DO NOTHING', [c.owner_account_id])
  await deps.db.query(`INSERT INTO family_invites (id, owner_account_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`, [
    uuidv7(),
    c.owner_account_id,
    sha256(joinToken)
  ])
  await audit(deps.db, a?.id ?? null, 'user', 'auth.sso_join', { team: c.owner_account_id, newAccount: !a })
  // neues Konto: /app?join=… leitet zur Registrierung und merkt sich die Einladung.
  // bestehendes Konto: erst mit der eigenen Passphrase anmelden, dann Beitritt bestätigen – SSO allein
  // öffnet kein Konto, das (noch) nicht zum Team gehört.
  return { redirect: a ? `/anmelden?join=${joinToken}` : `/app?join=${joinToken}` }
}
