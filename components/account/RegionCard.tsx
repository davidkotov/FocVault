'use client'

import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { appMessages } from '@/lib/i18n/messages/app'
import { CURRENCIES } from '@/lib/pricing'
import { billingCurrencyFor, DISPLAY_CURRENCIES, LANGUAGES } from '@/lib/region'

/**
 * „Region“: Sprache und Währung (je 50). Übersetzt sind Deutsch und Englisch – andere Sprachen
 * zeigen englische Texte, Datum und Zahlen aber im Landesformat. Abgerechnet wird in CHF, EUR
 * oder USD; andere Währungen zeigen Preise umgerechnet („≈“).
 */
export default function RegionCard() {
  const m = useMessages(appMessages).region
  const { locale, regionLanguage, setRegionLanguage, displayCurrency, setDisplayCurrency, fmtDate, fmtNumber, fmtApprox, fmtMoney, currency } = useI18n()
  const name = (x: { de: string; en: string }) => (locale === 'en' ? x.en : x.de)
  const lang = LANGUAGES.find(l => l.code === regionLanguage)
  const billing = (CURRENCIES as string[]).includes(displayCurrency) ? null : billingCurrencyFor(displayCurrency)
  const sample = 14.9
  return (
    <div className="card plansection signincard regioncard">
      <div className="plansection-head">
        <h3>{m.title}</h3>
        <span className="dim">{m.lead}</span>
      </div>
      <div className="pwfield">
        <label className="k" htmlFor="region-lang">
          {m.language}
        </label>
        <select id="region-lang" className="smallselect" value={regionLanguage} onChange={e => setRegionLanguage(e.target.value)}>
          <optgroup label={m.translated}>
            {LANGUAGES.filter(l => l.translated).map(l => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </optgroup>
          <optgroup label={m.soon}>
            {LANGUAGES.filter(l => !l.translated).map(l => (
              <option key={l.code} value={l.code}>
                {l.native} – {name(l)}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="hint">{lang && !lang.translated ? m.fallback : m.formats}</span>
      </div>
      <div className="pwfield">
        <label className="k" htmlFor="region-cur">
          {m.currency}
        </label>
        <select id="region-cur" className="smallselect" value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
          <optgroup label={m.billed}>
            {DISPLAY_CURRENCIES.filter(c => (CURRENCIES as string[]).includes(c.code)).map(c => (
              <option key={c.code} value={c.code}>
                {c.code} – {name(c)}
              </option>
            ))}
          </optgroup>
          <optgroup label={m.shown}>
            {DISPLAY_CURRENCIES.filter(c => !(CURRENCIES as string[]).includes(c.code)).map(c => (
              <option key={c.code} value={c.code}>
                {c.code} – {name(c)}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="hint">{billing ? fmt(m.approx, { code: displayCurrency, billing }) : m.exact}</span>
      </div>
      <div className="pwfield">
        <span className="k">{m.preview}</span>
        <span className="dim">
          {fmtDate(new Date())} · {fmtNumber(1234567.89, 2)} · {fmtMoney(sample, currency)}
          {fmtApprox(sample, currency) ? ` (${fmtApprox(sample, currency)})` : ''}
        </span>
        <span />
      </div>
    </div>
  )
}
