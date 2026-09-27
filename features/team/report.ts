import type { ComplianceData } from '@/features/api/client'
import { PdfDoc } from '@/lib/pdf'
import { formatBytes } from '@/lib/vault'
import type { teamAdminMessages } from '@/lib/i18n/messages/team-admin'

type M = (typeof teamAdminMessages)['de']
const f = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/** Compliance-Bericht als PDF (im Browser erzeugt – die Daten verlassen das Gerät nicht erneut). */
export function buildComplianceReport(d: ComplianceData, m: M, fmtDate: (s: string) => string, eventLabel: (kind: string) => string): Uint8Array {
  const r = m.report
  const date = fmtDate(d.generatedAt)
  const doc = new PdfDoc(r.header, f(r.footer, { date }))
  doc.text(r.title, { size: 20, bold: true, gap: 2 })
  doc.text(f(r.generated, { date, days: d.periodDays }), { size: 9, color: [0.4, 0.43, 0.5], gap: 6 })
  doc.text(r.zk, { size: 9, gap: 4 })

  doc.heading(r.team)
  doc.table(
    [r.owner, r.tier, r.seats],
    [[d.team.ownerLabel, `Business ${{ starter: 'Starter', business: '', enterprise: 'Enterprise' }[d.team.tier ?? 'starter']}`.trim(), String(d.team.seats)]],
    [0.5, 0.3, 0.2]
  )

  doc.heading(r.policies)
  const p = d.policy
  const onoff = (b: boolean) => (b ? r.on : r.off)
  doc.table(
    ['', ''],
    [
      [m.p.passkeyRequired, onoff(p.passkeyRequired)],
      [m.p.minPassphraseChars, f(m.chars, { n: p.minPassphraseChars })],
      [m.p.autoLockMinutes, String(p.autoLockMinutes)],
      [m.p.allowShareLinks, onoff(p.allowShareLinks)],
      [m.p.maxShareDays, p.maxShareDays ? String(p.maxShareDays) : r.none],
      [m.p.recoveryRequired, onoff(p.recoveryRequired)]
    ],
    [0.65, 0.35]
  )

  doc.heading(r.members)
  const ok = d.members.filter(x => x.compliant).length
  doc.text(f(m.compliantSummary, { ok, n: d.members.length }), { size: 9.5, gap: 4 })
  doc.table(
    [m.cols.person, m.cols.role, m.cols.passkeys, m.cols.passphrase, m.cols.escrow, m.cols.active, m.cols.status],
    d.members.map(x => [
      x.label,
      m.roles[x.role],
      String(x.passkeys),
      x.passphraseChars ? f(m.chars, { n: x.passphraseChars }) : m.unknown,
      x.escrowed ? m.yes : m.no,
      x.lastActive ? fmtDate(x.lastActive) : '—',
      x.compliant ? m.ok : x.issues.map(i => m.issues[i]).join(', ')
    ]),
    [0.26, 0.1, 0.08, 0.12, 0.12, 0.12, 0.2]
  )

  doc.heading(r.storage)
  doc.text(f(r.files, { n: d.storage.files, size: formatBytes(d.storage.bytes) }), { size: 9.5 })
  doc.text(f(r.filecoin, { n: d.storage.onFilecoin, size: formatBytes(d.storage.filecoinBytes) }), { size: 9.5, gap: 4 })

  doc.heading(r.recovery)
  if (!d.recoveryRequests.length) doc.text(r.noRecovery, { size: 9.5 })
  else
    doc.table(
      [m.audit.when, m.rec.target, m.rec.by.replace(' {a}', ''), m.rec.approvedBy.replace(' {b}', ''), r.statusCol, m.rec.reason.split(' (')[0]],
      d.recoveryRequests.map(q => [fmtDate(q.createdAt), q.targetLabel, q.requestedByLabel, q.approvedByLabel ?? '—', r.status[q.status], q.reason]),
      [0.14, 0.18, 0.16, 0.16, 0.1, 0.26]
    )

  doc.heading(r.events)
  doc.text(f(r.total, { n: d.events.total }), { size: 9.5, gap: 2 })
  doc.table(
    [m.audit.what, 'n'],
    d.events.byKind.slice(0, 25).map(k => [eventLabel(k.kind), String(k.n)]),
    [0.8, 0.2]
  )
  doc.text(r.recent, { size: 10, bold: true, gap: 2 })
  doc.table(
    [m.audit.when, m.audit.who, m.audit.what],
    d.events.recent.map(e => [fmtDate(e.at), e.actor, eventLabel(e.kind)]),
    [0.22, 0.33, 0.45]
  )
  return doc.bytes()
}
