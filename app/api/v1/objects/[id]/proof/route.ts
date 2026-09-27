import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { ApiError } from '@/server/shared/errors'
import { isUuid } from '@/server/shared/ids'
import { json, param, route } from '@/server/shared/http'
import { proofCertificate } from '@/server/foc/proofs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Nachweis (Zertifikat) einer Datei auf Filecoin – nur für den Eigentümer. */
export const GET = route(async (req, ctx) => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const id = param(ctx, 'id')
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Datei nicht gefunden.')
  const cert = await proofCertificate(d.db, session.accountId, id)
  if (!cert) throw new ApiError('NOT_FOUND', 'Diese Datei ist noch nicht vollständig auf Filecoin gesichert.')
  return json(cert)
})
