import { deps } from '@/server/deps'
import { json, route } from '@/server/shared/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const d = await deps()
  await d.db.query('SELECT 1')
  return json({ ok: true, database: d.db.driver, storage: d.storage.kind, storageDirect: d.storage.direct })
})
