import { describe, expect, it } from 'vitest'
import { testDeps } from '../testing'
import { addIncidentUpdate, createIncident, runStatusChecks, statusOverview, statusRss } from './service'
import { createTicket, listTickets, updateTicket } from '../support/service'

describe('Statusseite & Support', () => {
  it('Messungen ergeben Tagesbalken und Verfügbarkeit; Meldungen setzen den Zustand', async () => {
    const deps = await testDeps()
    process.env.S3_API = '0'
    expect(await runStatusChecks(deps, true)).toBeGreaterThanOrEqual(2)
    expect(await runStatusChecks(deps)).toBe(0) // 5-Minuten-Sperre
    // ältere Messung mit Ausfall am Vortag
    await deps.db.query(`INSERT INTO status_checks (component, at, ok) VALUES ('storage', now() - interval '1 day', false), ('storage', now() - interval '1 day' + interval '1 minute', true)`)
    let o = await statusOverview(deps)
    expect(o.overall).toBe('operational')
    const storage = o.components.find(c => c.id === 'storage')!
    expect(storage.days).toHaveLength(90)
    expect(storage.days.at(-1)!.state).toBe('up')
    expect(storage.days.at(-2)!.state).toBe('down')
    expect(storage.days[0].state).toBe('nodata')
    expect(storage.uptimePct).toBeCloseTo(66.67, 1)

    const { id } = await createIncident(deps, '00000000-0000-7000-8000-000000000000', {
      title: 'Uploads verlangsamt', kind: 'incident', impact: 'degraded', components: ['storage'], status: 'investigating', message: 'Wir prüfen das.'
    })
    o = await statusOverview(deps)
    expect(o.overall).toBe('degraded')
    expect(o.incidents[0]).toMatchObject({ title: 'Uploads verlangsamt', resolvedAt: null })
    await addIncidentUpdate(deps, '00000000-0000-7000-8000-000000000000', id, { status: 'resolved', message: 'Behoben.' })
    o = await statusOverview(deps)
    expect(o.overall).toBe('operational')
    expect(o.incidents[0].updates.map(u => u.status)).toEqual(['resolved', 'investigating'])
    expect(statusRss(o, 'https://focvault.app', 'FocVault Status')).toContain('<title>Uploads verlangsamt</title>')
  })

  it('Support-Anfrage speichern, im Admin bearbeiten', async () => {
    const deps = await testDeps()
    const { id } = await createTicket(deps, { firstName: 'Max', lastName: 'Muster', email: 'max@firma.ch', company: 'Firma AG', categories: ['storage'], topic: 'storage', message: 'Wir brauchen 20 TB.' }, { ip: '1.2.3.4' })
    expect((await listTickets(deps, 'open')).map(t => t.id)).toEqual([id])
    await updateTicket(deps, '00000000-0000-7000-8000-000000000000', id, { status: 'answered', note: 'Angebot geschickt' })
    expect((await listTickets(deps))[0]).toMatchObject({ status: 'answered', note: 'Angebot geschickt', name: 'Max Muster' })
  })
})
