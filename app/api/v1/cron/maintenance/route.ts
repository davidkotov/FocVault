import { deps } from '@/server/deps'
import { ApiError } from '@/server/shared/errors'
import { json, route } from '@/server/shared/http'
import { isCronRequest } from '@/server/foc/service'
import { runMaintenance } from '@/server/maintenance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Für Hosting ohne Dauerprozess (Vercel Cron): `Authorization: Bearer <CRON_SECRET>`. */
export const GET = route(async req => {
  if (!isCronRequest(req)) throw new ApiError('FORBIDDEN', 'Nicht erlaubt.')
  return json(await runMaintenance(await deps()))
})
