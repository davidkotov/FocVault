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
import type { FilecoinFileStatus } from '@/server/foc/proofs'

export type { FilecoinFileStatus, FocAdminStatus, FocSettings, FocSyncResult, PublicShare, ShareSummary }

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

async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'x-fv-client': 'web', ...(init.headers ?? {}) }
    })
  } catch {
    throw new ApiClientError('NETWORK', 'Keine Verbindung zum Server.', 0)
  }
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
  recovery: (email: string, recoveryAuthKey: string) =>
    call<AccountView>('POST', '/auth/recovery', { email, recoveryAuthKey }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),

  walletNonce: () => call<{ nonce: string }>('POST', '/auth/wallet/nonce'),
  walletVerify: (message: string, signature: string) =>
    call<
      | { status: 'existing'; account: AccountView }
      | { status: 'new'; registrationToken: string; address: string }
    >('POST', '/auth/wallet/verify', { message, signature }),
  walletRegister: (input: Omit<RegisterInput, 'email'> & { registrationToken: string; label?: string }) =>
    call<AccountView>('POST', '/auth/wallet/register', input),
  recoveryWithSession: (recoveryAuthKey: string) =>
    call<AccountView>('POST', '/account/recovery', { recoveryAuthKey }),

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

  filecoinStatus: () => call<FilecoinFileStatus>('GET', '/objects/filecoin'),
  createShare: (input: { objectId: string; meta: string; expiresInHours: number | null; maxDownloads: number | null }) =>
    call<ShareSummary>('POST', '/shares', input),
  listShares: (objectId?: string) =>
    call<{ shares: ShareSummary[] }>('GET', `/shares${objectId ? `?objectId=${encodeURIComponent(objectId)}` : ''}`),
  revokeShare: (id: string) => call<{ ok: true }>('DELETE', `/shares/${encodeURIComponent(id)}`),
  publicShare: (id: string) => call<PublicShare>('GET', `/public/shares/${encodeURIComponent(id)}`),
  shareDownload: (id: string) => call<DownloadResult>('POST', `/public/shares/${encodeURIComponent(id)}/download`),

  offer: () => call<PublicOffer>('GET', '/billing/offer'),
  buyAddon: (packId: string) => call<AccountView>('POST', '/billing/addons', { packId }),
  cancelAddon: (id: string) => call<AccountView>('DELETE', `/billing/addons/${encodeURIComponent(id)}`),
  setPayg: (enabled: boolean, capGb?: number) => call<AccountView>('PUT', '/billing/payg', { enabled, capGb }),
  changePlan: (plan: 'free' | 'pro' | 'family', interval: BillingInterval, currency: BillingCurrency) =>
    call<AccountView>('PUT', '/billing/plan', { plan, interval, currency }),
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
  purchasesEnabled: boolean
}

/** Nutzerfreundliche Meldung für beliebige Fehler. */
export function errorMessage(e: unknown, fallback = 'Etwas ist schiefgelaufen.'): string {
  if (e instanceof ApiClientError) return e.message
  if (e instanceof DOMException && e.name === 'AbortError') return 'Abgebrochen.'
  if (e instanceof Error && e.message) return e.message
  return fallback
}
