'use client'

import Wordmark from '@/components/Wordmark'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import LocaleSwitch from '@/components/LocaleSwitch'
import { Icon } from '@/components/site/Icons'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { landingMessages } from '@/lib/i18n/messages/landing'

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0090ff" />
      <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
      <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
    </svg>
  )
}

/** Kopfzeile der öffentlichen Seiten (Landing, Support, Dokumentation, Status). */
export function SiteHeader() {
  const router = useRouter()
  const { path } = useI18n()
  const t = useMessages(landingMessages)
  const home = path('/')
  return (
    <>
      <div className="utilbar">
        <div className="wrap">
          <div className="utillinks">
            <Link href={path('/docs')}>{t.util.docs}</Link>
            <Link href={path('/support')}>{t.util.support}</Link>
            <Link href={path('/status')}>{t.util.status}</Link>
          </div>
          <div className="utilright">
            <LocaleSwitch showCurrency />
          </div>
        </div>
      </div>
      <nav className="mainnav">
        <div className="wrap">
          <Link href={home} className="brand">
            <Mark />
            <Wordmark />
          </Link>
          <div className="navlinks">
            <a href={`${home}#produkt`}>{t.nav.product}</a>
            <Link href={path('/sicherheit')}>{t.nav.security}</Link>
            <a href={`${home}#preise`}>{t.nav.pricing}</a>
            <a href={`${home}#faq`}>{t.nav.faq}</a>
          </div>
          <div className="navcta">
            <button onClick={() => router.push(path('/anmelden'))}>{t.login}</button>
            <button className="primary" onClick={() => router.push(path('/registrieren'))}>
              {t.register}
            </button>
          </div>
        </div>
      </nav>
    </>
  )
}

export function SiteFooter() {
  const { path } = useI18n()
  const t = useMessages(landingMessages)
  const home = path('/')
  return (
    <footer className="sitefooter">
      <div className="wrap">
        <div className="footgrid">
          <div>
            <div className="footbrand">
              <svg className="mark" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="20" fill="#0090ff" />
              </svg>
              FocVault
            </div>
            <div className="foottag">{t.footer.tag}</div>
          </div>
          <div className="footcol">
            <h5>{t.footer.product}</h5>
            <a href={`${home}#produkt`}>{t.footer.cloud}</a>
            <a href={`${home}#produkt`}>Secure Send</a>
            <a href={`${home}#preise`}>{t.nav.pricing}</a>
          </div>
          <div className="footcol">
            <h5>{t.footer.resources}</h5>
            <Link href={path('/docs')}>{t.util.docs}</Link>
            <Link href={path('/support')}>{t.util.support}</Link>
            <Link href={path('/status')}>{t.util.status}</Link>
          </div>
          <div className="footcol">
            <h5>{t.footer.company}</h5>
            <Link href={path('/sicherheit')}>{t.nav.security}</Link>
            <Link href={path('/team')}>{t.footer.team}</Link>
            <a href={`${home}#faq`}>FAQ</a>
            <Link href={path('/support?topic=business')}>{t.footer.contact}</Link>
          </div>
          <div className="footcol">
            <h5>{t.footer.legal}</h5>
            <Link href={path('/datenschutz')}>{t.footer.privacy}</Link>
            <Link href={path('/agb')}>{t.footer.terms}</Link>
            <Link href={path('/avv')}>{t.footer.dpa}</Link>
            <Link href={path('/impressum')}>{t.footer.imprint}</Link>
          </div>
        </div>
        <div className="footbottom">
          <span>{t.footer.copy}</span>
          <a className="builton" href="https://www.filecoin.cloud" target="_blank" rel="noreferrer">
            <Icon name="chain" size={14} className="inlineicon" /> {t.footer.builtOn}
          </a>
          <LocaleSwitch />
        </div>
      </div>
    </footer>
  )
}
