import { z } from 'zod'
import { audit, type Deps } from '../deps'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'
import { getFocSettings, getFocState } from '../foc/config'
import { s3PublicUrl } from '../s3/service'

/**
 * Statusseite: automatische Messungen (höchstens alle 5 Minuten, aus der Hintergrund-Wartung)
 * und manuelle Meldungen zu Störungen und Wartungen. Öffentlich abrufbar, ohne Kundendaten.
 */
export const COMPONENTS = ['app', 'storage', 'filecoin', 's3'] as const
export type StatusComponent = (typeof COMPONENTS)[number]
const CHECK_EVERY_MS = 5 * 60_000
const DAYS = 90

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T }> {
  const t = Date.now()
  try {
    const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000))])
    return { ok: true, ms: Date.now() - t, value }
  } catch {
    return { ok: false, ms: Date.now() - t }
  }
}

/** Eine Messrunde (idempotent: überspringt, wenn die letzte Messung jünger als 5 Minuten ist). */
export async function runStatusChecks(deps: Deps, force = false): Promise<number> {
  if (!force) {
    const last = await deps.db.query<{ at: string }>(`SELECT max(at) AS at FROM status_checks`)
    if (last[0]?.at && Date.now() - new Date(last[0].at).getTime() < CHECK_EVERY_MS) return 0
  }
  const results: Array<{ c: StatusComponent; ok: boolean; degraded: boolean; ms: number | null }> = []
  const app = await timed(() => deps.db.query('SELECT 1'))
  results.push({ c: 'app', ok: app.ok, degraded: app.ok && app.ms > 2000, ms: app.ms })
  const st = await timed(async () => {
    const probe = new TextEncoder().encode(new Date().toISOString())
    await deps.storage.putSmall('h/00000000-0000-0000-0000-000000000000/s/status-probe', probe)
    const back = await deps.storage.getSmall('h/00000000-0000-0000-0000-000000000000/s/status-probe')
    if (!back || back.byteLength !== probe.byteLength) throw new Error('probe mismatch')
  })
  results.push({ c: 'storage', ok: st.ok, degraded: st.ok && st.ms > 3000, ms: st.ms })
  const foc = await getFocSettings(deps.db).catch(() => null)
  if (foc?.enabled) {
    const state = await getFocState(deps.db).catch(() => null)
    const run = state?.lastRun
    const fresh = !!run && Date.now() - new Date(run.at).getTime() < 60 * 60_000
    results.push({ c: 'filecoin', ok: !run || run.ok || fresh, degraded: !!run && !run.ok, ms: null })
  }
  if (process.env.S3_API !== '0') {
    const s3 = await timed(async () => {
      const r = await fetch(s3PublicUrl(), { method: 'GET' })
      return r.status
    })
    results.push({ c: 's3', ok: s3.ok, degraded: s3.ok && s3.ms > 3000, ms: s3.ms })
  }
  for (const r of results) {
    await deps.db.query('INSERT INTO status_checks (component, ok, degraded, latency_ms) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [r.c, r.ok, r.degraded, r.ms])
  }
  await deps.db.query(`DELETE FROM status_checks WHERE at < now() - interval '120 days'`)
  return results.length
}

export type DayState = 'up' | 'degraded' | 'down' | 'maintenance' | 'nodata'

export interface StatusOverview {
  overall: 'operational' | 'degraded' | 'outage' | 'maintenance'
  updatedAt: string | null
  components: Array<{
    id: StatusComponent
    state: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown'
    uptimePct: number | null
    latencyMs: number | null
    days: Array<{ date: string; state: DayState; uptimePct: number | null }>
  }>
  incidents: Array<{
    id: string
    title: string
    kind: 'incident' | 'maintenance'
    impact: 'degraded' | 'outage' | 'maintenance'
    components: string[]
    createdAt: string
    resolvedAt: string | null
    updates: Array<{ status: string; message: string; at: string }>
  }>
}

export async function statusOverview(deps: Deps, historyDays = 14): Promise<StatusOverview> {
  const since = new Date(Date.now() - DAYS * 86_400_000)
  const daily = await deps.db.query<{ component: string; day: string; total: number; ok: number; degraded: number }>(
    `SELECT component, to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*)::float8 AS total,
            count(*) FILTER (WHERE ok)::float8 AS ok, count(*) FILTER (WHERE degraded)::float8 AS degraded
       FROM status_checks WHERE at >= $1 GROUP BY 1, 2`,
    [since.toISOString()]
  )
  const latest = await deps.db.query<{ component: string; ok: boolean; degraded: boolean; latency_ms: number | null; at: string }>(
    `SELECT DISTINCT ON (component) component, ok, degraded, latency_ms, at FROM status_checks ORDER BY component, at DESC`
  )
  const incRows = await deps.db.query<{ id: string; title: string; kind: 'incident' | 'maintenance'; impact: 'degraded' | 'outage' | 'maintenance'; components: string[]; created_at: string; resolved_at: string | null }>(
    `SELECT * FROM status_incidents WHERE created_at >= now() - make_interval(days => $1) OR resolved_at IS NULL ORDER BY created_at DESC LIMIT 50`,
    [Math.max(historyDays, DAYS)]
  )
  const ups = incRows.length
    ? await deps.db.query<{ incident_id: string; status: string; message: string; at: string }>(
        'SELECT incident_id, status, message, at FROM status_updates WHERE incident_id = ANY($1::uuid[]) ORDER BY at DESC',
        [incRows.map(i => i.id)]
      )
    : []
  const open = incRows.filter(i => !i.resolved_at)
  const present = new Set([...latest.map(l => l.component), ...daily.map(d => d.component)])
  const components = COMPONENTS.filter(c => present.has(c)).map(id => {
    const cur = latest.find(l => l.component === id)
    const openFor = open.filter(i => i.components.includes(id))
    const state: StatusOverview['components'][number]['state'] = openFor.some(i => i.impact === 'outage')
      ? 'outage'
      : openFor.some(i => i.impact === 'maintenance')
        ? 'maintenance'
        : openFor.length || cur?.degraded
          ? 'degraded'
          : !cur
            ? 'unknown'
            : cur.ok
              ? 'operational'
              : 'outage'
    const days = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(Date.now() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10)
      const row = daily.find(x => x.component === id && x.day === d)
      const maint = incRows.some(
        inc => inc.kind === 'maintenance' && inc.components.includes(id) && inc.created_at.slice(0, 10) <= d && (inc.resolved_at ?? new Date().toISOString()).slice(0, 10) >= d
      )
      if (!row) return { date: d, state: (maint ? 'maintenance' : 'nodata') as DayState, uptimePct: null }
      const pct = (Number(row.ok) / Number(row.total)) * 100
      const s: DayState = maint ? 'maintenance' : pct < 95 ? 'down' : pct < 99.9 || Number(row.degraded) > 0 ? 'degraded' : 'up'
      return { date: d, state: s, uptimePct: Math.round(pct * 100) / 100 }
    })
    const rows = daily.filter(x => x.component === id)
    const total = rows.reduce((n, r) => n + Number(r.total), 0)
    const ok = rows.reduce((n, r) => n + Number(r.ok), 0)
    return { id, state, uptimePct: total ? Math.round((ok / total) * 10000) / 100 : null, latencyMs: cur?.latency_ms ?? null, days }
  })
  const worst = components.map(c => c.state)
  const overall: StatusOverview['overall'] = worst.includes('outage') ? 'outage' : worst.includes('degraded') ? 'degraded' : worst.includes('maintenance') ? 'maintenance' : 'operational'
  const updatedAt = latest.reduce<string | null>((m, l) => (!m || l.at > m ? new Date(l.at).toISOString() : m), null)
  return {
    overall,
    updatedAt,
    components,
    incidents: incRows.map(i => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      impact: i.impact,
      components: i.components,
      createdAt: new Date(i.created_at).toISOString(),
      resolvedAt: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
      updates: ups.filter(u => u.incident_id === i.id).map(u => ({ status: u.status, message: u.message, at: new Date(u.at).toISOString() }))
    }))
  }
}

export const incidentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  kind: z.enum(['incident', 'maintenance']),
  impact: z.enum(['degraded', 'outage', 'maintenance']),
  components: z.array(z.enum(COMPONENTS)).min(1),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed']),
  message: z.string().trim().min(3).max(2000)
})
export const incidentUpdateSchema = z.object({
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed']),
  message: z.string().trim().min(3).max(2000)
})
const DONE = new Set(['resolved', 'completed'])

export async function createIncident(deps: Deps, adminId: string, input: z.output<typeof incidentSchema>): Promise<{ id: string }> {
  const id = uuidv7()
  await deps.db.tx(async tx => {
    await tx.query(
      `INSERT INTO status_incidents (id, title, kind, impact, components, resolved_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END)`,
      [id, input.title, input.kind, input.impact, input.components, DONE.has(input.status)]
    )
    await tx.query('INSERT INTO status_updates (id, incident_id, status, message) VALUES ($1, $2, $3, $4)', [uuidv7(), id, input.status, input.message])
  })
  await audit(deps.db, adminId, 'admin', 'status.incident_created', { incident: id })
  return { id }
}

export async function addIncidentUpdate(deps: Deps, adminId: string, id: string, input: z.output<typeof incidentUpdateSchema>): Promise<void> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Meldung nicht gefunden.')
  const r = await deps.db.query('SELECT 1 FROM status_incidents WHERE id = $1', [id])
  if (!r.length) throw new ApiError('NOT_FOUND', 'Meldung nicht gefunden.')
  await deps.db.query('INSERT INTO status_updates (id, incident_id, status, message) VALUES ($1, $2, $3, $4)', [uuidv7(), id, input.status, input.message])
  await deps.db.query(`UPDATE status_incidents SET resolved_at = CASE WHEN $2::boolean THEN now() ELSE NULL END WHERE id = $1`, [id, DONE.has(input.status)])
  await audit(deps.db, adminId, 'admin', 'status.incident_updated', { incident: id, status: input.status })
}

/** RSS-Feed der Meldungen (für „Updates abonnieren“). */
export function statusRss(o: StatusOverview, origin: string, title: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const items = o.incidents
    .map(
      i =>
        `<item><title>${esc(i.title)}</title><link>${origin}/status#${i.id}</link><guid isPermaLink="false">${i.id}</guid><pubDate>${new Date(i.updates[0]?.at ?? i.createdAt).toUTCString()}</pubDate><description>${esc(i.updates.map(u => `${u.status}: ${u.message}`).join('\n'))}</description></item>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${origin}/status</link><description>${esc(title)}</description>${items}</channel></rss>`
}
