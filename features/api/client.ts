import type {
  AccountView,
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
    call<{ ok: true }>('PATCH', `/admin/accounts/${encodeURIComponent(id)}`, { plan })
}

/** Nutzerfreundliche Meldung für beliebige Fehler. */
export function errorMessage(e: unknown, fallback = 'Etwas ist schiefgelaufen.'): string {
  if (e instanceof ApiClientError) return e.message
  if (e instanceof DOMException && e.name === 'AbortError') return 'Abgebrochen.'
  if (e instanceof Error && e.message) return e.message
  return fallback
}
