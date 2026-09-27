import { deps } from '@/server/deps'
import { offer } from '@/server/billing/service'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Öffentliches Angebot (Pakete, Zusatzspeicher, PAYG-Preis) – für App und Landing. */
export const GET = route(async () => json(await offer(await deps())))
