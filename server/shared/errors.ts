/** Fehler-Taxonomie der API (ARCHITECTURE §8.6). Kein Fehler wird still verschluckt. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'REAUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'GONE'
  | 'VERSION_CONFLICT'
  | 'EMAIL_TAKEN'
  | 'ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'QUOTA_EXCEEDED'
  | 'PLAN_REQUIRED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPLOAD_SIZE_MISMATCH'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL'

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  GONE: 410,
  VERSION_CONFLICT: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REGISTERED: 409,
  INVALID_CREDENTIALS: 401,
  QUOTA_EXCEEDED: 402,
  PLAN_REQUIRED: 402,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UPLOAD_SIZE_MISMATCH: 409,
  STORAGE_UNAVAILABLE: 503,
  INTERNAL: 500
}

export class ApiError extends Error {
  readonly status: number

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = STATUS[code]
  }
}
