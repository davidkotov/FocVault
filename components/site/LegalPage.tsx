'use client'

import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome'
import { Icon } from '@/components/site/Icons'
import { useI18n } from '@/features/i18n/I18nProvider'
import { COMPANY } from '@/lib/legal/company'
import { legal, type LegalKey } from '@/lib/legal/content'
import { PdfDoc } from '@/lib/pdf'

/** Platzhalter in eckigen Klammern sichtbar markieren. */
function Text({ s }: { s: string }) {
  const parts = s.split(/(\[[^\]]+\])/g)
  return <>{parts.map((p, i) => (p.startsWith('[') && p.endsWith(']') ? <mark key={i} className="legalph">{p}</mark> : p))}</>
}

/** Impressum, Datenschutz, AGB, AVV. */
export default function LegalPage({ doc }: { doc: LegalKey }) {
  const { locale } = useI18n()
  const d = legal[locale === 'en' ? 'en' : 'de'][doc]
  const en = locale === 'en'
  const pdf = () => {
    const p = new PdfDoc(`FocVault – ${d.title}`, `${COMPANY.name} · ${COMPANY.updated}`)
    p.text(d.title, { size: 20, bold: true, gap: 4 })
    p.text(d.lead, { size: 10, gap: 6 })
    for (const s of d.sections) {
      p.heading(s.h)
      for (const b of s.b) {
        if (Array.isArray(b)) b.forEach(x => p.text(`•  ${x}`, { size: 9.5, indent: 8 }))
        else p.text(b, { size: 9.5, gap: 3 })
      }
    }
    p.space(20)
    p.text(en ? 'Controller (customer): ______________________   Date: __________' : 'Verantwortlicher (Kunde): ______________________   Datum: __________', { size: 10, gap: 14 })
    p.text(en ? `Processor: ${COMPANY.name}` : `Auftragsverarbeiter: ${COMPANY.name}`, { size: 10 })
    const url = URL.createObjectURL(new Blob([p.bytes() as BlobPart], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `FocVault-${doc.toUpperCase()}.pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  return (
    <div className="landing v2 sitepage">
      <SiteHeader />
      <main className="legalwrap" id="main">
        {!COMPANY.final && (
          <div className="legaldraft">
            {en
              ? 'Draft – to be reviewed by a lawyer before publication. Highlighted fields still need company details.'
              : 'Entwurf – vor Veröffentlichung rechtlich prüfen lassen. Markierte Felder brauchen noch Firmenangaben.'}
          </div>
        )}
        <div className="kicker">{en ? 'Legal' : 'Rechtliches'}</div>
        <h1>{d.title}</h1>
        <p className="lead">
          <Text s={d.lead} />
        </p>
        {doc === 'avv' && (
          <button className="small" onClick={pdf} style={{ marginBottom: 24 }}>
            <Icon name="file" size={15} /> {en ? 'Download as PDF' : 'Als PDF herunterladen'}
          </button>
        )}
        {d.sections.map(s => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.b.map((b, i) =>
              Array.isArray(b) ? (
                <ul key={i}>
                  {b.map(x => (
                    <li key={x}>
                      <Text s={x} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i}>
                  <Text s={b} />
                </p>
              )
            )}
          </section>
        ))}
        <p className="hint">{(en ? 'Last updated: ' : 'Stand: ') + new Date(COMPANY.updated).toLocaleDateString(en ? 'en-GB' : 'de-CH')}</p>
      </main>
      <SiteFooter />
    </div>
  )
}
