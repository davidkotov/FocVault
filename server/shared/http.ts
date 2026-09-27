import { NextResponse, type NextRequest } from 'next/server'
import { ZodError, type z } from 'zod'
import { ApiError } from './errors'

export type RouteContext = { params: Record<string, string | string[]> }
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<Response>

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Einheitliche Fehlerbehandlung für Route-Handler.
 * CSRF: Mutierende Aufrufe brauchen den Header `x-fv-client: web`. Ein Custom-Header erzwingt
 * bei Cross-Origin-Anfragen einen CORS-Preflight, den wir nie beantworten.
 */
export function route(handler: Handler, opts: { csrf?: boolean } = {}): Handler {
  const csrf = opts.csrf ?? true
  return async (req, ctx) => {
    try {
      if (csrf && !SAFE_METHODS.has(req.method) && req.headers.get('x-fv-client') !== 'web') {
        throw new ApiError('FORBIDDEN', 'Anfrage ohne gültigen Client-Header abgelehnt.')
      }
      const res = await handler(req, ctx)
      res.headers.set('Cache-Control', 'no-store')
      return res
    } catch (e) {
      return errorResponse(e)
    }
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, details: e.details } },
      { status: e.status, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Ungültige Anfrage.',
          details: { issues: e.issues.map(i => ({ path: i.path.map(String).join('.'), message: i.message })) }
        }
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  // Keine Nutzdaten ins Log – nur Typ und Nachricht.
  console.error('[api] unerwarteter Fehler:', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Interner Fehler. Bitte erneut versuchen.' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S, maxBytes = 64 * 1024): Promise<z.output<S>> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', 'Anfrage zu groß.')
  const text = await req.text()
  if (text.length > maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', 'Anfrage zu groß.')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiError('BAD_REQUEST', 'Ungültiges JSON.')
  }
  return schema.parse(data)
}

/** Liest einen Binär-Body mit hartem Limit (bricht ab, statt alles zu puffern). */
export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ApiError('PAYLOAD_TOO_LARGE', 'Daten zu groß.', { maxBytes })
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || 'local'
}

export function requestMeta(req: Request): { ip: string; userAgent: string | null } {
  return { ip: clientIp(req), userAgent: req.headers.get('user-agent') }
}

export function param(ctx: RouteContext, name: string): string {
  const v = ctx.params[name]
  return Array.isArray(v) ? v.join('/') : (v ?? '')
}
