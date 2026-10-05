import { NextResponse } from 'next/server'
import { deps } from '@/server/deps'
import { getFxRates, redisConfig } from '@/server/fx/rates'
import { errorResponse } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Öffentliche Wechselkurse (Basis USD) für die Preisanzeige – ohne Anmeldung.
 * Bewusst ohne route(): die setzt bei Erfolg `no-store`, hier soll das CDN eine Stunde cachen.
 */
export async function GET() {
  try {
    // DB nur als Cache-Ersatz, wenn kein Redis eingerichtet ist
    const db = redisConfig() ? null : await deps().then(d => d.db).catch(() => null)
    return NextResponse.json(await getFxRates({ db }), {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (e) {
    return errorResponse(e)
  }
}
