import type {
  AccountView,
  BillingCurrency,
  BillingInterval,
  AdminStats,
  CreateObjectInput,
  CreateObjectResult,
  DownloadResult,
  KdfParams,
  KeyEnvelope,
  Plan,
  PresignedPiece,
  RegisterInput
} from '@/lib/api-types'
import type { Economics, PricingConfig } from '@/lib/pricing'
import type { FocSettings } from '@/server/foc/config'
import type { FocAdminStatus } from '@/server/foc/service'
import type { FocSyncResult } from '@/server/foc/sync'
import type { PublicShare, ShareSummary } from '@/server/shares/service'
import type { FilecoinFileStatus, ProofCertificate } from '@/server/foc/proofs'
import type { FamilyView } from '@/server/family/service'
import type { SpaceState } from '@/server/family/space'
import type { SharedVaultState, VaultAuditEvent, VaultRole, VaultsOverview } from '@/server/vaults/service'
import type { EmergencyOverview } from '@/server/emergency/service'
import type { ComplianceData, TeamAdminView, TeamAuditEvent } from '@/server/team/service'
import type { SsoConfigView } from '@/server/team/sso'
import type { StatusOverview } from '@/server/status/service'
import type { PublicStats } from '@/server/status/public-stats'
import type { SupportTicket } from '@/server/support/service'
import type { CreditsView } from '@/server/credits/service'
import type { TeamPolicy } from '@/lib/api-types'
import type { RetentionRule, S3Overview } from '@/server/s3/service'

export type { StatusOverview, SupportTicket, PublicStats, CreditsView }
export type { SharedVaultState, VaultAuditEvent, VaultRole, VaultsOverview, EmergencyOverview, ComplianceData, TeamAdminView, TeamAuditEvent, SsoConfigView }
export type { RetentionRule, S3Overview, SpaceState, FamilyView, FilecoinFileStatus, ProofCertificate, FocAdminStatus, FocSettings, FocSyncResult, PublicShare, ShareSummary }

/** Weiterleitung zu Stripe (Checkout, Kundenportal) */
export interface Redirect {
  redirectUrl: string
}

export function isRedirect(v: unknown): v is Redirect {
  return !!v && typeof (v as Redirect).redirectUrl === 'string'
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

async function toError(res: Response): Promise<ApiClientError> {
  try {
    const body = await res.json()
    if (body?.error?.code) return new ApiClientError(body.error.code, body.error.message, res.status, body.error.details)
  } catch {
    /* kein JSON */
  }
  return new ApiClientError(`HTTP_${res.status}`, `Serverfehler (${res.status}).`, res.status)
}

/**
 * Außerhalb des Browsers (Backup-Programm, S3-Gateway): Server-Adresse, Session-Cookie und ein
 * Rückruf für Antworten (Set-Cookie). Im Browser bleibt alles relativ und same-origin.
 */
const apiConfig: { baseUrl: string; headers: Record<string, string>; onResponse?: (res: Response) => void } = { baseUrl: '', headers: {} }

export function configureApi(opts: { baseUrl?: string; headers?: Record<string, string>; onResponse?: (res: Response) => void }): void {
  if (opts.baseUrl !== undefined) apiConfig.baseUrl = opts.baseUrl.replace(/\/$/, '')
  if (opts.headers) apiConfig.headers = opts.headers
  if (opts.onResponse) apiConfig.onResponse = opts.onResponse
}

/** Relative Speicher-URLs (lokaler Proxy) gegen die konfigurierte Server-Adresse auflösen. */
export function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${apiConfig.baseUrl}${url}` : url
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${apiConfig.baseUrl}/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'x-fv-client': 'web', ...apiConfig.headers, ...(init.headers ?? {}) }
    })
  } catch {
    throw new ApiClientError('NETWORK', 'Keine Verbindung zum Server.', 0)
  }
  apiConfig.onResponse?.(res)
  if (!res.ok) throw await toError(res)
  return res
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  return (await res.json()) as T
}

export const api = {
  prelogin: (email: string) => call<{ kdf: KdfParams }>('POST', '/auth/prelogin', { email }),
  register: (input: RegisterInput) => call<AccountView>('POST', '/auth/register', input),
  login: (email: string, authKey: string) => call<AccountView>('POST', '/auth/login', { email, authKey }),
  recovery: (input: { email?: string; recoveryLookup?: string; recoveryAuthKey: string }) =>
    call<AccountView>('POST', '/auth/recovery', input),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),

  walletNonce: () => call<{ nonce: string }>('POST', '/auth/wallet/nonce'),
  walletVerify: (message: string, signature: string) =>
    call<
      | { status: 'existing'; account: AccountView }
      | { status: 'new'; registrationToken: string; address: string }
    >('POST', '/auth/wallet/verify', { message, signature }),
  walletRegister: (input: Omit<RegisterInput, 'email'> & { registrationToken: string; label?: string }) =>
    call<AccountView>('POST', '/auth/wallet/register', input),
  recoveryWithSession: (recoveryAuthKey: string, recoveryLookup?: string) =>
    call<AccountView>('POST', '/account/recovery', { recoveryAuthKey, recoveryLookup }),

  async account(): Promise<AccountView | null> {
    const res = await send('/account?optional=1', { method: 'GET' })
    if (res.status === 204) return null
    return (await res.json()) as AccountView
  },

  setPassphrase: (input: { authKey: string; kdf: KdfParams; envelope: KeyEnvelope }) =>
    call<AccountView>('PUT', '/account/passphrase', input),

  async getIndex(): Promise<{ version: number; body: Uint8Array<ArrayBuffer> } | null> {
    const res = await send('/vault/index', { method: 'GET' })
    if (res.status === 204) return null
    const version = Number(res.headers.get('x-fv-version'))
    return { version, body: new Uint8Array(await res.arrayBuffer()) }
  },

  setPublicKey: (publicKey: JsonWebKey) => call<{ ok: true }>('PUT', '/account/pubkey', { publicKey }),
  familySpace: () => call<SpaceState>('GET', '/family/space'),
  status: () => call<StatusOverview>('GET', '/status'),
  credits: () => call<CreditsView>('GET', '/credits'),
  deposit: (amount: number) => call<{ ok?: true; redirectUrl?: string }>('POST', '/credits/deposit', { amount }),
  addPaymentMethod: () => call<{ redirectUrl: string }>('POST', '/credits/payment-method'),
  publicStats: () => call<PublicStats>('GET', '/public/stats'),
  supportTicket: (t: { firstName: string; lastName: string; email: string; company?: string; categories: string[]; topic?: string; message: string; website?: string }) =>
    call<{ id: string }>('POST', '/support', t),
  adminTickets: (status?: string) => call<{ tickets: SupportTicket[] }>('GET', `/admin/support${status ? `?status=${status}` : ''}`),
  adminUpdateTicket: (id: string, status: 'open' | 'answered' | 'closed', note?: string) => call<{ ok: true }>('PATCH', `/admin/support/${encodeURIComponent(id)}`, { status, note }),
  adminIncident: (i: { title: string; kind: 'incident' | 'maintenance'; impact: 'degraded' | 'outage' | 'maintenance'; components: string[]; status: string; message: string }) =>
    call<{ id: string }>('POST', '/admin/status/incidents', i),
  adminIncidentUpdate: (id: string, status: string, message: string) => call<{ ok: true }>('POST', `/admin/status/incidents/${encodeURIComponent(id)}/updates`, { status, message }),
  adminStatusCheck: () => call<{ checks: number }>('POST', '/admin/status/check'),
  team: () => call<TeamAdminView>('GET', '/team'),
  setTeamPolicy: (p: TeamPolicy) => call<TeamPolicy>('PUT', '/team/policy', p),
  setTeamRole: (id: string, role: 'admin' | 'member') => call<{ ok: true }>('PATCH', `/team/members/${encodeURIComponent(id)}`, { role }),
  teamAudit: (q: { from?: string; to?: string; member?: string; kind?: string; limit?: number }) =>
    call<{ events: TeamAuditEvent[] }>('GET', `/team/audit?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  teamReport: (days: number) => call<ComplianceData>('GET', `/team/report?days=${days}`),
  attestPassphrase: (passphraseChars: number) => call<{ ok: true }>('POST', '/account/attest', { passphraseChars }),
  setRecoveryKey: (publicKey: JsonWebKey, wrapped: unknown) => call<{ generation: number }>('POST', '/team/recovery/key', { publicKey, wrapped }),
  grantRecoveryKey: (generation: number, grants: Array<{ accountId: string; wrapped: unknown }>) => call<{ ok: true }>('POST', '/team/recovery/grants', { generation, grants }),
  escrow: (generation: number, wrapped: unknown) => call<{ ok: true }>('POST', '/team/escrow', { generation, wrapped }),
  recoveryRequest: (target: string, reason: string) => call<{ id: string }>('POST', '/team/recovery/requests', { target, reason }),
  recoveryDecide: (id: string, approve: boolean) => call<{ ok: true }>('POST', `/team/recovery/requests/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`),
  recoveryVault: (id: string) =>
    call<{ targetId: string; generation: number; escrow: unknown; teamKey: unknown; teamPublicKey: JsonWebKey; body: string | null }>('GET', `/team/recovery/requests/${encodeURIComponent(id)}/vault`),
  recoveryDownload: (id: string, objectId: string) =>
    call<DownloadResult>('GET', `/team/recovery/requests/${encodeURIComponent(id)}/objects/${encodeURIComponent(objectId)}/download`),
  sso: () => call<{ config: SsoConfigView | null }>('GET', '/team/sso'),
  setSso: (c: { issuer: string; clientId: string; clientSecret?: string; domains: string[]; enforce: boolean; autoJoin: boolean }) =>
    call<{ config: SsoConfigView }>('PUT', '/team/sso', c),
  deleteSso: () => call<{ ok: true }>('DELETE', '/team/sso'),
  emergency: () => call<EmergencyOverview>('GET', '/emergency'),
  createEmergency: (waitHours: number) => call<{ id: string; token: string }>('POST', '/emergency', { waitHours }),
  emergencyInvite: (token: string) => call<{ grantorLabel: string | null; waitHours: number }>('GET', `/emergency/invite/${encodeURIComponent(token)}`),
  acceptEmergency: (token: string) => call<{ ok: true }>('POST', '/emergency/accept', { token }),
  confirmEmergency: (id: string, wrapped: unknown) => call<{ ok: true }>('POST', `/emergency/${encodeURIComponent(id)}/confirm`, { wrapped }),
  emergencyAction: (id: string, action: 'request' | 'approve' | 'reject') => call<{ ok: true }>('POST', `/emergency/${encodeURIComponent(id)}/${action}`),
  removeEmergency: (id: string) => call<{ ok: true }>('DELETE', `/emergency/${encodeURIComponent(id)}`),
  emergencyVault: (id: string) => call<{ grantorId: string; body: string | null }>('GET', `/emergency/${encodeURIComponent(id)}/vault`),
  emergencyDownload: (id: string, objectId: string) =>
    call<DownloadResult>('GET', `/emergency/${encodeURIComponent(id)}/objects/${encodeURIComponent(objectId)}/download`),
  pwnedRange: (prefix: string) => send(`/pwned/${prefix}`, { method: 'GET' }).then(r => r.text()),
  vaults: () => call<VaultsOverview>('GET', '/vaults'),
  createVault: (input: { id: string; wrapped: unknown; body: string }) => call<{ ok: true }>('POST', '/vaults', input),
  deleteVault: (id: string) => call<{ ok: true }>('DELETE', `/vaults/${encodeURIComponent(id)}`),
  grantVaultKeys: (id: string, generation: number, grants: Array<{ accountId: string; wrapped: unknown }>, rotate = false) =>
    call<{ ok: true }>('POST', `/vaults/${encodeURIComponent(id)}/keys`, { generation, grants, ...(rotate ? { rotate: true } : {}) }),
  putVaultIndex: (id: string, baseVersion: number, body: string) =>
    call<{ version: number }>('PUT', `/vaults/${encodeURIComponent(id)}/index`, { baseVersion, body }),
  addVaultMember: (id: string, accountId: string, role: VaultRole) =>
    call<{ ok: true }>('POST', `/vaults/${encodeURIComponent(id)}/members`, { accountId, role }),
  setVaultRole: (id: string, accountId: string, role: VaultRole) =>
    call<{ ok: true }>('PATCH', `/vaults/${encodeURIComponent(id)}/members/${encodeURIComponent(accountId)}`, { role }),
  removeVaultMember: (id: string, accountId: string) =>
    call<{ ok: true }>('DELETE', `/vaults/${encodeURIComponent(id)}/members/${encodeURIComponent(accountId)}`),
  vaultAudit: (id: string) => call<{ events: VaultAuditEvent[] }>('GET', `/vaults/${encodeURIComponent(id)}/audit`),
  familySpaceGrant: (generation: number, grants: Array<{ accountId: string; wrapped: unknown }>) =>
    call<{ ok: true }>('POST', '/family/space/keys', { generation, grants }),
  async getSpaceIndex(): Promise<{ version: number; body: Uint8Array<ArrayBuffer> } | null> {
    const res = await send('/family/space/index', { method: 'GET' })
    if (res.status === 204) return null
    return { version: Number(res.headers.get('x-fv-version')), body: new Uint8Array(await res.arrayBuffer()) }
  },
  async putSpaceIndex(baseVersion: number, body: Uint8Array<ArrayBuffer>): Promise<{ version: number }> {
    const res = await send('/family/space/index', {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-fv-base-version': String(baseVersion) },
      body: new Blob([body])
    })
    return (await res.json()) as { version: number }
  },

  async putIndex(baseVersion: number, body: Uint8Array<ArrayBuffer>): Promise<{ version: number }> {
    const res = await send('/vault/index', {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-fv-base-version': String(baseVersion) },
      body
    })
    return (await res.json()) as { version: number }
  },

  createObject: (input: CreateObjectInput) => call<CreateObjectResult>('POST', '/objects', input),
  refreshUrls: (id: string, pieces: number[]) =>
    call<{ pieces: PresignedPiece[] }>('POST', `/objects/${encodeURIComponent(id)}/urls`, { pieces }),
  completeObject: (id: string) =>
    call<{ state: 'stored'; cipherBytes: number }>('POST', `/objects/${encodeURIComponent(id)}/complete`),
  download: (id: string) => call<DownloadResult>('GET', `/objects/${encodeURIComponent(id)}/download`),
  deleteObject: (id: string) => call<{ ok: true }>('DELETE', `/objects/${encodeURIComponent(id)}`),

  adminStats: () => call<AdminStats>('GET', '/admin/stats'),
  adminSetPlan: (id: string, plan: Plan) =>
    call<{ ok: true }>('PATCH', `/admin/accounts/${encodeURIComponent(id)}`, { plan }),
  adminUpdateAccount: (
    id: string,
    input: { plan?: Plan; interval?: BillingInterval; currency?: BillingCurrency; paygEnabled?: boolean; paygCapGb?: number; status?: string }
  ) =>
    call<{ ok: true }>('PATCH', `/admin/accounts/${encodeURIComponent(id)}`, input),
  adminAccounts: (q: string, offset: number) =>
    call<{ total: number; rows: AdminAccountListRow[] }>(
      'GET',
      `/admin/accounts?q=${encodeURIComponent(q)}&offset=${offset}`
    ),
  adminGrantAddon: (id: string, input: { gb: number; price: number; note?: string }) =>
    call<{ ok: true }>('POST', `/admin/accounts/${encodeURIComponent(id)}/addons`, input),
  adminRevokeAddon: (addonId: string) => call<{ ok: true }>('DELETE', `/admin/addons/${encodeURIComponent(addonId)}`),
  adminEconomics: () => call<EconomicsReport>('GET', '/admin/economics'),
  adminPricing: () => call<PricingConfig>('GET', '/admin/pricing'),
  adminSavePricing: (p: PricingConfig) => call<PricingConfig>('PUT', '/admin/pricing', p),
  adminTreasury: () => call<TreasuryStatus>('GET', '/admin/treasury'),
  adminSaveTreasury: (t: { address: string; chainId: 314 | 314159; label: string }) =>
    call<TreasuryStatus>('PUT', '/admin/treasury', t),
  adminFoc: () => call<FocAdminStatus>('GET', '/admin/foc'),
  adminSaveFoc: (s: FocSettings) => call<FocAdminStatus>('PUT', '/admin/foc', s),
  adminFocSessionKey: (network: FocSettings['network']) => call<{ address: string }>('POST', '/admin/foc/session-key', { network }),
  adminFocSync: () => call<FocSyncResult>('POST', '/admin/foc/sync'),

  trashObject: (id: string) => call<{ objectId: string; trashedAt: string; purgeAfter: string }>('POST', `/objects/${encodeURIComponent(id)}/trash`),
  restoreObject: (id: string) => call<{ ok: true }>('POST', `/objects/${encodeURIComponent(id)}/restore`),
  listTrash: () => call<{ items: Array<{ objectId: string; trashedAt: string; purgeAfter: string }> }>('GET', '/objects/trash'),
  keepVersion: (id: string) => call<{ purgeAfter: string }>('POST', `/objects/${encodeURIComponent(id)}/version`),
  promoteVersion: (id: string, currentId: string) => call<{ ok: true }>('POST', `/objects/${encodeURIComponent(id)}/promote`, { currentId }),
  listVersions: () => call<{ items: Array<{ objectId: string; purgeAfter: string }> }>('GET', '/objects/versions'),
  family: () => call<FamilyView>('GET', '/family'),
  familyInvite: () => call<{ token: string; expiresAt: string }>('POST', '/family/invites'),
  familyRevokeInvite: (id: string) => call<{ ok: true }>('DELETE', `/family/invites/${encodeURIComponent(id)}`),
  familyInviteInfo: (token: string) => call<{ ownerLabel: string; expiresAt: string; kind: 'family' | 'business' }>('GET', `/family/join?token=${encodeURIComponent(token)}`),
  familyJoin: (token: string) => call<AccountView>('POST', '/family/join', { token }),
  familyRemove: (accountId: string) => call<{ ok: true }>('DELETE', `/family/members/${encodeURIComponent(accountId)}`),
  proof: (objectId: string) => call<ProofCertificate>('GET', `/objects/${encodeURIComponent(objectId)}/proof`),
  addPasskey: (input: { credentialId: string; label: string; salt: string; iv: string; cipher: string }) =>
    call<AccountView>('POST', '/account/passkeys', input),
  removePasskey: (credentialId: string) => call<AccountView>('DELETE', `/account/passkeys/${encodeURIComponent(credentialId)}`),
  s3Overview: () => call<S3Overview>('GET', '/s3'),
  s3CreateKey: (label: string) => call<{ accessKey: string; secretKey: string }>('POST', '/s3/keys', { label }),
  s3RevokeKey: (accessKey: string) => call<{ ok: true }>('DELETE', `/s3/keys/${encodeURIComponent(accessKey)}`),
  s3CreateBucket: (name: string, objectLock: boolean) => call<{ ok: true }>('POST', '/s3/buckets', { name, objectLock }),
  s3UpdateBucket: (name: string, input: { lock?: { mode: 'GOVERNANCE' | 'COMPLIANCE'; days: number } | null; retention?: RetentionRule | null }) =>
    call<{ ok: true }>('PATCH', `/s3/buckets/${encodeURIComponent(name)}`, input),
  filecoinStatus: () => call<FilecoinFileStatus>('GET', '/objects/filecoin'),
  createShare: (input: { objectId?: string; objectIds?: string[]; meta: string; payload?: string; expiresInHours: number | null; maxDownloads: number | null }) =>
    call<ShareSummary>('POST', '/shares', input),
  listShares: (objectId?: string) =>
    call<{ shares: ShareSummary[] }>('GET', `/shares${objectId ? `?objectId=${encodeURIComponent(objectId)}` : ''}`),
  revokeShare: (id: string) => call<{ ok: true }>('DELETE', `/shares/${encodeURIComponent(id)}`),
  publicShare: (id: string) => call<PublicShare>('GET', `/public/shares/${encodeURIComponent(id)}`),
  shareDownload: (id: string) =>
    call<DownloadResult & { items?: Array<{ objectId: string; pieces: PresignedPiece[] }>; payload?: string }>('POST', `/public/shares/${encodeURIComponent(id)}/download`),
  moveToSpace: (id: string) => call<{ ok: true }>('POST', `/objects/${encodeURIComponent(id)}/space`),

  offer: () => call<PublicOffer>('GET', '/billing/offer'),
  buyAddon: (packId: string) => call<AccountView>('POST', '/billing/addons', { packId }),
  cancelAddon: (id: string) => call<AccountView>('DELETE', `/billing/addons/${encodeURIComponent(id)}`),
  setPayg: (enabled: boolean, capGb?: number) => call<AccountView | Redirect>('PUT', '/billing/payg', { enabled, capGb }),
  changePlan: (
    plan: 'free' | 'pro' | 'family' | 'business',
    interval: BillingInterval,
    currency: BillingCurrency,
    business?: { tier: 'starter' | 'business'; extraSeats: number }
  ) => call<AccountView | Redirect>('PUT', '/billing/plan', { plan, interval, currency, ...(business ?? {}) }),
  billingPortal: () => call<Redirect>('POST', '/billing/portal'),
  resumeSubscription: () => call<AccountView>('POST', '/billing/resume'),
  setCurrency: (currency: BillingCurrency) => call<AccountView>('PUT', '/billing/currency', { currency })
}

export interface AdminAccountListRow {
  id: string
  display: string
  plan: Plan
  status: string
  currency: BillingCurrency
  interval: BillingInterval
  storedBytes: number
  quotaGb: number
  addonsGb: number
  addonsMonthly: number
  paygEnabled: boolean
  paygCapGb: number | null
  lastLoginAt: string | null
  createdAt: string
}

export interface EconomicsReport {
  pricing: PricingConfig
  economics: Economics
  history: Array<{ day: string; storedBytes: number; accounts: number }>
  inactiveFree: { warn: number; delete: number }
  mix: Array<{ plan: Plan; currency: BillingCurrency; interval: BillingInterval; accounts: number }>
}

export interface TreasuryStatus {
  address: string
  chainId: 314 | 314159
  label: string
  balances: { usdfc: number; fil: number } | null
  error: string | null
  monthlyCostUsd: number
  runwayMonths: number | null
}

export interface PublicOffer {
  free: PricingConfig['free']
  payg: PricingConfig['payg']
  plans: PricingConfig['plans']
  addons: PricingConfig['addons']
  businessAddons: PricingConfig['businessAddons']
  trashDays: number
  versions: PricingConfig['versions']
  business: PricingConfig['business']
  purchasesEnabled: boolean
}

/** Nutzerfreundliche Meldung für beliebige Fehler. */
export function errorMessage(e: unknown, fallback = 'Etwas ist schiefgelaufen.'): string {
  if (e instanceof ApiClientError) return e.message
  if (e instanceof DOMException && e.name === 'AbortError') return 'Abgebrochen.'
  if (e instanceof Error && e.message) return e.message
  return fallback
}
